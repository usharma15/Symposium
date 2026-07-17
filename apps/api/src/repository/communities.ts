import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  callIdInputSchema,
  createCommunityAnnouncementInputSchema,
  createCommunityInputSchema,
  createCommunityCallInputSchema,
  joinCommunityInputSchema,
  removeCommunityMemberInputSchema,
  updateCommunityMemberInputSchema,
  updateCommunitySettingsInputSchema,
  type CommunityCallContract,
  type ResearchCommunityContract,
  type UpdateCommunitySettingsInputContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { assertCommunityManager } from "./communityAuthorization";
import {
  actorHandle,
  callRowToContract,
  ensureLiveData,
  ensureProfileHandle,
  getCommunity,
  seedSnapshot,
  publicCommunity
} from "./foundation";

const communitySlug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || `community-${randomUUID().slice(0, 8)}`;

export const assertCommunityReadAccess = async (communityId: string, rawHandle?: string | null) => {
  const community = await getCommunity(communityId);
  if (community.visibility === "public") return community;
  const handle = rawHandle ? cleanHandle(rawHandle) : null;
  if (!handle) throw new TRPCError({ code: "FORBIDDEN", message: "This private community requires membership." });
  if (!hasDatabase()) {
    if (community.memberHandles.some((member) => cleanHandle(member) === handle)) return community;
    throw new TRPCError({ code: "FORBIDDEN", message: "This private community requires membership." });
  }
  const membership = await getPool().query(
    `SELECT 1 FROM community_memberships
     WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
    [community.id, handle]
  );
  if (!membership.rowCount) throw new TRPCError({ code: "FORBIDDEN", message: "This private community requires membership." });
  return community;
};

export const assertCommunityParticipation = async (communityId: string, rawHandle: string) => {
  const community = await getCommunity(communityId);
  const handle = cleanHandle(rawHandle);
  if (!hasDatabase()) {
    if (community.memberHandles.some((member) => cleanHandle(member) === handle)) return community;
    throw new TRPCError({ code: "FORBIDDEN", message: "Join this community before participating." });
  }
  const membership = await getPool().query(
    `SELECT 1 FROM community_memberships
     WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
    [community.id, handle]
  );
  if (!membership.rowCount) throw new TRPCError({ code: "FORBIDDEN", message: "Join this community before participating." });
  return community;
};

export const createCommunity = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityInputSchema.parse(rawInput);
  const owner = await ensureProfileHandle(actorHandle(actor));
  const moderatorHandles = Array.from(new Set([owner, ...input.moderatorHandles.map(cleanHandle)]));
  const baseId = communitySlug(input.name);
  const seeded: ResearchCommunityContract = {
    id: baseId,
    revision: 1,
    name: input.name,
    field: input.field,
    summary: input.summary,
    visibility: input.visibility,
    online: 1,
    memberHandles: [owner],
    keywords: Array.from(new Set([input.name, input.field, ...input.keywords].map((value) => value.toLowerCase()))),
    seedCounts: { papers: 0, thoughts: 0, opportunities: 0 },
    callStatus: "quiet",
    memberCount: 1,
    monthlyActive: 1,
    membershipStatus: "active",
    viewerRole: "owner",
    ownerHandle: owner,
    lastAccessedAt: new Date().toISOString(),
    moderatorHandles,
    guidelines: input.guidelines || "Keep criticism attached to the work, preserve sources, and leave a legible trail when claims change.",
    announcements: []
  };
  if (!hasDatabase()) return seeded;

  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<ResearchCommunityContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    let id = baseId;
    const collision = await client.query("SELECT 1 FROM communities WHERE id = $1", [id]);
    if (collision.rowCount) id = `${baseId}-${randomUUID().slice(0, 6)}`;
    const createdAt = new Date().toISOString();
    const community = { ...seeded, id, lastAccessedAt: createdAt };
    await client.query(
      `INSERT INTO communities (
         id, name, field, summary, visibility, online, member_handles, keywords, seed_counts,
         call_status, moderator_handles, guidelines, announcements
       ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, 'quiet', $9, $10, '[]'::jsonb)`,
      [
        id,
        input.name,
        input.field,
        input.summary,
        input.visibility,
        JSON.stringify([owner]),
        JSON.stringify(community.keywords),
        JSON.stringify(community.seedCounts),
        JSON.stringify(moderatorHandles),
        community.guidelines
      ]
    );
    await client.query(
      `INSERT INTO community_memberships (
         community_id, profile_handle, role, status, last_accessed_at, updated_at
       ) VALUES ($1, $2, 'owner', 'active', $3, $3)`,
      [id, owner, createdAt]
    );
    for (const channel of ["feed", "papers", "calls", "announcements", "members"]) {
      await client.query(
        `INSERT INTO community_channels (community_id, kind, name)
         VALUES ($1, $2, $2)
         ON CONFLICT (community_id, kind, name) DO NOTHING`,
        [id, channel]
      );
    }
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "community.create",
      subjectType: "community",
      subjectId: id,
      metadata: mutationAuditMetadata(mutation, { visibility: input.visibility })
    });
    await completeMutation(client, owner, mutation, community);
    const event = await stageEvent(client, {
      kind: "community.created",
      actorHandle: owner,
      subjectType: "community",
      subjectId: id,
      visibility: input.visibility === "private" ? "private" : "public",
      audienceHandles: input.visibility === "private" ? [owner] : undefined,
      payload: { community }
    });
    return { value: community, events: [event] };
  });
};

