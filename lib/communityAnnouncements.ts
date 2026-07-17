import type { ResearchCommunityContract } from "@/packages/contracts/src";

export const communityAnnouncementRetentionMs = 30 * 24 * 60 * 60 * 1000;

export type CommunityAnnouncement = NonNullable<ResearchCommunityContract["announcements"]>[number];

export const communityAnnouncementExpiresAt = (announcement: CommunityAnnouncement) => {
  if (!announcement.createdAt) return null;
  const createdAt = Date.parse(announcement.createdAt);
  return Number.isFinite(createdAt) ? createdAt + communityAnnouncementRetentionMs : null;
};

export const communityAnnouncementIsActive = (announcement: CommunityAnnouncement, now = Date.now()) => {
  const expiresAt = communityAnnouncementExpiresAt(announcement);
  return expiresAt !== null && expiresAt > now;
};

export const activeCommunityAnnouncements = (
  announcements: CommunityAnnouncement[] | undefined,
  now = Date.now()
) => (announcements ?? [])
  .filter((announcement) => communityAnnouncementIsActive(announcement, now))
  .sort((first, second) => (second.createdAt ?? "").localeCompare(first.createdAt ?? ""));
