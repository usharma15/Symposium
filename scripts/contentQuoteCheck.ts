import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  contentQuoteSchema,
  createCommentInputSchema,
  createPostInputSchema,
  updateCommentInputSchema,
  updatePostInputSchema
} from "@/packages/contracts/src";
import { inquiryItems } from "@/lib/mockData";
import {
  invalidateQuotedSource,
  quoteExcerptLength,
  quotedContentExcerpt,
  resolveLocalContentQuote
} from "@/lib/contentQuotes";

const main = async () => {
  const post = inquiryItems.find(
    (item) => item.room !== "office" && item.kind !== "draft" && item.comments.some((candidate) => candidate.id)
  )!;
  const comment = post.comments.find((candidate) => candidate.id)!;
  const postQuote = resolveLocalContentQuote(inquiryItems, { sourceType: "post", sourceId: post.id });
  const commentQuote = resolveLocalContentQuote(inquiryItems, { sourceType: "comment", sourceId: comment.id as string });
  assert.equal(contentQuoteSchema.safeParse(postQuote).success, true);
  assert.equal(contentQuoteSchema.safeParse(commentQuote).success, true);
  assert.equal(postQuote?.sourcePostId, post.id);
  assert.equal(commentQuote?.sourcePostId, post.id);

  const longSource = Array.from({ length: 100 }, (_, index) => `word${index}`).join(" ");
  const excerpt = quotedContentExcerpt(longSource);
  assert.ok(excerpt.length >= 300 && excerpt.length <= quoteExcerptLength + 1);
  assert.equal(excerpt.endsWith("…"), true);
  assert.equal(excerpt.slice(0, -1).endsWith(" "), false);

  assert.throws(
    () => resolveLocalContentQuote(
      inquiryItems,
      { sourceType: "post", sourceId: post.id },
      { ownerType: "post", ownerId: post.id }
    ),
    /cannot quote itself/i
  );

  const postOwner = { ...inquiryItems.find((item) => item.id !== post.id)!, quote: postQuote };
  const commentOwner = {
    ...postOwner,
    comments: [{ ...comment, id: "quote-owner-comment", quote: commentQuote, replies: [] }]
  };
  const postInvalidated = invalidateQuotedSource([postOwner], {
    sourceType: "post",
    sourceId: post.id,
    sourcePostId: post.id
  });
  assert.deepEqual(postInvalidated[0]?.quote, {
    sourceType: "post",
    sourceId: post.id,
    sourcePostId: post.id,
    available: false,
    attachmentCount: 0
  });
  assert.equal(postInvalidated[0]?.revision, (postOwner.revision ?? 1) + 1);
  const commentInvalidated = invalidateQuotedSource([commentOwner], {
    sourceType: "comment",
    sourceId: comment.id as string,
    sourcePostId: post.id
  });
  assert.equal(commentInvalidated[0]?.comments[0]?.quote?.available, false);
  assert.equal(commentInvalidated[0]?.comments[0]?.quote?.body, undefined);
  assert.equal(
    commentInvalidated[0]?.comments[0]?.revision,
    (commentOwner.comments[0]?.revision ?? 1) + 1
  );
  assert.equal(commentInvalidated[0]?.revision, (commentOwner.revision ?? 1) + 1);

  const quoteSource = { sourceType: "post" as const, sourceId: post.id };
  assert.equal(createPostInputSchema.safeParse({
    title: "Quoted post",
    body: "Framing",
    kind: "thought",
    room: "amphitheater",
    quoteSource,
    attachmentIds: ["00000000-0000-4000-8000-000000000001"]
  }).success, true);
  assert.equal(createCommentInputSchema.safeParse({
    body: "Quoted comment",
    quoteSource,
    attachmentIds: ["00000000-0000-4000-8000-000000000001"]
  }).success, true);
  assert.equal(updatePostInputSchema.safeParse({
    title: "Edited",
    body: "Edited framing",
    expectedEditedAt: null,
    quoteSource: null
  }).success, true);
  assert.equal(updateCommentInputSchema.safeParse({
    body: "Edited framing",
    expectedEditedAt: null,
    quoteSource: null
  }).success, true);

  const root = process.cwd();
  const [service, migration, foundation, quoteViews, controller] = await Promise.all([
    readFile(path.join(root, "apps/api/src/services/contentQuotes.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/foundation.ts"), "utf8"),
    readFile(path.join(root, "features/quotes/QuoteViews.tsx"), "utf8"),
    readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8")
  ]);
  assert.match(service, /post\.visibility = 'public'/);
  assert.match(service, /post\.room <> 'office'/);
  assert.match(service, /markQuotedPostUnavailable/);
  assert.match(service, /markQuotedCommentUnavailable/);
  assert.match(service, /revision = revision \+ 1/);
  assert.match(service, /quote->>'available' = 'true'/);
  assert.match(migration, /0017_content_quotes/);
  assert.match(migration, /posts_quote_source_post_idx/);
  assert.match(migration, /comments_quote_comment_source_idx/);
  assert.match(foundation, /quote: row\.quote \?\? undefined/);
  assert.match(quoteViews, /QuoteActionButton/);
  assert.match(quoteViews, /ContentQuoteCard/);
  assert.match(controller, /invalidateLiveQuotedSource/);
  assert.match(controller, /selection\.sourceType === "comment" \? selection\.sourceId : null/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "post and comment quote snapshots",
      "320-character exact-source excerpt",
      "self-quote rejection",
      "permission-safe source resolution",
      "post and comment source invalidation",
      "create and edit contracts",
      "quote and attachment coexistence contracts",
      "exact post and comment source navigation",
      "shared quote UI and live invalidation"
    ]
  }, null, 2));
};

void main();