export const updateCommunitySettings = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: UpdateCommunitySettingsInputContract = updateCommunitySettingsInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    if ((community.revision ?? 1) !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    }
    const changed = (input.name !== undefined && input.name !== community.name)
      || (input.summary !== undefined && input.summary !== community.summary)
      || (input.guidelines !== undefined && input.guidelines !== (community.guidelines ?? ""))
      || (input.visibility !== undefined && input.visibility !== community.visibility);
    return publicCommunity({
      ...community,
      name: input.name ?? community.name,
      summary: input.summary ?? community.summary,
      guidelines: input.guidelines ?? community.guidelines,
      visibility: input.visibility ?? community.visibility,
      revision: changed ? input.expectedRevision + 1 : input.expectedRevision,
      viewerRole: manager.role
    }, "active");
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<ResearchCommunityContract>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const membership = await client.query<{ role: string; revision: number; name: string; summary: string; guidelines: string; visibility: ResearchCommunityContract["visibility"] }>(
      `SELECT membership.role, community.revision, community.name, community.summary, community.guidelines, community.visibility
       FROM community_memberships membership
       JOIN communities community ON community.id = membership.community_id
       WHERE membership.community_id = $1 AND membership.profile_handle = $2 AND membership.status = 'active'
       FOR UPDATE OF community`,
      [community.id, handle]
    );
    const role = membership.rows[0]?.role;
    if (role !== "owner" && role !== "moderator") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can manage this community." });
    }
    const currentRevision = membership.rows[0]?.revision ?? community.revision ?? 1;
    const currentName = membership.rows[0]?.name ?? community.name;
    const currentSummary = membership.rows[0]?.summary ?? community.summary;
    const currentGuidelines = membership.rows[0]?.guidelines ?? community.guidelines ?? "";
    const currentVisibility = membership.rows[0]?.visibility ?? community.visibility;
    if (currentRevision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    }
    let revision = currentRevision;
    const name = input.name ?? currentName;
    const summary = input.summary ?? currentSummary;
    const guidelines = input.guidelines ?? currentGuidelines;
    const visibility = input.visibility ?? currentVisibility;
    const changed = name !== currentName || summary !== currentSummary || guidelines !== currentGuidelines || visibility !== currentVisibility;
    if (changed) {
      const updated = await client.query<{ revision: number }>(
        `UPDATE communities
         SET name = $2, summary = $3, guidelines = $4, visibility = $5,
             revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $6
         RETURNING revision`,
        [community.id, name, summary, guidelines, visibility, input.expectedRevision]
      );
      if (!updated.rows[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "This community changed before the update committed." });
      }
      revision = updated.rows[0].revision;
    }
    const value = publicCommunity({
      ...community,
      name,
      summary,
      guidelines,
      visibility,
      revision,
      viewerRole: role
    }, "active");
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.settings.update",
      subjectType: "community",
      subjectId: community.id,
      metadata: mutationAuditMetadata(mutation, { previousVisibility: currentVisibility, visibility, revision, nameChanged: name !== currentName, summaryChanged: summary !== currentSummary, guidelinesChanged: guidelines !== currentGuidelines })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "community.settings.updated",
      actorHandle: handle,
      subjectType: "community",
      subjectId: community.id,
      visibility: "public",
      payload: { communityId: community.id, visibility, revision }
    });
    return { value, events: [event] };
  });
};

