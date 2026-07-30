import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { cleanHandle } from "@/lib/symposiumCore";
import {
  commentTreesFromRows,
  getPostConversationAttachments,
  rowToItem,
  type CommentRow,
  type SnapshotRow
} from "./foundation";
import { assertCommunityParticipation, assertCommunityReadAccess } from "./communities";
import { commentSelectColumns, postSelectColumns } from "./inquiryProjection";

const lockedPostSelect = `SELECT
  ${postSelectColumns()}
 FROM posts
 WHERE id = $1
 FOR UPDATE`;

const postCommentsSelect = `SELECT
  ${commentSelectColumns()}
 FROM comments
 WHERE post_id = $1
 ORDER BY created_at ASC`;

export const assertPostReadableBy = async (
  post: {
    authorHandle?: string | null;
    communityId?: string | null;
    kind: string;
    postType?: string | null;
    room: string;
  },
  handle: string,
  communityAccess: "participate" | "read" = "read"
) => {
  if (post.communityId && post.postType !== "paper") {
    await (communityAccess === "participate" ? assertCommunityParticipation : assertCommunityReadAccess)(
      post.communityId,
      handle
    );
  }
  if (
    (post.room === "office" || post.kind === "draft") &&
    (!post.authorHandle || cleanHandle(post.authorHandle) !== handle)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  }
};

export const loadLockedPost = async (
  client: Pick<PoolClient, "query">,
  postId: string,
  handle: string,
  communityAccess: "participate" | "read" = "read"
) => {
  const row = (await client.query<SnapshotRow>(lockedPostSelect, [postId])).rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  await assertPostReadableBy(row, handle, communityAccess);
  return row;
};

export const loadLockedPostConversation = async (
  client: Pick<PoolClient, "query">,
  postId: string,
  handle: string,
  communityAccess: "participate" | "read" = "read"
) => {
  const row = await loadLockedPost(client, postId, handle, communityAccess);
  const commentsResult = await client.query<CommentRow>(postCommentsSelect, [postId]);
  const [commentAttachments, postAttachments] = await getPostConversationAttachments(
    client,
    postId,
    commentsResult.rows
  );
  const comments = commentTreesFromRows(commentsResult.rows, commentAttachments).get(postId) ?? [];
  return {
    row,
    commentRows: commentsResult.rows,
    comments,
    postAttachments,
    item: rowToItem(row, comments, postAttachments.get(postId) ?? [])
  };
};
