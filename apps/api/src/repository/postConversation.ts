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

const lockedPostSelect = `SELECT
  id, revision, kind, post_type AS "postType", room, community_id AS "communityId", title,
  author_handle AS "authorHandle", author_name AS "authorName", affiliation,
  date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
  deleted_at AS "deletedAt", status, metrics, gathering_reason AS "gatheringReason",
  excerpt, body, content_document AS "document", tags, signals, claims, objections,
  evidence, tests, forks, saved, saved_by AS "savedBy", signaled_by AS "signaledBy",
  forked_by AS "forkedBy", quote, patronage, opportunity,
  design_assignment AS "designAssignment"
 FROM posts
 WHERE id = $1
 FOR UPDATE`;

const postCommentsSelect = `SELECT
  id, revision, post_id AS "postId", parent_id AS "parentId",
  author_handle AS "authorHandle", author_name AS "authorName", stance, body,
  content_document AS "document", metrics, saved_by AS "savedBy",
  signaled_by AS "signaledBy", forked_by AS "forkedBy", quote,
  edited_at AS "editedAt", deleted_at AS "deletedAt", created_at AS "createdAt"
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
