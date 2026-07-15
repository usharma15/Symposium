import type { InquiryComment, InquiryItem, ResearchCommunity } from "@/lib/mockData";
import { isDeletedComment, isDeletedPost, normalizeSearchPhrase } from "@/lib/symposiumCore";

const commentSearchText = (comments: InquiryComment[]): string =>
  comments
    .flatMap((comment) =>
      isDeletedComment(comment)
        ? [commentSearchText(comment.replies ?? [])]
        : [
            comment.author,
            comment.stance,
            comment.body,
            commentSearchText(comment.replies ?? [])
          ]
    )
    .join(" ");

export const searchableText = (item: InquiryItem) =>
  [
    item.title,
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

export const searchableContentText = (item: InquiryItem) =>
  [
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

const matchesCommunity = (item: InquiryItem, community: ResearchCommunity) => {
  const text = searchableText(item);
  return community.keywords.some((keyword) => text.includes(normalizeSearchPhrase(keyword)));
};

export const getCommunityItems = (items: InquiryItem[], community: ResearchCommunity) =>
  items.filter((item) => !isDeletedPost(item) && matchesCommunity(item, community));

export const getCommunityStats = (items: InquiryItem[], community: ResearchCommunity) => {
  const communityItems = getCommunityItems(items, community);
  const papers = communityItems.filter((item) => item.kind === "paper").length;
  const thoughts = communityItems.filter((item) => item.kind === "thought" || item.kind === "note").length;
  const opportunities = communityItems.filter((item) => item.room === "opportunities").length;

  return {
    papers: Math.max(papers, community.seedCounts.papers),
    thoughts: Math.max(thoughts, community.seedCounts.thoughts),
    opportunities: Math.max(opportunities, community.seedCounts.opportunities)
  };
};

export const communitySearchText = (community: ResearchCommunity) =>
  normalizeSearchPhrase(
    [
      community.name,
      community.field,
      community.summary,
      community.visibility,
      community.callStatus,
      ...community.keywords
    ].join(" ")
  );
