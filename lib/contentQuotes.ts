import type {
  ContentQuoteContract,
  ContentQuoteSourceContract,
  InquiryCommentContract,
  InquiryItemContract
} from "@/packages/contracts/src";
import { findCommentInTree, isDeletedComment, isDeletedPost } from "@/lib/symposiumCore";

export const quoteExcerptLength = 320;

export class ContentQuoteError extends Error {
  status: number;

  constructor(message: string, status = 412) {
    super(message);
    this.status = status;
  }
}

export const quotedContentExcerpt = (body: string, limit = quoteExcerptLength) => {
  const normalized = body.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, limit + 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary >= 300 ? boundary : limit).trimEnd()}…`;
};

export const quoteSourceFromPost = (item: InquiryItemContract): ContentQuoteSourceContract => ({
  sourceType: "post",
  sourceId: item.id
});

export const quoteSourceFromComment = (comment: InquiryCommentContract): ContentQuoteSourceContract => ({
  sourceType: "comment",
  sourceId: comment.id as string
});

export const quoteSourceFromQuote = (quote: ContentQuoteContract): ContentQuoteSourceContract => ({
  sourceType: quote.sourceType,
  sourceId: quote.sourceId
});

export const resolveLocalContentQuote = (
  items: InquiryItemContract[],
  source: ContentQuoteSourceContract | undefined,
  owner?: { ownerId: string; ownerType: "post" | "comment" }
): ContentQuoteContract | undefined => {
  if (!source) return undefined;
  if (owner?.ownerType === source.sourceType && owner.ownerId === source.sourceId) {
    throw new ContentQuoteError("Content cannot quote itself.", 400);
  }

  if (source.sourceType === "post") {
    const item = items.find((candidate) => candidate.id === source.sourceId);
    if (!item || isDeletedPost(item) || item.room === "office" || item.kind === "draft") {
      throw new ContentQuoteError("This content is deleted, private, or otherwise unavailable to quote.");
    }
    return {
      sourceType: "post",
      sourceId: item.id,
      sourcePostId: item.id,
      sourceRevision: item.revision,
      available: true,
      author: item.author,
      authorHandle: item.authorHandle,
      title: item.title,
      kind: item.kind,
      body: item.body,
      createdAt: item.createdAt,
      attachmentCount: Math.min(item.attachments?.length ?? 0, 10)
    };
  }

  for (const item of items) {
    const comment = findCommentInTree(item.comments, source.sourceId);
    if (!comment) continue;
    if (isDeletedPost(item) || isDeletedComment(comment) || item.room === "office" || item.kind === "draft") {
      throw new ContentQuoteError("This content is deleted, private, or otherwise unavailable to quote.");
    }
    return {
      sourceType: "comment",
      sourceId: source.sourceId,
      sourcePostId: item.id,
      sourceRevision: comment.revision,
      available: true,
      author: comment.author,
      authorHandle: comment.authorHandle,
      body: comment.body,
      createdAt: comment.createdAt,
      attachmentCount: Math.min(comment.attachments?.length ?? 0, 10)
    };
  }
  throw new ContentQuoteError("This content is deleted, private, or otherwise unavailable to quote.");
};

export const unavailableContentQuote = (quote: ContentQuoteContract): ContentQuoteContract => ({
  sourceType: quote.sourceType,
  sourceId: quote.sourceId,
  sourcePostId: quote.sourcePostId,
  available: false,
  attachmentCount: 0
});

const quoteMatchesUnavailableSource = (
  quote: ContentQuoteContract | undefined,
  source: { sourceType: "post" | "comment"; sourceId: string; sourcePostId: string }
) =>
  Boolean(
    quote?.available &&
      (source.sourceType === "post"
        ? quote.sourcePostId === source.sourcePostId
        : quote.sourceType === "comment" && quote.sourceId === source.sourceId)
  );

export const invalidateQuotedSource = (
  items: InquiryItemContract[],
  source: { sourceType: "post" | "comment"; sourceId: string; sourcePostId: string }
) =>
  items.map((item) => {
    const quote = quoteMatchesUnavailableSource(item.quote, source) ? unavailableContentQuote(item.quote!) : item.quote;
    const comments = item.comments.map(function invalidate(comment): InquiryCommentContract {
      const commentQuote = quoteMatchesUnavailableSource(comment.quote, source)
        ? unavailableContentQuote(comment.quote!)
        : comment.quote;
      const replies = (comment.replies ?? []).map(invalidate);
      if (
        commentQuote === comment.quote &&
        replies.length === (comment.replies ?? []).length &&
        replies.every((reply, index) => reply === comment.replies?.[index])
      ) {
        return comment;
      }
      return {
        ...comment,
        revision: (comment.revision ?? 1) + 1,
        quote: commentQuote,
        replies
      };
    });
    return quote === item.quote && comments.every((comment, index) => comment === item.comments[index])
      ? item
      : { ...item, revision: (item.revision ?? 1) + 1, quote, comments };
  });
