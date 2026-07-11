import { inquiryItems, type InquiryComment, type InquiryItem } from "@/lib/mockData";

const clientSeedItemById = new Map(inquiryItems.map((item) => [item.id, item]));
const clientSeedCommentById = new Map<string, InquiryComment>();
for (const item of inquiryItems) {
  const visit = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) clientSeedCommentById.set(comment.id, comment);
      visit(comment.replies ?? []);
    }
  };
  visit(item.comments);
}

const legacyLiveSeedCreatedAt = (id?: string, offsetMinutes = 0) => {
  const match = id?.match(/^live-(\d+)-/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!Number.isFinite(index)) return undefined;
  return new Date(Date.UTC(2026, 5, 18, 12, 0, 0) - (index * 19 + offsetMinutes) * 60 * 1000).toISOString();
};

const stableSeedCreatedAt = (createdAt: string | undefined, fallback?: string) => {
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) return createdAt;
  return fallback ?? createdAt;
};

const normalizeClientSeedCommentTimes = (comments: InquiryComment[]): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    createdAt: stableSeedCreatedAt(
      comment.id ? clientSeedCommentById.get(comment.id)?.createdAt ?? comment.createdAt : comment.createdAt,
      legacyLiveSeedCreatedAt(comment.id, 1)
    ),
    replies: normalizeClientSeedCommentTimes(comment.replies ?? [])
  }));

export const normalizeClientSeedTimes = (items: InquiryItem[]): InquiryItem[] =>
  items.map((item) => {
    const seedItem = clientSeedItemById.get(item.id);
    return {
      ...item,
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
