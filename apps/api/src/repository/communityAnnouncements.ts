import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import {
  createCommunityAnnouncementInputSchema,
  deleteCommunityAnnouncementInputSchema,
  updateCommunityAnnouncementInputSchema,
  type ResearchCommunityContract
} from "../../../../packages/contracts/src";
import { activeCommunityAnnouncements, type CommunityAnnouncement } from "@/lib/communityAnnouncements";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { assertCommunityManager } from "./communityAuthorization";
import { communityAudienceHandles } from "./communities";
import { actorHandle, ensureLiveData, ensureProfileHandle, getCommunity, publicCommunity } from "./foundation";

const conflict = () => new TRPCError({
  code: "CONFLICT",
  message: "This community changed after it was loaded. Refresh before trying again."
});

const announcementScope = async (
  community: ResearchCommunityContract,
  client?: Parameters<typeof communityAudienceHandles>[0]
) => ({
  visibility: community.visibility === "private" ? "community" as const : "public" as const,
  audienceHandles: community.visibility === "private" && client
    ? await communityAudienceHandles(client, community.id)
    : undefined
});

export const createCommunityAnnouncement = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityAnnouncementInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  const announcement: CommunityAnnouncement = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    authorHandle: handle,
    createdAt: new Date().toISOString()
  };
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    if ((community.revision ?? 1) !== input.expectedRevision) throw conflict();
    const value = publicCommunity({
      ...community,
      announcements: [announcement, ...activeCommunityAnnouncements(community.announcements)],
      revision: input.expectedRevision + 1,
      viewerRole: manager.role
    }, "active");
    return { community: value, announcement };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; announcement: CommunityAnnouncement }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const manager = await client.query<{ role: string; revision: number; announcements: CommunityAnnouncement[] }>(
      `SELECT membership.role, community.revision, community.announcements
       FROM community_memberships membership JOIN communities community ON community.id = membership.community_id
       WHERE membership.community_id = $1 AND membership.profile_handle = $2 AND membership.status = 'active'
       FOR UPDATE OF community`,
      [community.id, handle]
    );
    const role = manager.rows[0]?.role;
    if (role !== "owner" && role !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can publish announcements." });
    if (manager.rows[0]?.revision !== input.expectedRevision) throw conflict();
    const announcements = [announcement, ...activeCommunityAnnouncements(manager.rows[0]?.announcements)];
    const updated = await client.query<{ revision: number }>(
      `UPDATE communities SET announcements = $2::jsonb, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3 RETURNING revision`,
      [community.id, JSON.stringify(announcements), input.expectedRevision]
    );
    if (!updated.rows[0]) throw conflict();
    const value = publicCommunity({ ...community, announcements, revision: updated.rows[0].revision, viewerRole: role }, "active");
    const response = { community: value, announcement };
    await stageAuditLog(client, { actorHandle: handle, action: "community.announcement.create", subjectType: "community", subjectId: community.id, metadata: mutationAuditMetadata(mutation, { announcementId: announcement.id }) });
    await completeMutation(client, handle, mutation, response);
    const scope = await announcementScope(community, client);
    const event = await stageEvent(client, { kind: "community.announcement.created", actorHandle: handle, subjectType: "community", subjectId: community.id, ...scope, payload: { communityId: community.id, announcementId: announcement.id, revision: value.revision } });
    return { value: response, events: [event] };
  });
};

