import type { InquiryComment, InquiryItem, ResearchCommunity } from "@/lib/mockData";
import { isDeletedComment, isDeletedPost, normalizeSearchPhrase } from "@/lib/symposiumCore";

type PatronageMode = "lobby" | "civic" | "private";

const topicTerms: Record<string, string[]> = {
  "Frontier Physics": ["physics", "hidden", "oscillator", "law", "apparatus"],
  "AI Metascience": ["ai", "agent", "agents", "metascience", "benchmark", "simulation"],
  "Rogue Youth Labs": ["youth lab", "youth labs", "pilot", "proof-of-work"],
  "History Of Discovery": ["history", "discovery", "accident", "anomaly", "prepared"],
  "Tools And Instruments": ["tool", "tools", "code", "instrument", "runner", "notebook"],
  Patronage: ["funding", "grant", "backer", "budget", "patronage", "civic", "private"],
  Communities: ["community", "communities", "events", "calls", "groups"],
  Opportunities: ["opportunity", "opportunities", "call", "fellowship", "role", "residency"]
};

const patronageTerms: Record<Exclude<PatronageMode, "lobby">, string[]> = {
  civic: ["civic", "crowdfund", "crowdfunding", "bounty", "bounties", "donation", "donations", "microgrant", "microgrants", "public", "stipend", "stipends"],
  private: ["private", "investor", "investors", "grant", "grants", "family office", "funds", "patron", "patronage", "backer", "backers", "tranche"]
};

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

export const matchesTopic = (item: InquiryItem, chip: string) => {
  const terms = topicTerms[chip] ?? [];
  const text = searchableText(item);
  return terms.some((term) => text.includes(term));
};

export const matchesPatronageMode = (item: InquiryItem, mode: PatronageMode) => {
  if (mode === "lobby") return false;
  const text = searchableText(item);
  return patronageTerms[mode].some((term) => {
    if (term.includes(" ")) return text.includes(term);
    return new RegExp(`\\b${term}\\b`, "i").test(text);
  });
};

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
