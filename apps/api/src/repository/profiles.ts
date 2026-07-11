import { TRPCError } from "@trpc/server";
import {
  followProfileInputSchema,
  profileActivityQuerySchema,
  unfollowProfileInputSchema,
  type ProfileActivityResponseContract,
  type ToggleActionContract
} from "../../../../packages/contracts/src";
import { buildLegacyProfileActivity } from "@/lib/profileActivity";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { runAtomic } from "../services/transactions";
import { decodeActivityCursor, listCanonicalProfileActivity } from "./actions";
import { actorHandle, ensureLiveData, ensureProfileHandle, getInitialState } from "./foundation";

export const listProfileActivity = async (
  rawHandle: string,
  rawQuery: unknown,
  actor: Actor
): Promise<ProfileActivityResponseContract> => {
  const handle = cleanHandle(rawHandle);
  const query = profileActivityQuerySchema.parse(rawQuery ?? {});
  if (query.cursor && !decodeActivityCursor(query.cursor)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid profile activity cursor." });
  }

  const requesterHandle = actor.handle ? cleanHandle(actor.handle) : null;

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const person = snapshot.profiles[handle];
    if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
    const ownProfile = requesterHandle === handle;
    const allowedActions: ToggleActionContract[] = [
      ...(ownProfile ? (["save"] as const) : []),
      ...(ownProfile || person.likesPublic !== false ? (["signal"] as const) : []),
      ...(ownProfile || person.resharesPublic !== false ? (["fork"] as const) : [])
    ];
    return {
      entries: buildLegacyProfileActivity(snapshot.items, handle, allowedActions).slice(0, query.limit),
      nextCursor: null
    };
  }

  await ensureLiveData();
  const profileResult = await getPool().query<{ likesPublic: boolean; resharesPublic: boolean }>(
    `SELECT likes_public AS "likesPublic", reshares_public AS "resharesPublic"
     FROM profiles
     WHERE handle = $1
     LIMIT 1`,
    [handle]
  );
  const person = profileResult.rows[0];
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });

  const ownProfile = requesterHandle === handle;
  const allowedActions: ToggleActionContract[] = [
    ...(ownProfile ? (["save"] as const) : []),
    ...(ownProfile || person.likesPublic ? (["signal"] as const) : []),
    ...(ownProfile || person.resharesPublic ? (["fork"] as const) : [])
  ];
  const client = await getPool().connect();
  try {
    return await listCanonicalProfileActivity(client, handle, allowedActions, query, ownProfile);
  } finally {
    client.release();
  }
};

export const followProfile = async (rawInput: unknown, actor: Actor) => {
  const input = followProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor));
  const following = await ensureProfileHandle(input.targetHandle);

  if (follower === following) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot follow yourself." });
  }

  if (!hasDatabase()) {
    return { followerHandle: follower, followingHandle: following, status: input.status };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const result = await client.query(
      `INSERT INTO profile_follows (follower_handle, following_handle, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (follower_handle, following_handle)
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()
       WHERE profile_follows.status IS DISTINCT FROM EXCLUDED.status
       RETURNING follower_handle`,
      [follower, following, input.status]
    );
    const value = { followerHandle: follower, followingHandle: following, status: input.status };
    if (!result.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: follower,
      action: "profile.follow",
      subjectType: "profile",
      subjectId: following,
      metadata: { status: input.status }
    });
    const event = await stageEvent(client, {
      kind: "profile.followed",
      actorHandle: follower,
      subjectType: "profile",
      subjectId: following,
      visibility: input.status === "active" ? "public" : "private",
      payload: { follow: value }
    });
    return { value, events: [event] };
  });
};

export const unfollowProfile = async (rawInput: unknown, actor: Actor) => {
  const input = unfollowProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor, input.actorHandle));
  const following = cleanHandle(input.targetHandle);

  if (hasDatabase()) {
    await ensureLiveData();
    return runAtomic(async (client) => {
      const result = await client.query<{ status: string }>(
        "DELETE FROM profile_follows WHERE follower_handle = $1 AND following_handle = $2 RETURNING status",
        [follower, following]
      );
      const value = { followerHandle: follower, followingHandle: following, status: "none" as const };
      if (!result.rowCount) return { value };
      await stageAuditLog(client, {
        actorHandle: follower,
        action: "profile.unfollow",
        subjectType: "profile",
        subjectId: following
      });
      const event = await stageEvent(client, {
        kind: "profile.unfollowed",
        actorHandle: follower,
        subjectType: "profile",
        subjectId: following,
        visibility: result.rows[0]?.status === "active" ? "public" : "private",
        payload: { follow: value }
      });
      return { value, events: [event] };
    });
  }

  return { followerHandle: follower, followingHandle: following, status: "none" };
};

export const listFollowing = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  return listProfileFollows(handle, true);
};

export const listProfileFollows = async (profileHandle: string, includePrivateStatuses = false) => {
  const handle = await ensureProfileHandle(profileHandle);
  if (!hasDatabase()) return { following: [], followers: [] };
  await ensureLiveData();

  const [following, followers] = await Promise.all([
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE follower_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    ),
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE following_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    )
  ]);

  return { following: following.rows, followers: followers.rows };
};
