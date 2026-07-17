import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  ContentKindContract,
  ContentQuoteContract,
  ContentQuoteSourceContract,
  PostTypeContract
} from "../../../../packages/contracts/src";

export type QuoteOwnerType = "post" | "comment";

type PostQuoteSourceRow = {
  id: string;
  revision: number;
  kind: ContentKindContract;
  postType: PostTypeContract;
  title: string;
  authorHandle: string | null;
  authorName: string;
  body: string;
  createdAt: Date | string;
  attachmentCount: string | number;
  sourceCommunityId: string | null;
  sourceCommunityVisibility: string | null;
};

type CommentQuoteSourceRow = {
  id: string;
  revision: number;
  postId: string;
  kind: ContentKindContract;
  postType: PostTypeContract;
  authorHandle: string | null;
  authorName: string;
  body: string;
  createdAt: Date | string;
  attachmentCount: string | number;
  sourceCommunityId: string | null;
  sourceCommunityVisibility: string | null;
};

type QuoteOwner = {
  ownerId: string;
  ownerType: QuoteOwnerType;
  actorHandle?: string;
  targetCommunityId?: string | null;
  targetPostType?: PostTypeContract | null;
};

const unavailableSource = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "This content is deleted, private, or otherwise unavailable to quote."
  });

const attachmentCount = (value: string | number) => Math.min(Math.max(Number(value) || 0, 0), 10);

const assertPrivateSourceDestination = (
  source: Pick<PostQuoteSourceRow, "postType" | "sourceCommunityId" | "sourceCommunityVisibility">,
  owner?: QuoteOwner
) => {
  if (source.sourceCommunityVisibility !== "private") return;
  if (source.postType === "paper") return;
  const staysInsideCommunity = Boolean(
    source.sourceCommunityId &&
    owner?.targetCommunityId === source.sourceCommunityId
  );
  const becomesPublicPaperCitation = owner?.ownerType === "post" && owner.targetPostType === "paper";
  if (!staysInsideCommunity && !becomesPublicPaperCitation) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private community content can only be quoted inside that community or cited by a public paper."
    });
  }
};

export const resolveContentQuote = async (
  client: PoolClient,
  source: ContentQuoteSourceContract | undefined,
  owner?: QuoteOwner
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
         post.post_type AS "postType",
         post.title,
         post.author_handle AS "authorHandle",
         post.author_name AS "authorName",
         post.body,
         post.created_at AS "createdAt",
         post.community_id AS "sourceCommunityId",
         community.visibility AS "sourceCommunityVisibility",
         (SELECT count(*)
            FROM attachments attachment
           WHERE attachment.owner_type = 'post'
             AND attachment.owner_id = post.id
             AND attachment.status IN ('uploaded', 'previewed')) AS "attachmentCount"
       FROM posts post
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE post.id = $1
         AND post.deleted_at IS NULL
         AND (
           post.visibility = 'public'
           OR (
           post.community_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM communities community
               LEFT JOIN community_memberships membership
                 ON membership.community_id = community.id
                AND membership.profile_handle = $2
                AND membership.status = 'active'
               WHERE community.id = post.community_id
                 AND (community.visibility = 'public' OR membership.profile_handle IS NOT NULL)
             )
           )
         )
         AND post.room <> 'office'
         AND post.kind <> 'draft'
       FOR SHARE OF post`,
      [source.sourceId, owner?.actorHandle ?? null]
    );
    const row = result.rows[0];
    if (!row) throw unavailableSource();
    assertPrivateSourceDestination(row, owner);
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
      postType: row.postType,
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
       post.kind,
       post.post_type AS "postType",
       comment.author_handle AS "authorHandle",
       comment.author_name AS "authorName",
       comment.body,
       comment.created_at AS "createdAt",
       post.community_id AS "sourceCommunityId",
       community.visibility AS "sourceCommunityVisibility",
       (SELECT count(*)
          FROM attachments attachment
         WHERE attachment.owner_type = 'comment'
           AND attachment.owner_id = comment.id
           AND attachment.status IN ('uploaded', 'previewed')) AS "attachmentCount"
     FROM comments comment
     INNER JOIN posts post ON post.id = comment.post_id
     LEFT JOIN communities community ON community.id = post.community_id
     WHERE comment.id = $1
       AND comment.deleted_at IS NULL
       AND post.deleted_at IS NULL
       AND (
         post.visibility = 'public'
         OR (
           post.community_id IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM communities community
             LEFT JOIN community_memberships membership
               ON membership.community_id = community.id
              AND membership.profile_handle = $2
              AND membership.status = 'active'
             WHERE community.id = post.community_id
               AND (community.visibility = 'public' OR membership.profile_handle IS NOT NULL)
           )
         )
       )
       AND post.room <> 'office'
       AND post.kind <> 'draft'
     FOR SHARE OF comment, post`,
    [source.sourceId, owner?.actorHandle ?? null]
  );
  const row = result.rows[0];
  if (!row) throw unavailableSource();
  assertPrivateSourceDestination(row, owner);
  return {
    sourceType: "comment",
    sourceId: row.id,
    sourcePostId: row.postId,
    sourceRevision: row.revision,
    available: true,
    author: row.authorName,
    authorHandle: row.authorHandle ?? undefined,
    kind: row.kind,
    postType: row.postType,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
    attachmentCount: attachmentCount(row.attachmentCount)
  };
};

export const resolveUpdatedContentQuote = (
  client: PoolClient,
  current: ContentQuoteContract | undefined,
  source: ContentQuoteSourceContract | null | undefined,
  owner: QuoteOwner
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
