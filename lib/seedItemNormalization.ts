import { inquiryItems, type InquiryComment } from "@/lib/mockData";

export const seedItemById = new Map(inquiryItems.map((item) => [item.id, item]));
export const seedCommentById = new Map<string, InquiryComment>();

for (const item of inquiryItems) {
  const visit = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) seedCommentById.set(comment.id, comment);
      visit(comment.replies ?? []);
    }
  };
  visit(item.comments);
}

export const legacyLiveSeedCreatedAt = (id?: string, offsetMinutes = 0) => {
  const match = id?.match(/^live-(\d+)-/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!Number.isFinite(index)) return undefined;
  return new Date(Date.UTC(2026, 5, 18, 12, 0, 0) - (index * 19 + offsetMinutes) * 60 * 1000).toISOString();
};

export const stableSeedCreatedAt = (createdAt: string | undefined, fallback?: string) => {
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) return createdAt;
  return fallback ?? createdAt;
};
