import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  InquiryCommentContract,
  InquiryItemContract,
  PatronageProposalInputContract,
  WorkspaceAccessRoleContract,
  WorkspaceDocumentKindContract
} from "../../../../packages/contracts/src";
import {
  appendCommentToTree,
  findCommentInTree,
  incrementMetric,
  updateSignalValue
} from "../../../../lib/symposiumCore";
import { getPool } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "./audit";
import { stageEvent } from "./events";
import { claimMutation, completeMutation, type MutationContext } from "./mutations";
import { runAtomic } from "./transactions";
import { queueAttachmentsForOwnerStorageDeletion } from "./storageDeletion";
import {
  publishPreparedWorkspaceDiscussion,
  type PreparedWorkspaceDiscussion
} from "./workspaceDiscussionPublishing";

export type PublishableWorkspaceRevision = {
  checkpointId: string;
  ownerHandle: string;
  role: WorkspaceAccessRoleContract;
  noteId: string;
  revision: number;
  title: string;
  body: string;
  document: unknown;
  kind: WorkspaceDocumentKindContract;
  publicationTarget: "undecided" | "paper" | "thought" | "proposal" | "comment" | "reply";
  proposal: PatronageProposalInputContract | null;
  targetId: string | null;
  attachmentIds: string[];
};

const roleRank: Record<WorkspaceAccessRoleContract, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  publisher: 4,
  owner: 5
};

export const loadPublishableWorkspaceRevision = async (
  client: PoolClient,
  noteId: string,
  expectedRevision: number | undefined,
  publisher: string
) => {
  if (expectedRevision === undefined) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Publishing a draft requires the exact revision that is open in the workspace."
    });
  }
  const result = await client.query<PublishableWorkspaceRevision>(
    `SELECT
       revision_row.id::text AS "checkpointId",
       note.id::text AS "noteId",
       note.owner_handle AS "ownerHandle",
       note.revision,
       revision_row.title,
       revision_row.body,
       revision_row.content_document AS document,
       revision_row.kind,
       revision_row.publication_target AS "publicationTarget",
       revision_row.proposal,
       revision_row.target_id AS "targetId",
       revision_row.attachment_ids::text[] AS "attachmentIds",
       CASE GREATEST(
         CASE WHEN note.owner_handle = $3 THEN 5 ELSE 0 END,
         CASE direct.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END,
         CASE inherited.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
       )
         WHEN 5 THEN 'owner'
         WHEN 4 THEN 'publisher'
         WHEN 3 THEN 'editor'
         WHEN 2 THEN 'commenter'
         ELSE 'viewer'
       END AS role
     FROM notes note
     JOIN workspace_note_revisions revision_row
       ON revision_row.note_id = note.id AND revision_row.revision = $2
     LEFT JOIN workspace_note_grants direct
       ON direct.note_id = note.id AND direct.grantee_handle = $3
     LEFT JOIN workspace_notebook_grants inherited
       ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $3
     WHERE note.id = $1 AND note.revision = $2 AND note.lifecycle = 'draft' AND note.deleted_at IS NULL
       AND (note.owner_handle = $3 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)`,
    [noteId, expectedRevision, publisher]
  );
  const revision = result.rows[0];
  if (!revision) {
    const existing = await client.query<{ revision: number }>(
      `SELECT revision FROM notes WHERE id = $1 AND deleted_at IS NULL`,
      [noteId]
    );
    if (existing.rowCount) {
      throw new TRPCError({ code: "CONFLICT", message: "This draft changed after it was opened. Review the latest revision before publishing." });
    }
    throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
  }
  const ownerOnly = ["thought", "comment", "reply"].includes(revision.kind);
  if ((ownerOnly && revision.role !== "owner") || (!ownerOnly && roleRank[revision.role] < roleRank.publisher)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This draft cannot be published with your current access." });
  }
  return revision;
};

const replayCompletedPublication = async (
  client: PoolClient,
  publisher: string,
  mutation?: MutationContext
) => {
  if (!mutation) return null;
  const result = await client.query<{
    requestHash: string;
    status: "pending" | "completed";
    response: unknown;
  }>(
    `SELECT request_hash AS "requestHash", status, response
     FROM mutation_receipts
     WHERE actor_handle = $1 AND scope = $2 AND idempotency_key = $3`,
    [publisher, mutation.scope, mutation.idempotencyKey]
  );
  const receipt = result.rows[0];
  if (!receipt) return null;
  if (receipt.requestHash !== mutation.requestHash) {
    throw new TRPCError({ code: "CONFLICT", message: "This Idempotency-Key was already used for a different mutation payload." });
  }
  if (receipt.status !== "completed" || receipt.response === null || receipt.response === undefined) {
    throw new TRPCError({ code: "CONFLICT", message: "The matching publication is still being processed." });
  }
  return receipt.response;
};

export const withWorkspacePublicationLock = async <T>(
  noteId: string,
  publisher: string,
  mutation: MutationContext | undefined,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await getPool().connect();
  let locked = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('symposium:workspace-note:' || $1, 0))",
      [noteId]
    );
    locked = true;
    const replay = await replayCompletedPublication(client, publisher, mutation);
    return replay === null ? operation(client) : replay as T;
  } finally {
    if (locked) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('symposium:workspace-note:' || $1, 0))",
        [noteId]
      ).catch(() => undefined);
    }
    client.release();
  }
};

export const assertWorkspaceRevisionNotPublished = async (
  client: PoolClient,
  revision: PublishableWorkspaceRevision
) => {
  const published = await client.query(
    `SELECT 1 FROM note_publications WHERE note_id = $1 AND note_revision = $2 LIMIT 1`,
    [revision.noteId, revision.revision]
  );
  if (published.rowCount) {
    throw new TRPCError({ code: "CONFLICT", message: "This saved revision has already been published." });
  }
};