export const updateCommunityMember = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = updateCommunityMemberInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const memberHandle = cleanHandle(input.memberHandle);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    const owner = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
    if (!community.memberHandles.some((member) => cleanHandle(member) === memberHandle)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Community member not found." });
    }
    if (memberHandle === owner) throw new TRPCError({ code: "FORBIDDEN", message: "The community owner cannot be reassigned." });
    if ((community.revision ?? 1) !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    const moderators = new Set((community.moderatorHandles ?? []).map(cleanHandle));
    if (input.role === "moderator") moderators.add(memberHandle);
    else moderators.delete(memberHandle);
    moderators.add(owner);
    const value = publicCommunity({ ...community, moderatorHandles: [...moderators], revision: input.expectedRevision + 1, viewerRole: manager.role }, "active");
    return { community: value, member: { handle: memberHandle, role: input.role } };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; member: { handle: string; role: "moderator" | "member" } }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const locked = await client.query<{ actorRole: string; targetRole: string; revision: number }>(
      `SELECT actor.role AS "actorRole", target.role AS "targetRole", community.revision
       FROM communities community
       JOIN community_memberships actor ON actor.community_id = community.id AND actor.profile_handle = $2 AND actor.status = 'active'
       JOIN community_memberships target ON target.community_id = community.id AND target.profile_handle = $3 AND target.status = 'active'
       WHERE community.id = $1
       FOR UPDATE OF community, target`,
      [community.id, handle, memberHandle]
    );
    const row = locked.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Community member not found." });
    if (row.actorRole !== "owner" && row.actorRole !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can manage members." });
    if (row.targetRole === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "The community owner cannot be reassigned." });
    if (row.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    await client.query(
      `UPDATE community_memberships SET role = $3, updated_at = now()
       WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
      [community.id, memberHandle, input.role]
    );
    const updated = await client.query<{ moderatorHandles: string[]; revision: number }>(
      `UPDATE communities SET
         moderator_handles = (
           SELECT COALESCE(jsonb_agg(membership.profile_handle ORDER BY membership.created_at, membership.profile_handle), '[]'::jsonb)
           FROM community_memberships membership
           WHERE membership.community_id = communities.id AND membership.status = 'active' AND membership.role IN ('owner', 'moderator')
         ),
         revision = revision + 1,
         updated_at = now()
       WHERE id = $1 AND revision = $2
       RETURNING moderator_handles AS "moderatorHandles", revision`,
      [community.id, input.expectedRevision]
    );
    if (!updated.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This community changed before the member update committed." });
    const value = publicCommunity({ ...community, moderatorHandles: updated.rows[0].moderatorHandles, revision: updated.rows[0].revision, viewerRole: row.actorRole as "owner" | "moderator" }, "active");
    const response = { community: value, member: { handle: memberHandle, role: input.role } };
    await stageAuditLog(client, { actorHandle: handle, action: "community.member.role.update", subjectType: "community_membership", subjectId: `${community.id}:${memberHandle}`, metadata: mutationAuditMetadata(mutation, { previousRole: row.targetRole, role: input.role, communityId: community.id }) });
    await completeMutation(client, handle, mutation, response);
    const event = await stageEvent(client, { kind: "community.member.role.updated", actorHandle: handle, subjectType: "community", subjectId: community.id, visibility: community.visibility === "private" ? "community" : "public", audienceHandles: community.visibility === "private" ? await communityAudienceHandles(client, community.id) : undefined, payload: { communityId: community.id, member: response.member, revision: value.revision } });
    return { value: response, events: [event] };
  });
};

export const removeCommunityMember = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = removeCommunityMemberInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const memberHandle = cleanHandle(input.memberHandle);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    const owner = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
    if (memberHandle === owner) throw new TRPCError({ code: "FORBIDDEN", message: "The community owner cannot be removed." });
    if ((community.revision ?? 1) !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    const members = community.memberHandles.filter((member) => cleanHandle(member) !== memberHandle);
    const moderators = (community.moderatorHandles ?? []).filter((member) => cleanHandle(member) !== memberHandle);
    return { community: publicCommunity({ ...community, memberHandles: members, memberCount: Math.max(0, (community.memberCount ?? community.memberHandles.length) - 1), moderatorHandles: moderators, revision: input.expectedRevision + 1, viewerRole: manager.role }, "active"), removedHandle: memberHandle };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; removedHandle: string }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const locked = await client.query<{ actorRole: string; targetRole: string; revision: number }>(
      `SELECT actor.role AS "actorRole", target.role AS "targetRole", community.revision
       FROM communities community
       JOIN community_memberships actor ON actor.community_id = community.id AND actor.profile_handle = $2 AND actor.status = 'active'
       JOIN community_memberships target ON target.community_id = community.id AND target.profile_handle = $3 AND target.status = 'active'
       WHERE community.id = $1
       FOR UPDATE OF community, target`,
      [community.id, handle, memberHandle]
    );
    const row = locked.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Community member not found." });
    if (row.actorRole !== "owner" && row.actorRole !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can remove members." });
    if (row.targetRole === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "The community owner cannot be removed." });
    if (row.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    await client.query(`UPDATE community_memberships SET status = 'removed', updated_at = now() WHERE community_id = $1 AND profile_handle = $2`, [community.id, memberHandle]);
    const updated = await client.query<{ moderatorHandles: string[]; memberHandles: string[]; revision: number }>(
      `UPDATE communities SET
         member_handles = member_handles - $2,
         moderator_handles = moderator_handles - $2,
         revision = revision + 1,
         updated_at = now()
       WHERE id = $1 AND revision = $3
       RETURNING member_handles AS "memberHandles", moderator_handles AS "moderatorHandles", revision`,
      [community.id, memberHandle, input.expectedRevision]
    );
    if (!updated.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This community changed before the removal committed." });
    const value = publicCommunity({ ...community, memberHandles: updated.rows[0].memberHandles, memberCount: Math.max(0, (community.memberCount ?? community.memberHandles.length) - 1), moderatorHandles: updated.rows[0].moderatorHandles, revision: updated.rows[0].revision, viewerRole: row.actorRole as "owner" | "moderator" }, "active");
    const response = { community: value, removedHandle: memberHandle };
    await stageAuditLog(client, { actorHandle: handle, action: "community.member.remove", subjectType: "community_membership", subjectId: `${community.id}:${memberHandle}`, metadata: mutationAuditMetadata(mutation, { previousRole: row.targetRole, communityId: community.id }) });
    await completeMutation(client, handle, mutation, response);
    const audienceHandles = community.visibility === "private"
      ? [...new Set([...(await communityAudienceHandles(client, community.id)), memberHandle])]
      : undefined;
    const event = await stageEvent(client, { kind: "community.member.removed", actorHandle: handle, subjectType: "community", subjectId: community.id, visibility: community.visibility === "private" ? "community" : "public", audienceHandles, payload: { communityId: community.id, removedHandle: memberHandle, revision: value.revision } });
    return { value: response, events: [event] };
  });
};

export const createCommunityAnnouncement = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityAnnouncementInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  const announcement = { id: randomUUID(), title: input.title, body: input.body, authorHandle: handle, createdAt: new Date().toISOString() };
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    if ((community.revision ?? 1) !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    const value = publicCommunity({ ...community, announcements: [announcement, ...(community.announcements ?? [])], revision: input.expectedRevision + 1, viewerRole: manager.role }, "active");
    return { community: value, announcement };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; announcement: typeof announcement }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const manager = await client.query<{ role: string; revision: number }>(
      `SELECT membership.role, community.revision
       FROM community_memberships membership JOIN communities community ON community.id = membership.community_id
       WHERE membership.community_id = $1 AND membership.profile_handle = $2 AND membership.status = 'active'
       FOR UPDATE OF community`,
      [community.id, handle]
    );
    const role = manager.rows[0]?.role;
    if (role !== "owner" && role !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can publish announcements." });
    if (manager.rows[0]?.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This community changed after it was loaded. Refresh before trying again." });
    const updated = await client.query<{ announcements: typeof community.announcements; revision: number }>(
      `UPDATE communities SET announcements = $2::jsonb || announcements, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3 RETURNING announcements, revision`,
      [community.id, JSON.stringify([announcement]), input.expectedRevision]
    );
    if (!updated.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This community changed before the announcement committed." });
    const value = publicCommunity({ ...community, announcements: updated.rows[0].announcements ?? [], revision: updated.rows[0].revision, viewerRole: role }, "active");
    const response = { community: value, announcement };
    await stageAuditLog(client, { actorHandle: handle, action: "community.announcement.create", subjectType: "community", subjectId: community.id, metadata: mutationAuditMetadata(mutation, { announcementId: announcement.id }) });
    await completeMutation(client, handle, mutation, response);
    const event = await stageEvent(client, { kind: "community.announcement.created", actorHandle: handle, subjectType: "community", subjectId: community.id, visibility: community.visibility === "private" ? "community" : "public", audienceHandles: community.visibility === "private" ? await communityAudienceHandles(client, community.id) : undefined, payload: { communityId: community.id, announcementId: announcement.id, revision: value.revision } });
    return { value: response, events: [event] };
  });
};

export const joinOrRequestCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const status = community.visibility === "private" ? "requested" as const : "active" as const;
    return {
      community: publicCommunity({
        ...community,
        membershipStatus: status,
        memberHandles: status === "active" ? [...new Set([...community.memberHandles, handle])] : community.memberHandles
      }, status),
      status: status === "requested" ? ("requested" as const) : ("joined" as const)
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
       ON CONFLICT (community_id, profile_handle) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = now(),
         last_accessed_at = CASE WHEN EXCLUDED.status = 'active' THEN now() ELSE community_memberships.last_accessed_at END
       WHERE community_memberships.status IS DISTINCT FROM EXCLUDED.status
         AND community_memberships.status <> 'active'
       RETURNING status`,
      [community.id, handle, requestedStatus]
    );
    const membershipStatus =
      membership.rows[0]?.status ??
      existingMembership.rows[0]?.status ??
      requestedStatus;
    let updatedCommunity = membershipStatus === "active" ? community : publicCommunity(community, "requested");
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
        memberHandles: [...new Set([...community.memberHandles, handle])],
        memberCount: (community.memberCount ?? community.memberHandles.length) + (existingMembership.rows[0]?.status === "active" ? 0 : 1),
        membershipStatus: "active",
        lastAccessedAt: new Date().toISOString()
      };
    }
    const projectedCommunity = publicCommunity(
      updatedCommunity,
      membershipStatus === "active" ? "active" : "requested"
    );
    const value = {
      community: projectedCommunity,
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
      payload: { community: projectedCommunity, status: value.status }
    });
    return { value, events: [event] };
  });
};

