import type { ContentQuoteSourceContract, PostTypeContract } from "@/packages/contracts/src";
import type { InquiryItem } from "@/lib/mockData";
import { listLocalCommunities } from "@/lib/localCommunityStore";
import { projectCommunityItemsForViewer } from "@/lib/communityContentProjection";
import { ContentQuoteError } from "@/lib/contentQuotes";
import { findCommentInTree } from "@/lib/symposiumCore";

export const localCommunityReadAllowed = async (item: InquiryItem, actorHandle: string) => {
  if (!item.communityId || item.postType === "paper") return true;
  const community = (await listLocalCommunities(actorHandle)).find((candidate) => candidate.id === item.communityId);
  return Boolean(community && (community.visibility === "public" || community.membershipStatus === "active"));
};

export const localCommunityParticipationAllowed = async (item: InquiryItem, actorHandle: string) => {
  if (!item.communityId || item.postType === "paper") return true;
  const community = (await listLocalCommunities(actorHandle)).find((candidate) => candidate.id === item.communityId);
  return community?.membershipStatus === "active";
};

export const localCommunityManagerAllowed = async (item: InquiryItem, actorHandle: string) => {
  if (!item.communityId) return false;
  const community = (await listLocalCommunities(actorHandle)).find((candidate) => candidate.id === item.communityId);
  return community?.viewerRole === "owner" || community?.viewerRole === "moderator";
};

export const localQuoteSourceItems = async (items: InquiryItem[], actorHandle: string) =>
  projectCommunityItemsForViewer(items, await listLocalCommunities(actorHandle), actorHandle)
    .filter((item) => item.communityAccess === "full");

export const assertLocalQuoteDestination = async (
  items: InquiryItem[],
  actorHandle: string,
  source: ContentQuoteSourceContract | undefined,
  target: { ownerType: "post" | "comment"; communityId?: string; postType?: PostTypeContract }
) => {
  if (!source) return;
  const sourceItem = source.sourceType === "post"
    ? items.find((item) => item.id === source.sourceId)
    : items.find((item) => Boolean(findCommentInTree(item.comments, source.sourceId)));
  if (!sourceItem?.communityId) return;
  const community = (await listLocalCommunities(actorHandle)).find((candidate) => candidate.id === sourceItem.communityId);
  if (community?.visibility !== "private") return;
  if (sourceItem.postType === "paper") return;
  if (target.communityId === sourceItem.communityId) return;
  if (target.ownerType === "post" && target.postType === "paper") return;
  throw new ContentQuoteError(
    "Private community content can only be quoted inside that community or cited by a public paper.",
    412
  );
};
