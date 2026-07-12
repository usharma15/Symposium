import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  ContentKindContract,
  ContentQuoteContract,
  ContentQuoteSourceContract
} from "../../../../packages/contracts/src";

export type QuoteOwnerType = "post" | "comment";

type PostQuoteSourceRow = {
  id: string;
  revision: number;
  kind: ContentKindContract;
  title: string;
  authorHandle: string | null;
  authorName: string;
  body: string;
  createdAt: Date | string;
  attachmentCount: string | number;
};

type CommentQuoteSourceRow = {
  id: string;
  revision: number;
  postId: string;
  authorHandle: string | null;
  authorName: string;
  body: string;
  createdAt: Date | string;
  attachmentCount: string | number;
};

const unavailableSource = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "This content is deleted, private, or otherwise unavailable to quote."
  });

const attachmentCount = (value: string | number) => Math.min(Math.max(Number(value) || 0, 0), 10);

export const resolveContentQuote = async (
  client: PoolClient,
  source: ContentQuoteSourceContract | undefined,
  owner?: { ownerId: string; ownerType: QuoteOwnerType }
): Promise<ContentQuoteContract | undefined> => {
  if (!source) return undefined;
  if (owner?.ownerType === source.sourceType && owner.ownerId === source.sourceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Content cannot quote itself." });
  }

  if (source.sourceType === "post") {
    const result = await client.query<PostQuoteSourceRow>(
      `SELECT
         post.id,
         post.revision,
         post.kind,
         post.title,
         post.author_handle AS "authorHandle",
         post.author_name AS "authorName",
         post.body,
         post.created_at AS "createdAt",
         (SELECT count(*)
            FROM attachments attachment
           WHERE attachment.owner_type = 'post'
             AND attachment.owner_id = post.id
             AND attachment.status IN ('uploaded', 'previewed')) AS "attachmentCount"
       FROM posts post
       WHERE post.id = $1
         AND post.deleted_at IS NULL
         AND post.visibility = 'public'
         AND post.room <> 'office'
         AND post.kind <> 'draft'
       FOR SHARE OF post`,
      [source.sourceId]
    );
    const row = result.rows[0];
    if (!row) throw unavailableSource();
    return {
      sourceType: "post",
      sourceId: row.id,
      sourcePostId: row.id,
      sourceRevision: row.revision,
      available: true,
      author: row.authorName,
      authorHandle: row.authorHandle ?? undefined,
      title: row.title,
      kind: row.kind,
      body: row.body,
      createdAt: new Date(row.createdAt).toISOString(),
      attachmentCount: attachmentCount(row.attachmentCount)
    };
  }

  const result = await client.query<CommentQuoteSourceRow>(
    `SELECT
       comment.id,
       comment.revision,
       comment.post_id AS "postId",
       comment.author_handle AS "authorHandle",
       comment.author_name AS "authorName",
       comment.body,
       comment.created_at AS "createdAt",
       (SELECT count(*)
          FROM attachments attachment
         WHERE attachment.owner_type = 'comment'
           AND attachment.owner_id = comment.id
           AND attachment.status IN ('uploaded', 'previewed')) AS "attachmentCount"
     FROM comments comment
     INNER JOIN posts post ON post.id = comment.post_id
     WHERE comment.id = $1
       AND comment.deleted_at IS NULL
       AND post.deleted_at IS NULL
       AND post.visibility = 'public'
       AND post.room <> 'office'
       AND post.kind <> 'draft'
     FOR SHARE OF comment, post`,
    [source.sourceId]
  );
  const row = result.rows[0];
  if (!row) throw unavailableSource();
  return {
    sourceType: "comment",
    sourceId: row.id,
    sourcePostId: row.postId,
    sourceRevision: row.revision,
    available: true,
    author: row.authorName,
    authorHandle: row.authorHandle ?? undefined,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
    attachmentCount: attachmentCount(row.attachmentCount)
  };
};

export const resolveUpdatedContentQuote = (
  client: PoolClient,
  current: ContentQuoteContract | undefined,
  source: ContentQuoteSourceContract | null | undefined,
  owner: { ownerId: string; ownerType: QuoteOwnerType }
) => source === undefined ? current : source === null ? undefined : resolveContentQuote(client, source, owner);

const unavailableQuoteSql = `jsonb_build_object(
  'sourceType', quote->>'sourceType',
  'sourceId', quote->>'sourceId',
  'sourcePostId', quote->>'sourcePostId',
  'available', false,
  'attachmentCount', 0
)`;

export const markQuotedPostUnavailable = async (client: PoolClient, postId: string) => {
  const posts = await client.query(
    `UPDATE posts
     SET quote = ${unavailableQuoteSql}, revision = revision + 1, updated_at = now()
     WHERE quote IS NOT NULL
       AND quote->>'available' = 'true'
       AND quote->>'sourcePostId' = $1`,
    [postId]
  );
  const comments = await client.query<{ postId: string }>(
    `UPDATE comments
     SET quote = ${unavailableQuoteSql}, revision = revision + 1, updated_at = now()
     WHERE quote IS NOT NULL
       AND quote->>'available' = 'true'
       AND quote->>'sourcePostId' = $1
     RETURNING post_id AS "postId"`,
    [postId]
  );
  const affectedPostIds = [...new Set(comments.rows.map((row) => row.postId))];
  if (affectedPostIds.length) {
    await client.query(
      `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = ANY($1::text[])`,
      [affectedPostIds]
    );
  }
  return (posts.rowCount ?? 0) + (comments.rowCount ?? 0);
};

export const markQuotedCommentUnavailable = async (client: PoolClient, commentId: string) => {
  const posts = await client.query(
    `UPDATE posts
     SET quote = ${unavailableQuoteSql}, revision = revision + 1, updated_at = now()
     WHERE quote->>'sourceType' = 'comment'
       AND quote->>'available' = 'true'
       AND quote->>'sourceId' = $1`,
    [commentId]
  );
  const comments = await client.query<{ postId: string }>(
    `UPDATE comments
     SET quote = ${unavailableQuoteSql}, revision = revision + 1, updated_at = now()
     WHERE quote->>'sourceType' = 'comment'
       AND quote->>'available' = 'true'
       AND quote->>'sourceId' = $1
     RETURNING post_id AS "postId"`,
    [commentId]
  );
  const affectedPostIds = [...new Set(comments.rows.map((row) => row.postId))];
  if (affectedPostIds.length) {
    await client.query(
      `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = ANY($1::text[])`,
      [affectedPostIds]
    );
  }
  return (posts.rowCount ?? 0) + (comments.rowCount ?? 0);
};