export const leaveCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    if (cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "") === handle) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The community owner cannot leave without transferring ownership." });
    }
    return {
      community: publicCommunity({
        ...community,
        memberHandles: community.memberHandles.filter((member) => cleanHandle(member) !== handle),
        memberCount: Math.max(0, (community.memberCount ?? community.memberHandles.length) - 1)
      }, "none"),
      status: "left" as const
    };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const existing = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM community_memberships
       WHERE community_id = $1 AND profile_handle = $2 FOR UPDATE`,
      [community.id, handle]
    );
    if (existing.rows[0]?.role === "owner" && existing.rows[0]?.status === "active") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The community owner cannot leave without transferring ownership." });
    }
    const membership = await client.query<{ status: string }>(
      `UPDATE community_memberships SET status = 'removed', updated_at = now()
       WHERE community_id = $1 AND profile_handle = $2 AND status IN ('active', 'requested', 'invited')
       RETURNING status`,
      [community.id, handle]
    );
    if (!membership.rowCount) {
      return { value: { community: publicCommunity(community, "none"), status: "left" as const } };
    }
    await client.query(
      `UPDATE communities
       SET member_handles = member_handles - $2, revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [community.id, handle]
    );
    const updatedCommunity = publicCommunity({
      ...community,
      memberHandles: community.memberHandles.filter((member) => cleanHandle(member) !== handle),
      memberCount: Math.max(0, (community.memberCount ?? community.memberHandles.length) - 1)
    }, "none");
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.leave",
      subjectType: "community",
      subjectId: community.id
    });
    const event = await stageEvent(client, {
      kind: "community.left",
      actorHandle: handle,
      subjectType: "community",
      subjectId: community.id,
      visibility: "private",
      audienceHandles: [handle],
      payload: { communityId: community.id, status: "left" }
    });
    return { value: { community: updatedCommunity, status: "left" as const }, events: [event] };
  });
};

