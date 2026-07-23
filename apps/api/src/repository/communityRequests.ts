import { TRPCError } from "@trpc/server";
import {
  resolveCommunityRequestInputSchema,
  type ResearchCommunityContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { createNotifications, resolveNotifications } from "../services/notificationDelivery";
import { assertCommunityManager } from "./communityAuthorization";
import { actorHandle, ensureLiveData, ensureProfileHandle, getCommunity, publicCommunity } from "./foundation";

export const resolveCommunityRequest = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = resolveCommunityRequestInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const memberHandle = cleanHandle(input.memberHandle);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    await assertCommunityManager(community.id, handle);
    throw new TRPCError({ code: "NOT_FOUND", message: "Join request not found." });
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{
      community: ResearchCommunityContract;
      request: { handle: string; decision: "approve" | "decline" };
    }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const locked = await client.query<{ actorRole: string; revision: number }>(
      `SELECT actor.role AS "actorRole", community.revision
       FROM communities community
       JOIN community_memberships actor ON actor.community_id = community.id AND actor.profile_handle = $2 AND actor.status = 'active'
       JOIN community_memberships target ON target.community_id = community.id AND target.profile_handle = $3 AND target.status = 'requested'
       WHERE community.id = $1
       FOR UPDATE OF community, target`,
      [community.id, handle, memberHandle]
    );
    const row = locked.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Join request not found." });
    if (row.actorRole !== "owner" && row.actorRole !== "moderator") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can review join requests." });
    }
    if (row.revision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    }
    await client.query(
      `UPDATE community_memberships
       SET status = $3,
           role = 'member',
           created_at = CASE WHEN $3 = 'active' THEN now() ELSE created_at END,
           last_accessed_at = CASE WHEN $3 = 'active' THEN now() ELSE last_accessed_at END,
           updated_at = now()
       WHERE community_id = $1 AND profile_handle = $2 AND status = 'requested'`,
      [community.id, memberHandle, input.decision === "approve" ? "active" : "rejected"]
    );
    const updated = await client.query<{ memberHandles: string[]; revision: number }>(
      `UPDATE communities
       SET member_handles = CASE
             WHEN $3 = 'approve' AND NOT (member_handles ? $2) THEN member_handles || to_jsonb($2::text)
             ELSE member_handles
           END,
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1 AND revision = $4
       RETURNING member_handles AS "memberHandles", revision`,
      [community.id, memberHandle, input.decision, input.expectedRevision]
    );
    const next = updated.rows[0];
    if (!next) throw new TRPCError({ code: "CONFLICT", message: "This community changed before the request decision committed." });
    const value = publicCommunity({
      ...community,
      memberHandles: next.memberHandles,
      memberCount: (community.memberCount ?? community.memberHandles.length) + (input.decision === "approve" ? 1 : 0),
      revision: next.revision,
      viewerRole: row.actorRole as "owner" | "moderator"
    }, "active");
    const response = { community: value, request: { handle: memberHandle, decision: input.decision } };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: `community.request.${input.decision}`,
      subjectType: "community_membership",
      subjectId: `${community.id}:${memberHandle}`,
      metadata: mutationAuditMetadata(mutation, { communityId: community.id, decision: input.decision })
    });
    await completeMutation(client, handle, mutation, response);
    const resolvedNotifications = await resolveNotifications(client, {
      kinds: ["community_join_request"],
      metadataMatches: [{ communityId: community.id, requesterHandle: memberHandle }],
      reason: `community_request_${input.decision}d`
    });
    const createdNotifications = await createNotifications(client, [{
      profileHandle: memberHandle,
      kind: input.decision === "approve" ? "community_request_approved" : "community_request_declined",
      title: input.decision === "approve"
        ? `Your request to join ${community.name} was approved`
        : `Your request to join ${community.name} was declined`,
      body: input.decision === "approve"
        ? "You now have access to the community."
        : "The community remains private.",
      href: input.decision === "approve"
        ? `/communities/${encodeURIComponent(community.id)}`
        : "/communities",
      dedupeKey: `community-request-${input.decision}:${community.id}:${memberHandle}:${value.revision}`,
      metadata: { communityId: community.id, decision: input.decision, reviewedByHandle: handle }
    }]);
    const audience = await client.query<{ profileHandle: string }>(
      `SELECT profile_handle AS "profileHandle" FROM community_memberships WHERE community_id = $1 AND status = 'active'`,
      [community.id]
    );
    const audienceHandles = community.visibility === "private"
      ? [...new Set([...audience.rows.map((entry) => entry.profileHandle), memberHandle])]
      : undefined;
    const event = await stageEvent(client, {
      kind: `community.request.${input.decision}d`,
      actorHandle: handle,
      subjectType: "community",
      subjectId: community.id,
      visibility: community.visibility === "private" ? "community" : "public",
      audienceHandles,
      payload: { communityId: community.id, memberHandle, decision: input.decision, revision: value.revision }
    });
    return {
      value: response,
      events: [...resolvedNotifications.events, ...createdNotifications.events, event]
    };
  });
};
