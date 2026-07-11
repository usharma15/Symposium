import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  callIdInputSchema,
  createCommunityCallInputSchema,
  joinCommunityInputSchema,
  type CommunityCallContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import {
  actorHandle,
  callRowToContract,
  ensureLiveData,
  ensureProfileHandle,
  getCommunity,
  publicCommunity
} from "./foundation";

export const joinOrRequestCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    return {
      community: community.visibility === "private" ? publicCommunity(community) : community,
      status: community.visibility === "private" ? ("requested" as const) : ("joined" as const)
    };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const requestedStatus = community.visibility === "private" ? "requested" : "active";
    const existingMembership = await client.query<{ status: string }>(
      `SELECT status FROM community_memberships
       WHERE community_id = $1 AND profile_handle = $2
       FOR UPDATE`,
      [community.id, handle]
    );
    if (existingMembership.rows[0]?.status === "blocked") {
      throw new TRPCError({ code: "FORBIDDEN", message: "This community membership is unavailable." });
    }
    const membership = await client.query<{ status: string }>(
      `INSERT INTO community_memberships (community_id, profile_handle, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (community_id, profile_handle) DO UPDATE SET status = EXCLUDED.status
       WHERE community_memberships.status IS DISTINCT FROM EXCLUDED.status
         AND community_memberships.status <> 'active'
       RETURNING status`,
      [community.id, handle, requestedStatus]
    );
    const membershipStatus =
      membership.rows[0]?.status ??
      existingMembership.rows[0]?.status ??
      requestedStatus;
    let updatedCommunity = membershipStatus === "active" ? community : publicCommunity(community);
    if (membershipStatus === "active") {
      await client.query(
        `UPDATE communities
         SET member_handles = CASE
               WHEN member_handles ? $2 THEN member_handles
               ELSE member_handles || to_jsonb($2::text)
             END,
             updated_at = now()
         WHERE id = $1`,
        [community.id, handle]
      );
      updatedCommunity = {
        ...community,
        memberHandles: [...new Set([...community.memberHandles, handle])]
      };
    }
    const value = {
      community: updatedCommunity,
      status: membershipStatus === "active" ? ("joined" as const) : ("requested" as const)
    };
    if (!membership.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: value.status === "requested" ? "community.request" : "community.join",
      subjectType: "community",
      subjectId: community.id,
      metadata: { status: membershipStatus }
    });
    const event = await stageEvent(client, {
      kind: value.status === "requested" ? "community.requested" : "community.joined",
      actorHandle: handle,
      subjectType: "community",
      subjectId: community.id,
      visibility: value.status === "requested" ? "private" : "public",
      payload: { community: updatedCommunity, status: value.status }
    });
    return { value, events: [event] };
  });
};

export const listCommunityCalls = async (communityId: string, actor?: Actor) => {
  const community = await getCommunity(communityId);
  if (!hasDatabase()) return { community, calls: [] as CommunityCallContract[] };
  await ensureLiveData();

  if (community.visibility === "private") {
    const requester = actor?.handle ? cleanHandle(actor.handle) : null;
    if (!requester) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private community calls require membership." });
    }
    const membership = await getPool().query(
      `SELECT 1 FROM community_memberships
       WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
      [community.id, requester]
    );
    if (!membership.rowCount) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private community calls require membership." });
    }
  }

  const result = await getPool().query(
    `SELECT
       c.id,
       c.community_id AS "communityId",
       c.host_handle AS "hostHandle",
       c.title,
       c.kind,
       c.status,
       c.starts_at AS "startsAt",
       c.ended_at AS "endedAt",
       c.provider,
       c.provider_room_id AS "providerRoomId",
       COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS "participantHandles"
     FROM community_calls c
     LEFT JOIN call_participants cp ON cp.call_id = c.id AND cp.left_at IS NULL
     WHERE c.community_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 25`,
    [community.id]
  );

  return { community, calls: result.rows.map(callRowToContract) };
};

const communityAudienceHandles = async (client: PoolClient, communityId: string) => {
  const result = await client.query<{ profileHandle: string }>(
    `SELECT profile_handle AS "profileHandle"
     FROM community_memberships
     WHERE community_id = $1 AND status = 'active'`,
    [communityId]
  );
  return result.rows.map((row) => row.profileHandle);
};

export const createCommunityCall = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityCallInputSchema.parse(rawInput);
  const host = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      communityId: input.communityId,
      hostHandle: host,
      title: input.title,
      kind: input.kind,
      status: "live",
      startsAt: input.startsAt ?? new Date().toISOString(),
      provider: input.provider,
      providerRoomId: input.providerRoomId,
      participantHandles: [host]
    } satisfies CommunityCallContract;
  }

  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<CommunityCallContract>(client, host, mutation);
    if (claim.replayed) return { value: claim.response };
    if (community.visibility === "private") {
      const membership = await client.query(
        `SELECT 1 FROM community_memberships
         WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
        [community.id, host]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Join this private community before hosting a call." });
      }
    }
    const call = await client.query(
      `INSERT INTO community_calls (
         community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id
       )
       VALUES ($1, $2, $3, $4, 'live', COALESCE($5::timestamptz, now()), $6, $7)
       RETURNING
         id,
         community_id AS "communityId",
         host_handle AS "hostHandle",
         title,
         kind,
         status,
         starts_at AS "startsAt",
         ended_at AS "endedAt",
         provider,
         provider_room_id AS "providerRoomId"`,
      [
        input.communityId,
        host,
        input.title,
        input.kind,
        input.startsAt ?? null,
        input.provider ?? null,
        input.providerRoomId ?? null
      ]
    );
    await client.query(
      `INSERT INTO call_participants (call_id, profile_handle, role)
       VALUES ($1, $2, 'host')
       ON CONFLICT (call_id, profile_handle)
       DO UPDATE SET left_at = NULL, role = 'host'`,
      [call.rows[0]!.id, host]
    );
    await client.query(
      `UPDATE communities
       SET call_status = $2, updated_at = now()
       WHERE id = $1`,
      [input.communityId, input.kind === "video" ? "video live" : "voice live"]
    );
    const created = callRowToContract({ ...call.rows[0]!, participantHandles: [host] });
    await stageAuditLog(client, {
      actorHandle: host,
      action: "community.call.create",
      subjectType: "community_call",
      subjectId: created.id,
      metadata: mutationAuditMetadata(mutation, { communityId: input.communityId, kind: input.kind })
    });
    await completeMutation(client, host, mutation, created);
    const event = await stageEvent(client, {
      kind: "community.call.created",
      actorHandle: host,
      subjectType: "community_call",
      subjectId: created.id,
      visibility: community.visibility === "private" ? "community" : "public",
      audienceHandles:
        community.visibility === "private"
          ? await communityAudienceHandles(client, community.id)
          : undefined,
      payload: { communityId: input.communityId, title: input.title, kind: input.kind }
    });
    return { value: created, events: [event] };
  });
};