export const listCommunityCalls = async (communityId: string, actor?: Actor) => {
  const community = await getCommunity(communityId);
  const requester = actor?.handle ? cleanHandle(actor.handle) : null;
  let membershipStatus: ResearchCommunityContract["membershipStatus"] =
    requester && community.memberHandles.some((member) => cleanHandle(member) === requester) ? "active" : "none";
  if (!hasDatabase()) {
    if (community.visibility === "private" && membershipStatus !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private community calls require membership." });
    }
    return {
      community: publicCommunity(community, membershipStatus),
      calls: seedSnapshot().communityCalls?.[community.id] ?? []
    };
  }
  await ensureLiveData();

  if (community.visibility === "private") {
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
    membershipStatus = "active";
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

  return {
    community: publicCommunity(community, membershipStatus),
    calls: result.rows.map(callRowToContract)
  };
};

export const communityAudienceHandles = async (client: PoolClient, communityId: string) => {
  const result = await client.query<{ profileHandle: string }>(
    `SELECT profile_handle AS "profileHandle"
     FROM community_memberships
     WHERE community_id = $1 AND status = 'active'`,
    [communityId]
  );
  return result.rows.map((row) => row.profileHandle);
};

export const communityEventScope = async (client: PoolClient, communityId?: string | null) => {
  if (!communityId) return { visibility: "public" as const, audienceHandles: undefined };
  const result = await client.query<{ visibility: string }>("SELECT visibility FROM communities WHERE id = $1", [communityId]);
  if (result.rows[0]?.visibility !== "private") return { visibility: "public" as const, audienceHandles: undefined };
  return {
    visibility: "community" as const,
    audienceHandles: await communityAudienceHandles(client, communityId)
  };
};

export const stageCommunityProfileInvalidation = async (
  client: PoolClient,
  profileHandle: string,
  privateCommunity: boolean,
  stagedEvents: StoredLiveEvent[]
) => {
  if (!privateCommunity) return;
  stagedEvents.push(await stageEvent(client, {
    kind: "profile.activity-counts.changed",
    subjectType: "profile",
    subjectId: cleanHandle(profileHandle),
    visibility: "public",
    payload: { profileHandle: cleanHandle(profileHandle) }
  }));
};

export const createCommunityCall = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityCallInputSchema.parse(rawInput);
  const host = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  await assertCommunityParticipation(input.communityId, host);
  const status = input.startsAt && Date.parse(input.startsAt) > Date.now() ? "scheduled" as const : "live" as const;

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      communityId: input.communityId,
      hostHandle: host,
      title: input.title,
      kind: input.kind,
      status,
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
    const call = await client.query(
      `INSERT INTO community_calls (
         community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8)
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
        status,
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
    if (status === "live") {
      await client.query(
        `UPDATE communities
         SET call_status = $2, updated_at = now()
         WHERE id = $1`,
        [input.communityId, input.kind === "video" ? "video live" : "voice live"]
      );
    }
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