export const persistWorkspacePublication = async <T extends { item: InquiryItemContract; comment?: InquiryCommentContract }>(
  revision: PublishableWorkspaceRevision,
  publisher: string,
  target: "paper" | "thought" | "proposal" | "comment" | "reply",
  result: T,
  discussion: PreparedWorkspaceDiscussion,
  mutation?: MutationContext
) => runAtomic(async (client) => {
  const claim = await claimMutation<Record<string, unknown>>(client, publisher, mutation);
  if (claim.replayed) return { value: claim.response };
  const publishedDiscussion = await publishPreparedWorkspaceDiscussion(client, {
    discussion,
    postId: result.item.id,
    rootParentId: result.comment?.id ?? null
  });
  let publishedItem = result.item;
  if (publishedDiscussion.totalCount) {
    const critiques = incrementMetric(result.item.metrics.critiques, publishedDiscussion.activeCount);
    const signals = updateSignalValue(result.item.signals, "Critiques", critiques);
    let comments = result.item.comments;
    for (const comment of publishedDiscussion.comments) {
      const appended = appendCommentToTree(comments, comment);
      if (!appended.inserted) throw new Error("The published draft discussion could not be attached to its public destination.");
      comments = appended.comments;
    }
    const postRevision = await client.query<{ revision: number }>(
      `UPDATE posts
       SET metrics = $2, signals = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1
       RETURNING revision`,
      [result.item.id, JSON.stringify({ ...result.item.metrics, critiques }), JSON.stringify(signals)]
    );
    if (!postRevision.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Published post not found." });
    publishedItem = {
      ...result.item,
      comments,
      metrics: { ...result.item.metrics, critiques },
      signals,
      revision: postRevision.rows[0].revision
    };
  }
  const publishedComment = result.comment?.id
    ? findCommentInTree(publishedItem.comments, result.comment.id) ?? result.comment
    : result.comment;
  const publishedResult = {
    ...result,
    item: publishedItem,
    ...(publishedComment ? { comment: publishedComment } : {})
  };
  const sourceAttachmentIds = [
    ...await queueAttachmentsForOwnerStorageDeletion(
      client,
      "note",
      revision.noteId,
      "workspace_note_published"
    ),
    ...await queueAttachmentsForOwnerStorageDeletion(
      client,
      "note_comment",
      discussion.comments.map((comment) => comment.id),
      "workspace_discussion_published"
    )
  ];
  const changed = await client.query(
    `UPDATE notes
     SET lifecycle = 'published', published_at = now(), published_post_id = $3,
         deleted_at = now(), updated_at = now()
     WHERE id = $1 AND revision = $2 AND lifecycle = 'draft' AND deleted_at IS NULL
     RETURNING id`,
    [revision.noteId, revision.revision, result.item.id]
  );
  if (!changed.rowCount) throw new TRPCError({ code: "CONFLICT", message: "The draft changed before publication completed." });
  await client.query(
    `INSERT INTO note_publications (
       note_id, note_revision, checkpoint_id, post_id, published_comment_id, publisher_handle, visibility, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, 'public', $7)`,
    [
      revision.noteId,
      revision.revision,
      revision.checkpointId,
      target === "paper" || target === "thought" || target === "proposal" ? result.item.id : null,
      result.comment?.id ?? null,
      publisher,
      JSON.stringify({ source: "workspace", target, commentId: result.comment?.id ?? null })
    ]
  );
  await client.query(
    `UPDATE workspace_note_comments SET archived_at = COALESCE(archived_at, now())
     WHERE note_id = $1`,
    [revision.noteId]
  );
  const value = {
    ...publishedResult,
    publication: {
      noteId: revision.noteId,
      revision: revision.revision,
      checkpointId: revision.checkpointId,
      target,
      postId: result.item.id,
      commentId: result.comment?.id ?? null,
      visibility: "public" as const
    }
  };
  await stageAuditLog(client, {
    actorHandle: publisher,
    action: "note.publish",
    subjectType: target === "comment" || target === "reply" ? "comment" : "post",
    subjectId: String(result.comment?.id ?? result.item.id),
    metadata: mutationAuditMetadata(mutation, {
      noteId: revision.noteId,
      noteRevision: revision.revision,
      checkpointId: revision.checkpointId,
      target,
      sourceAttachmentCount: sourceAttachmentIds.length
    })
  });
  await completeMutation(client, publisher, mutation, value);
  const audience = await client.query<{ handle: string }>(
    `SELECT owner_handle AS handle FROM notes WHERE id = $1
     UNION SELECT $2 AS handle
     UNION SELECT grantee_handle AS handle FROM workspace_note_grants WHERE note_id = $1
     UNION SELECT notebook_grant.grantee_handle AS handle FROM notes note
       JOIN workspace_notebook_grants notebook_grant ON notebook_grant.notebook_id = note.notebook_id
       WHERE note.id = $1`,
    [revision.noteId, publisher]
  );
  const event = await stageEvent(client, {
    kind: "note.published",
    actorHandle: publisher,
    audienceHandles: audience.rows.map((row) => row.handle),
    subjectType: "note",
    subjectId: revision.noteId,
    visibility: "private",
    payload: { noteId: revision.noteId, revision: revision.revision, target, postId: result.item.id }
  });
  const publicEvent = await stageEvent(client, {
    kind: "post.updated",
    actorHandle: publisher,
    subjectType: "post",
    subjectId: result.item.id,
    visibility: "public",
    payload: { itemId: result.item.id, source: "workspace-publication" }
  });
  return { value, events: [event, publicEvent] };
});
