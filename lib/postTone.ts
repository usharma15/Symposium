import type { InquiryItem } from "@/lib/mockData";
import type { WorkspaceDocument } from "@/lib/workspaceTypes";
import type { PostToneContract } from "@/packages/contracts/src";

export type PostTone = PostToneContract;

export const postToneClassName = (tone: PostTone | null) =>
  tone ? `post-tone post-tone-${tone}` : "";

export const postToneForItem = (
  item: Pick<InquiryItem, "kind" | "room" | "patronage">
): PostTone | null => {
  if (item.patronage) return "patronage";
  if (item.room === "opportunities") return "opportunity";
  if (item.kind === "thought" || (item.kind === "note" && item.room === "amphitheater")) return "thought";
  if (item.kind === "paper") return "paper";
  return null;
};

export const postToneForWorkspaceDocument = (
  document: Pick<WorkspaceDocument, "kind" | "publicationTarget" | "proposal">
): PostTone | null => {
  const target = String(document.publicationTarget);
  if (document.proposal || target === "proposal") return "patronage";
  if (target === "opportunity") return "opportunity";
  if (document.kind === "thought" || target === "thought") return "thought";
  if (document.kind === "paper" || target === "paper") return "paper";
  return null;
};
