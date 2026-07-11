import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  authSyncInputSchema,
  createProfileInputSchema,
  type ResearchProfileContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  actorHandle,
  ensureLiveData,
  insertProfile,
  normalizeProfile,
  publicProfile
} from "./foundation";

const suffixedHandle = (baseHandle: string, index: number) =>
  index === 0 ? baseHandle : cleanHandle(`${baseHandle}_${index + 1}`);

const resolveSyncedHandle = async (client: PoolClient, desiredHandle: string, clerkSubject: string) => {
  const existingUser = await client.query<{ handle: string | null }>(
    "SELECT handle FROM users WHERE clerk_user_id = $1 AND handle IS NOT NULL LIMIT 1",
    [clerkSubject]
  );

  if (existingUser.rows[0]?.handle) return existingUser.rows[0].handle;

  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  const canClaimOwnerHandle =
    desiredHandle === ownerHandle && env.SYMPOSIUM_OWNER_CLERK_USER_ID === clerkSubject;

  for (let index = 0; index < 50; index += 1) {
    const candidate = suffixedHandle(desiredHandle, index);
    const userConflict = await client.query<{ clerkUserId: string | null }>(
      `SELECT clerk_user_id AS "clerkUserId"
       FROM users
       WHERE handle = $1 AND clerk_user_id IS DISTINCT FROM $2
       LIMIT 1`,
      [candidate, clerkSubject]
    );
    if (userConflict.rowCount) continue;

    const profileConflict = await client.query<{ userId: string | null; clerkUserId: string | null }>(
      `SELECT p.user_id AS "userId", u.clerk_user_id AS "clerkUserId"
       FROM profiles p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.handle = $1
       LIMIT 1`,
      [candidate]
    );

    const profile = profileConflict.rows[0];
    if (!profile) return candidate;
    if (profile.clerkUserId === clerkSubject) return candidate;
    if (!profile.userId && candidate === ownerHandle && canClaimOwnerHandle) return candidate;
  }

  throw new TRPCError({
    code: "CONFLICT",
    message: "Could not allocate a unique Symposium handle for this account."
  });
};

export const upsertProfile = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createProfileInputSchema.parse(rawInput);
  const person = normalizeProfile(input);
  const writerHandle = actorHandle(actor, person.handle);
  if (cleanHandle(person.handle) !== cleanHandle(writerHandle)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Profiles can only be updated by their owner." });
  }

  if (!hasDatabase()) return { ...person, revision: (person.revision ?? 1) + 1 };
  await ensureLiveData();

  const client = await getPool().connect();
  let stagedEvent: StoredLiveEvent | undefined;
  let storedProfile: ResearchProfileContract | undefined;
  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ResearchProfileContract>(client, writerHandle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const storedPerson = await insertProfile(client, person);
    storedProfile = storedPerson;
    await client.query(
      `UPDATE posts
       SET author_name = $2, revision = revision + 1, updated_at = now()
       WHERE author_handle = $1 AND author_name IS DISTINCT FROM $2`,
      [person.handle, person.name]
    );
    const changedComments = await client.query<{ postId: string }>(
      `UPDATE comments
       SET author_name = $2, revision = revision + 1, updated_at = now()
       WHERE author_handle = $1 AND author_name IS DISTINCT FROM $2
       RETURNING post_id AS "postId"`,
      [person.handle, person.name]
    );
    const changedPostIds = Array.from(new Set(changedComments.rows.map((row) => row.postId)));
    if (changedPostIds.length) {
      await client.query(
        `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = ANY($1::text[])`,
        [changedPostIds]
      );
    }
    await stageAuditLog(client, {
      actorHandle: writerHandle,
      action: "profile.upsert",
      subjectType: "profile",
      subjectId: person.handle,
      metadata: mutationAuditMetadata(mutation, { source: actor.source })
    });
    await completeMutation(client, writerHandle, mutation, storedPerson);
    stagedEvent = await stageEvent(client, {
      kind: "profile.updated",
      actorHandle: writerHandle,
      subjectType: "profile",
      subjectId: person.handle,
      payload: { profile: publicProfile(storedPerson) }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return storedProfile ?? person;
};

export const syncUser = async (rawInput: unknown, actor: Actor) => {
  const input = authSyncInputSchema.parse(rawInput ?? {});
  const clerkUserId = actor.clerkUserId ?? input.clerkUserId;
  const requestedHandle = cleanHandle(actor.handle ?? input.handle ?? input.email?.split("@")[0] ?? "symposium_member");
  const clerkSubject = clerkUserId ?? (actor.source === "dev" ? `dev:${requestedHandle}` : undefined);
  const name = actor.name ?? input.name ?? requestedHandle.replace(/^@/, "");
  const email = actor.email ?? input.email;

  if (!clerkSubject) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No Clerk subject was found for this user." });
  }

  if (!hasDatabase()) {
    return normalizeProfile({
      name,
      handle: requestedHandle,
      email,
      role: "Symposium participant",
      location: "Public rooms",
      bio: "A participant in the current inquiry thread.",
      fields: ["Inquiry"]
    });
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let syncedProfile: ResearchProfileContract | undefined;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const handle = await resolveSyncedHandle(client, requestedHandle, clerkSubject);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (clerk_user_id, primary_email, handle, display_name, image_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         primary_email = EXCLUDED.primary_email,
         handle = EXCLUDED.handle,
         display_name = EXCLUDED.display_name,
         image_url = EXCLUDED.image_url,
         updated_at = now()
       RETURNING id`,
      [clerkSubject, email ?? null, handle, name, actor.imageUrl ?? input.imageUrl ?? null]
    );

    const existingProfile = await client.query<ResearchProfileContract & { avatarUrl: string | null }>(
      `SELECT
        handle,
        email,
        name,
        avatar_url AS "avatarUrl",
        likes_public AS "likesPublic",
        reshares_public AS "resharesPublic",
        role,
        location,
        bio,
        fields,
        revision
       FROM profiles
       WHERE handle = $1
       LIMIT 1`,
      [handle]
    );
    const existing = existingProfile.rows[0];
    const person = normalizeProfile({
      name: existing?.name ?? name,
      handle,
      email: existing?.email ?? email,
      avatarUrl: existing?.avatarUrl ?? actor.imageUrl ?? input.imageUrl,
      likesPublic: existing?.likesPublic ?? true,
      resharesPublic: existing?.resharesPublic ?? true,
      role: existing?.role ?? "Symposium participant",
      location: existing?.location ?? "Public rooms",
      bio: existing?.bio ?? "A participant in the current inquiry thread.",
      fields: existing?.fields ?? ["Inquiry"]
    });
    const storedPerson = await insertProfile(client, person, user.rows[0]?.id);
    await client.query(
      `INSERT INTO workspaces (owner_handle, name)
       VALUES ($1, 'Notebook')
       ON CONFLICT (owner_handle, name) DO NOTHING`,
      [handle]
    );
    syncedProfile = storedPerson;
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "auth.sync",
      subjectType: "profile",
      subjectId: handle,
      metadata: { source: actor.source }
    });
    stagedEvent = await stageEvent(client, {
      kind: "profile.updated",
      actorHandle: handle,
      subjectType: "profile",
      subjectId: handle,
      payload: { profile: publicProfile(storedPerson) }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);
  if (!syncedProfile) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The synchronized profile was not returned." });
  }
  return syncedProfile;
};
