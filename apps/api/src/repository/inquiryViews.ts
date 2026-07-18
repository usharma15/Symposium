import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { postActionInputSchema, type InquiryItemContract } from "../../../../packages/contracts/src";
import { cleanHandle, incrementMetric } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { actorHandle, ensureLiveData } from "./foundation";
import { communityEventScope } from "./communities";
import { recordContentView } from "./contentViews";

type PostViewRow = {
  authorHandle: string | null;
  communityId: string | null;
  kind: string;
  metrics: InquiryItemContract["metrics"];
  postType: string | null;
  revision: number;
  room: string;
};

type CommentViewRow = PostViewRow & {
  commentMetrics: Pick<InquiryItemContract["metrics"], "signal" | "forks" | "saves" | "reads">;
  commentRevision: number;
};

export type InquiryViewReceipt = {
  accepted: boolean;
  action: "read";
  commentId?: string;
  commentRevision?: number;
  itemId: string;
  metrics: Partial<InquiryItemContract["metrics"]>;
  revision: number;
  targetType: "post" | "comment";
};

const assertReadable = async (client: PoolClient, row: PostViewRow, handle: string) => {
  if ((row.room === "office" || row.kind === "draft") && cleanHandle(row.authorHandle ?? "") !== handle) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  }
  if (!row.communityId || row.postType === "paper") return;
  const access = await client.query<{ allowed: boolean }>(
    `SELECT (
       community.visibility = 'public'
       OR EXISTS (
         SELECT 1 FROM community_memberships membership
         WHERE membership.community_id = community.id
           AND membership.profile_handle = $2
           AND membership.status = 'active'
       )
     ) AS allowed
     FROM communities community
     WHERE community.id = $1`,
    [row.communityId, handle]
  );
  if (!access.rows[0]?.allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This private community requires membership." });
  }
};

const eventVisibility = async (
  client: Parameters<typeof communityEventScope>[0],
  row: PostViewRow,
  handle: string
) => row.room === "office" || row.kind === "draft"
  ? { visibility: "private" as const, audienceHandles: [handle] }
  : communityEventScope(client, row.postType === "paper" ? null : row.communityId);

const parseViewInput = (rawInput: unknown) => {
  const input = postActionInputSchema.parse(rawInput);
  if (input.action !== "read") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The lightweight view endpoint only accepts read actions." });
  }
  return input;
};

export const recordPostView = async (postId: string, rawInput: unknown, actor: Actor): Promise<InquiryViewReceipt> => {
  const input = parseViewInput(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent views require the live database." });
  await ensureLiveData();

  const client = await getPool().connect();
  let event: StoredLiveEvent | undefined;
  let receipt: InquiryViewReceipt | undefined;
  try {
    await client.query("BEGIN");
    const result = await client.query<PostViewRow>(
      `SELECT
         author_handle AS "authorHandle", community_id AS "communityId", kind, metrics,
         post_type AS "postType", revision, room
       FROM posts
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [postId]
    );
    const row = result.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    await assertReadable(client, row, handle);

    const accepted = await recordContentView(client, "post", postId, handle, input.trigger, input.surface);
    const metrics = accepted ? { ...row.metrics, reads: incrementMetric(row.metrics.reads, 1) } : row.metrics;
    const revision = accepted
      ? (await client.query<{ revision: number }>(
          `UPDATE posts SET metrics = $2, revision = revision + 1, updated_at = now()
           WHERE id = $1 RETURNING revision`,
          [postId, JSON.stringify(metrics)]
        )).rows[0].revision
      : row.revision;
    receipt = { accepted, action: "read", itemId: postId, metrics, revision, targetType: "post" };
    if (accepted) {
      const scope = await eventVisibility(client, row, handle);
      event = await stageEvent(client, {
        kind: "post.read",
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: scope.visibility,
        audienceHandles: scope.audienceHandles,
        payload: receipt
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (event) await publishStoredEvent(event);
  return receipt!;
};

export const recordCommentView = async (
  postId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor
): Promise<InquiryViewReceipt> => {
  const input = parseViewInput(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent views require the live database." });
  await ensureLiveData();

  const client = await getPool().connect();
  let event: StoredLiveEvent | undefined;
  let receipt: InquiryViewReceipt | undefined;
  try {
    await client.query("BEGIN");
    const result = await client.query<CommentViewRow>(
      `SELECT
         post.author_handle AS "authorHandle", post.community_id AS "communityId", post.kind,
         post.metrics, post.post_type AS "postType", post.revision, post.room,
         comment.metrics AS "commentMetrics", comment.revision AS "commentRevision"
       FROM comments comment
       INNER JOIN posts post ON post.id = comment.post_id
       WHERE post.id = $1 AND comment.id = $2
         AND post.deleted_at IS NULL AND comment.deleted_at IS NULL
       FOR UPDATE OF post, comment`,
      [postId, commentId]
    );
    const row = result.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    await assertReadable(client, row, handle);

    const accepted = await recordContentView(client, "comment", commentId, handle, input.trigger, input.surface);
    const metrics = accepted
      ? { ...row.commentMetrics, reads: incrementMetric(row.commentMetrics.reads, 1) }
      : row.commentMetrics;
    let revision = row.revision;
    let commentRevision = row.commentRevision;
    if (accepted) {
      commentRevision = (await client.query<{ revision: number }>(
        `UPDATE comments SET metrics = $3, revision = revision + 1, updated_at = now()
         WHERE post_id = $1 AND id = $2 RETURNING revision`,
        [postId, commentId, JSON.stringify(metrics)]
      )).rows[0].revision;
      revision = (await client.query<{ revision: number }>(
        `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision`,
        [postId]
      )).rows[0].revision;
    }
    receipt = {
      accepted,
      action: "read",
      commentId,
      commentRevision,
      itemId: postId,
      metrics,
      revision,
      targetType: "comment"
    };
    if (accepted) {
      const scope = await eventVisibility(client, row, handle);
      event = await stageEvent(client, {
        kind: "comment.read",
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: scope.visibility,
        audienceHandles: scope.audienceHandles,
        payload: receipt
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (event) await publishStoredEvent(event);
  return receipt!;
};
