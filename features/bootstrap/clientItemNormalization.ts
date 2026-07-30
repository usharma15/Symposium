import type { InquiryComment, InquiryItem } from "@/lib/mockData";
import { postTypeForItem } from "@/lib/postSemantics";
import { resolvePostDesignAssignment } from "@/lib/postDesign";
import {
  legacyLiveSeedCreatedAt,
  seedCommentById,
  seedItemById,
  stableSeedCreatedAt
} from "@/lib/seedItemNormalization";

const normalizeClientSeedCommentTimes = (comments: InquiryComment[]): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    createdAt: stableSeedCreatedAt(
      comment.id ? seedCommentById.get(comment.id)?.createdAt ?? comment.createdAt : comment.createdAt,
      legacyLiveSeedCreatedAt(comment.id, 1)
    ),
    replies: normalizeClientSeedCommentTimes(comment.replies ?? [])
  }));

export const normalizeClientSeedTimes = (items: InquiryItem[]): InquiryItem[] =>
  items.map((item) => {
    const seedItem = seedItemById.get(item.id);
    const postType = postTypeForItem(item) ?? undefined;
    return {
      ...item,
      postType,
      designAssignment: resolvePostDesignAssignment({
        postType,
        assignment: item.designAssignment ?? seedItem?.designAssignment,
        identity: item.id
      }),
      createdAt: stableSeedCreatedAt(seedItem?.createdAt ?? item.createdAt, legacyLiveSeedCreatedAt(item.id)),
      comments: normalizeClientSeedCommentTimes(item.comments ?? [])
    };
  });

export const preservePublishedPosition = (incoming: InquiryItem, existing?: InquiryItem): InquiryItem => {
  const normalized = normalizeClientSeedTimes([incoming])[0] ?? incoming;
  if (!existing) return normalized;
  return {
    ...normalized,
    date: existing.date,
    createdAt: existing.createdAt,
    attachments: normalized.attachments ?? existing.attachments
  };
};
