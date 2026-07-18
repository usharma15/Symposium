import type { InquiryItem, ResearchCommunity, ResearchProfile } from "@/lib/mockData";
import { cleanHandle, itemTimestampScore, metricNumber } from "@/lib/symposiumCore";
import { itemHasPostType } from "@/lib/postSemantics";

export type CommunityFeedContent = "all" | "thought" | "paper" | "proposal" | "opportunity";
export type CommunityFeedSort = "recent" | "popular" | "hot";
export type CommunityPopularityWindow = "day" | "week" | "month" | "year" | "three-years" | "all-time";
export type CommunityFeedFilter = {
  content: CommunityFeedContent;
  sort: CommunityFeedSort;
  popularityWindow: CommunityPopularityWindow;
};

export const defaultCommunityFeedFilter: CommunityFeedFilter = {
  content: "all",
  sort: "recent",
  popularityWindow: "month"
};

const popularityWindowMs: Record<Exclude<CommunityPopularityWindow, "all-time">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
  "three-years": 3 * 365 * 24 * 60 * 60 * 1000
};

const commentCount = (item: InquiryItem): number =>
  item.comments.reduce((total, comment) => {
    const nested = (comments: typeof comment.replies): number =>
      (comments ?? []).reduce((count, reply) => count + (reply.deletedAt ? 0 : 1) + nested(reply.replies), 0);
    return total + (comment.deletedAt ? 0 : 1) + nested(comment.replies);
  }, 0);

const communityEngagementScore = (item: InquiryItem) =>
  metricNumber(item.metrics.signal) * 4
  + metricNumber(item.metrics.forks) * 5
  + metricNumber(item.metrics.saves) * 3
  + metricNumber(item.metrics.reads) * 0.08
  + (item.commentCount ?? commentCount(item)) * 6;

const matchesCommunityContent = (item: InquiryItem, content: CommunityFeedContent) =>
  content === "all" || itemHasPostType(item, content);

export const filterCommunityFeedItems = (
  items: InquiryItem[],
  filter: CommunityFeedFilter,
  now = Date.now()
) => {
  const matching = items.filter((item) => matchesCommunityContent(item, filter.content));
  const popularityWindow = filter.popularityWindow;
  const inWindow = filter.sort === "popular" && popularityWindow !== "all-time"
    ? matching.filter((item) => itemTimestampScore(item) >= now - popularityWindowMs[popularityWindow])
    : matching;
  return [...inWindow].sort((a, b) => {
    if (filter.sort === "recent") return itemTimestampScore(b) - itemTimestampScore(a);
    if (filter.sort === "popular") {
      return communityEngagementScore(b) - communityEngagementScore(a) || itemTimestampScore(b) - itemTimestampScore(a);
    }
    const hotScore = (item: InquiryItem) => {
      const ageHours = Math.max(0, now - itemTimestampScore(item)) / (60 * 60 * 1000);
      return (communityEngagementScore(item) + 12) / Math.pow(ageHours + 2, 1.22);
    };
    return hotScore(b) - hotScore(a) || itemTimestampScore(b) - itemTimestampScore(a);
  });
};

const feedContentLabels: Record<CommunityFeedContent, string> = {
  all: "Everything",
  thought: "Thoughts",
  paper: "Papers",
  proposal: "Proposals",
  opportunity: "Opportunities"
};

const popularityWindowLabels: Record<CommunityPopularityWindow, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
  "three-years": "3 years",
  "all-time": "all time"
};

export const communityFeedFilterLabel = (filter: CommunityFeedFilter) => {
  const order = filter.sort === "recent"
    ? "Most recent"
    : filter.sort === "hot"
      ? "Hot right now"
      : `Popular · ${popularityWindowLabels[filter.popularityWindow]}`;
  return `${feedContentLabels[filter.content]} · ${order}`;
};

export const communityMembershipStatus = (
  community: ResearchCommunity,
  profile: Pick<ResearchProfile, "handle">
) => {
  if (community.membershipStatus) return community.membershipStatus;
  return community.memberHandles.some((handle) => cleanHandle(handle) === cleanHandle(profile.handle))
    ? "active" as const
    : "none" as const;
};
export const isActiveCommunityMember = (
  community: ResearchCommunity,
  profile: Pick<ResearchProfile, "handle">
) => communityMembershipStatus(community, profile) === "active";

export const canViewCommunity = (
  community: ResearchCommunity,
  profile: Pick<ResearchProfile, "handle">
) => community.visibility === "public" || isActiveCommunityMember(community, profile);

export const canParticipateInCommunity = (
  community: ResearchCommunity,
  profile: Pick<ResearchProfile, "handle">
) => isActiveCommunityMember(community, profile);

export const communityMembershipLabel = (
  community: ResearchCommunity,
  profile: Pick<ResearchProfile, "handle">
) => {
  const status = communityMembershipStatus(community, profile);
  if (status === "active") return "Leave community";
  if (status === "requested") return "Requested";
  if (status === "invited") return "Accept invitation";
  return community.visibility === "private" ? "Request to join" : "Join community";
};

export const communityPostIsExternallyDiscoverable = (item: InquiryItem) =>
  !item.communityId || itemHasPostType(item, "paper");

export const communityPostIsInteractive = (item: InquiryItem) =>
  item.communityAccess === undefined || item.communityAccess === "full";

export const communityRecencyScore = (community: ResearchCommunity) => {
  const parsed = Date.parse(community.lastAccessedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};