export const updateCommunityAnnouncement = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = updateCommunityAnnouncementInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    if ((community.revision ?? 1) !== input.expectedRevision) throw conflict();
    const announcements = activeCommunityAnnouncements(community.announcements);
    const current = announcements.find((announcement) => announcement.id === input.announcementId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found." });
    const announcement = { ...current, title: input.title, body: input.body, updatedAt: new Date().toISOString(), updatedByHandle: handle };
    return {
      community: publicCommunity({ ...community, announcements: announcements.map((candidate) => candidate.id === announcement.id ? announcement : candidate), revision: input.expectedRevision + 1, viewerRole: manager.role }, "active"),
      announcement
    };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; announcement: CommunityAnnouncement }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const manager = await client.query<{ role: string; revision: number; announcements: CommunityAnnouncement[] }>(
      `SELECT membership.role, community.revision, community.announcements
       FROM community_memberships membership JOIN communities community ON community.id = membership.community_id
       WHERE membership.community_id = $1 AND membership.profile_handle = $2 AND membership.status = 'active'
       FOR UPDATE OF community`,
      [community.id, handle]
    );
    const role = manager.rows[0]?.role;
    if (role !== "owner" && role !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can edit announcements." });
    if (manager.rows[0]?.revision !== input.expectedRevision) throw conflict();
    const announcements = activeCommunityAnnouncements(manager.rows[0]?.announcements);
    const current = announcements.find((announcement) => announcement.id === input.announcementId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found." });
    const announcement = { ...current, title: input.title, body: input.body, updatedAt: new Date().toISOString(), updatedByHandle: handle };
    const nextAnnouncements = announcements.map((candidate) => candidate.id === announcement.id ? announcement : candidate);
    const updated = await client.query<{ revision: number }>(
      `UPDATE communities SET announcements = $2::jsonb, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3 RETURNING revision`,
      [community.id, JSON.stringify(nextAnnouncements), input.expectedRevision]
    );
    if (!updated.rows[0]) throw conflict();
    const value = publicCommunity({ ...community, announcements: nextAnnouncements, revision: updated.rows[0].revision, viewerRole: role }, "active");
    const response = { community: value, announcement };
    await stageAuditLog(client, { actorHandle: handle, action: "community.announcement.update", subjectType: "community_announcement", subjectId: announcement.id, metadata: mutationAuditMetadata(mutation, { communityId: community.id }) });
    await completeMutation(client, handle, mutation, response);
    const scope = await announcementScope(community, client);
    const event = await stageEvent(client, { kind: "community.announcement.updated", actorHandle: handle, subjectType: "community", subjectId: community.id, ...scope, payload: { communityId: community.id, announcementId: announcement.id, revision: value.revision } });
    return { value: response, events: [event] };
  });
};

export const deleteCommunityAnnouncement = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = deleteCommunityAnnouncementInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    const manager = await assertCommunityManager(community.id, handle);
    if ((community.revision ?? 1) !== input.expectedRevision) throw conflict();
    const announcements = activeCommunityAnnouncements(community.announcements);
    if (!announcements.some((announcement) => announcement.id === input.announcementId)) throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found." });
    return {
      community: publicCommunity({ ...community, announcements: announcements.filter((announcement) => announcement.id !== input.announcementId), revision: input.expectedRevision + 1, viewerRole: manager.role }, "active"),
      deletedAnnouncementId: input.announcementId
    };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ community: ResearchCommunityContract; deletedAnnouncementId: string }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const manager = await client.query<{ role: string; revision: number; announcements: CommunityAnnouncement[] }>(
      `SELECT membership.role, community.revision, community.announcements
       FROM community_memberships membership JOIN communities community ON community.id = membership.community_id
       WHERE membership.community_id = $1 AND membership.profile_handle = $2 AND membership.status = 'active'
       FOR UPDATE OF community`,
      [community.id, handle]
    );
    const role = manager.rows[0]?.role;
    if (role !== "owner" && role !== "moderator") throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can delete announcements." });
    if (manager.rows[0]?.revision !== input.expectedRevision) throw conflict();
    const announcements = activeCommunityAnnouncements(manager.rows[0]?.announcements);
    if (!announcements.some((announcement) => announcement.id === input.announcementId)) throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found." });
    const nextAnnouncements = announcements.filter((announcement) => announcement.id !== input.announcementId);
    const updated = await client.query<{ revision: number }>(
      `UPDATE communities SET announcements = $2::jsonb, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3 RETURNING revision`,
      [community.id, JSON.stringify(nextAnnouncements), input.expectedRevision]
    );
    if (!updated.rows[0]) throw conflict();
    const value = publicCommunity({ ...community, announcements: nextAnnouncements, revision: updated.rows[0].revision, viewerRole: role }, "active");
    const response = { community: value, deletedAnnouncementId: input.announcementId };
    await stageAuditLog(client, { actorHandle: handle, action: "community.announcement.delete", subjectType: "community_announcement", subjectId: input.announcementId, metadata: mutationAuditMetadata(mutation, { communityId: community.id }) });
    await completeMutation(client, handle, mutation, response);
    const scope = await announcementScope(community, client);
    const event = await stageEvent(client, { kind: "community.announcement.deleted", actorHandle: handle, subjectType: "community", subjectId: community.id, ...scope, payload: { communityId: community.id, announcementId: input.announcementId, revision: value.revision } });
    return { value: response, events: [event] };
  });
};
