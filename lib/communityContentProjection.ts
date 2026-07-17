import type { ContentQuoteContract } from "@/packages/contracts/src";
import type { InquiryComment, InquiryItem, ResearchCommunity } from "@/lib/mockData";
import { unavailableContentQuote } from "@/lib/contentQuotes";
import { itemHasProfileActivity, profileActivityComments } from "@/lib/profileActivity";

const findComment = (comments: InquiryComment[], commentId: string): InquiryComment | null => {
  for (const comment of comments) {
    if (comment.id === commentId) return { ...comment, replies: [] };
    const nested = findComment(comment.replies ?? [], commentId);
    if (nested) return nested;
  }
  return null;
};

const citationOnlyProjection = (item: InquiryItem, citation: { postCited: boolean; commentIds: Set<string> }): InquiryItem => {
  const comments = [...citation.commentIds].flatMap((commentId) => {
    const comment = findComment(item.comments, commentId);
    return comment ? [{
      ...comment,
      metrics: { signal: "—", forks: "—", saves: "—", reads: "—" },
      savedBy: [],
      signaledBy: [],
      forkedBy: [],
      quote: undefined,
      replies: []
    }] : [];
  });
  const primaryComment = comments[0];
  return {
    ...item,
    ...(!citation.postCited && primaryComment ? {
      title: "Cited community comment",
      author: primaryComment.author,
      authorHandle: primaryComment.authorHandle,
      body: "",
      excerpt: "",
      document: undefined,
      createdAt: primaryComment.createdAt
    } : {}),
    communityAccess: "citation-only",
    metrics: { signal: "—", critiques: "—", forks: "—", saves: "—", reads: "—" },
    tags: [],
    signals: [],
    claims: [],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    comments,
    attachments: undefined,
    quote: undefined,
    patronage: undefined,
    opportunity: undefined,
    saved: false,
    savedBy: [],
    signaledBy: [],
    forkedBy: []
  };
};

const projectQuoteForViewer = (
  quote: ContentQuoteContract | undefined,
  ownerIsPaper: boolean,
  itemById: Map<string, InquiryItem>,
  communityById: Map<string, ResearchCommunity>
) => {
  if (!quote?.available) return quote;
  const source = itemById.get(quote.sourcePostId);
  if (!source) return unavailableContentQuote(quote);
  const sourceIsPublicPaperMaterial = source.postType === "paper";
  if (!source.communityId || sourceIsPublicPaperMaterial || ownerIsPaper) return quote;
  const community = communityById.get(source.communityId);
  return community?.visibility === "public" || community?.membershipStatus === "active"
    ? quote
    : unavailableContentQuote(quote);
};

const projectCommentQuotes = (
  comments: InquiryComment[],
  itemById: Map<string, InquiryItem>,
  communityById: Map<string, ResearchCommunity>
): InquiryComment[] => comments.map((comment) => ({
  ...comment,
  quote: projectQuoteForViewer(comment.quote, false, itemById, communityById),
  replies: projectCommentQuotes(comment.replies ?? [], itemById, communityById)
}));

const projectFullItem = (
  item: InquiryItem,
  comments: InquiryComment[],
  access: "full" | "activity-only",
  itemById: Map<string, InquiryItem>,
  communityById: Map<string, ResearchCommunity>
): InquiryItem => ({
  ...item,
  communityAccess: access,
  quote: projectQuoteForViewer(item.quote, item.postType === "paper", itemById, communityById),
  comments: projectCommentQuotes(comments, itemById, communityById)
});

export const projectCommunityItemsForViewer = (
  items: InquiryItem[],
  communities: ResearchCommunity[],
  rawViewerHandle?: string | null
) => {
  const communityById = new Map(communities.map((community) => [community.id, community]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const viewerHandle = rawViewerHandle ?? "";
  const citedSources = new Map<string, { postCited: boolean; commentIds: Set<string> }>();
  for (const item of items) {
    if (item.postType !== "paper" || !item.quote?.available) continue;
    const source = items.find((candidate) => candidate.id === item.quote?.sourcePostId);
    if (!source?.communityId) continue;
    const citation = citedSources.get(source.id) ?? { postCited: false, commentIds: new Set<string>() };
    if (item.quote.sourceType === "comment") citation.commentIds.add(item.quote.sourceId);
    else citation.postCited = true;
    citedSources.set(source.id, citation);
  }

  return items.flatMap((item) => {
    if (!item.communityId) return [projectFullItem(item, item.comments, "full", itemById, communityById)];
    const community = communityById.get(item.communityId);
    if (community?.visibility === "public" || community?.membershipStatus === "active") {
      return [projectFullItem(item, item.comments, "full", itemById, communityById)];
    }
    const activityComments = viewerHandle ? profileActivityComments(item.comments, viewerHandle) : [];
    if (item.postType === "paper") {
      return [projectFullItem(item, item.comments, "full", itemById, communityById)];
    }
    if (viewerHandle && itemHasProfileActivity(item, viewerHandle)) {
      return [projectFullItem(item, activityComments, "activity-only", itemById, communityById)];
    }
    const citation = citedSources.get(item.id);
    return citation ? [citationOnlyProjection(item, citation)] : [];
  });
};