export const joinCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, profileHandle: handle, status: "joined" };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const call = await client.query<{ communityId: string; status: string; visibility: string }>(
      `SELECT c.community_id AS "communityId", c.status, community.visibility
       FROM community_calls c
       JOIN communities community ON community.id = c.community_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [input.callId]
    );
    const callRow = call.rows[0];
    if (!callRow) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
    if (callRow.status === "ended" || callRow.status === "cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This call has already ended." });
    }
    if (callRow.visibility === "private") {
      const membership = await client.query(
        `SELECT 1 FROM community_memberships
         WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
        [callRow.communityId, handle]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This call belongs to a private community." });
      }
    }
    const joined = await client.query(
      `INSERT INTO call_participants (call_id, profile_handle)
       VALUES ($1, $2)
       ON CONFLICT (call_id, profile_handle)
       DO UPDATE SET left_at = NULL, joined_at = now()
       WHERE call_participants.left_at IS NOT NULL
       RETURNING call_id`,
      [input.callId, handle]
    );
    const value = { callId: input.callId, profileHandle: handle, status: "joined" as const };
    if (!joined.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.call.join",
      subjectType: "community_call",
      subjectId: input.callId,
      metadata: { communityId: callRow.communityId }
    });
    const event = await stageEvent(client, {
      kind: "community.call.joined",
      actorHandle: handle,
      subjectType: "community_call",
      subjectId: input.callId,
      visibility: callRow.visibility === "private" ? "community" : "public",
      audienceHandles:
        callRow.visibility === "private"
          ? await communityAudienceHandles(client, callRow.communityId)
          : undefined,
      payload: { communityId: callRow.communityId }
    });
    return { value, events: [event] };
  });
};

export const endCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, status: "ended" };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const call = await client.query<{
      communityId: string;
      hostHandle: string | null;
      status: string;
      visibility: string;
    }>(
      `SELECT call.community_id AS "communityId", call.host_handle AS "hostHandle",
         call.status, community.visibility
       FROM community_calls call
       JOIN communities community ON community.id = call.community_id
       WHERE call.id = $1
       FOR UPDATE OF call`,
      [input.callId]
    );
    const callRow = call.rows[0];
    if (!callRow) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
    if (!callRow.hostHandle || cleanHandle(callRow.hostHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the call host can end this call." });
    }
    const value = { callId: input.callId, status: "ended" as const };
    if (callRow.status === "ended") return { value };

    await client.query(
      `UPDATE community_calls
       SET status = 'ended', ended_at = now(), updated_at = now()
       WHERE id = $1`,
      [input.callId]
    );
    await client.query("UPDATE call_participants SET left_at = now() WHERE call_id = $1 AND left_at IS NULL", [input.callId]);
    await client.query(
      `UPDATE communities
       SET call_status = 'quiet', updated_at = now()
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM community_calls
           WHERE community_id = $1 AND status = 'live' AND id <> $2
         )`,
      [callRow.communityId, input.callId]
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.call.end",
      subjectType: "community_call",
      subjectId: input.callId,
      metadata: { communityId: callRow.communityId }
    });
    const event = await stageEvent(client, {
      kind: "community.call.ended",
      actorHandle: handle,
      subjectType: "community_call",
      subjectId: input.callId,
      visibility: callRow.visibility === "private" ? "community" : "public",
      audienceHandles:
        callRow.visibility === "private"
          ? await communityAudienceHandles(client, callRow.communityId)
          : undefined,
      payload: { communityId: callRow.communityId }
    });
    return { value, events: [event] };
  });
};
