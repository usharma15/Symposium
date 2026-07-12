import { TRPCError } from "@trpc/server";
import {
  commentActionInputSchema,
  createCommentInputSchema,
  updateCommentInputSchema,
  type CanonicalActionActivityContract,
  type InquiryCommentContract,
  type InquiryItemContract,
  type PostActionInputContract,
  type ToggleActionContract
} from "../../../../packages/contracts/src";
import {
  appendCommentToTree,
  canManageComment,
  cleanHandle,
  commentMetricsFallback,
  findCommentInTree,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  mapCommentTree,
  mutateCommentForActor,
  setCommentActionMembership,
  tombstoneCommentInItem,
  updateSignalValue
} from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { assertUniqueAttachmentIds, canonicalAttachmentIds, replaceOwnerAttachments } from "../services/attachmentOwnership";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { markQuotedCommentUnavailable, resolveContentQuote, resolveUpdatedContentQuote } from "../services/contentQuotes";
import { queueAttachmentsForOwnerStorageDeletion, triggerStorageDeletion } from "../services/storageDeletion";
import { transitionCommentAction } from "./actions";
import { recordContentView, recordMemoryContentView } from "./contentViews";
import { actorHandle, commentTreesFromRows, ensureLiveData, getInitialState, getPostConversationAttachments, newId, rowToAttachment, rowToItem, type CommentRow, type SnapshotRow } from "./foundation";

type ActionMutationResult = {
  item: InquiryItemContract;
  activity?: CanonicalActionActivityContract;
};

export const addComment = async (
  postId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = createCommentInputSchema.parse(rawInput);
  const requestedAttachmentIds = canonicalAttachmentIds(input);
  assertUniqueAttachmentIds(requestedAttachmentIds, "comment");
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  if (isDeletedPost(existing)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
  }
  if (input.parentId && !findCommentInTree(existing.comments, input.parentId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
  }
  if (requestedAttachmentIds.length && (existing.room === "office" || existing.kind === "draft")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private comment attachments require protected delivery before they can be published."
    });
  }

  const handle = actorHandle(actor, input.authorHandle);
  if (
    (existing.room === "office" || existing.kind === "draft") &&
    (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  }
  const author = snapshot.profiles[handle];
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  const comment: InquiryCommentContract = {
    id: newId("comment"),
    revision: 1,
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance || "Comment",
    body: input.body,
    createdAt: new Date().toISOString(),
    metrics: { ...commentMetricsFallback },
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    attachments: [],
    replies: []
  };
  const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
  const nextMetrics = { ...existing.metrics, critiques: nextCritiques };
  const nextSignals = updateSignalValue(existing.signals, "Critiques", nextCritiques);
  const memoryAppend = appendCommentToTree(existing.comments, comment);

  if (!memoryAppend.inserted) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
  }

  if (!hasDatabase()) {
    return {
      comment,
      item: {
        ...existing,
        revision: (existing.revision ?? 1) + 1,
        metrics: nextMetrics,
        signals: nextSignals,
        comments: memoryAppend.comments
      }
    };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract | null = null;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<{
      comment: InquiryCommentContract;
      item: InquiryItemContract;
    }>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id,
        revision,
        kind,
        room,
        title,
        author_handle AS "authorHandle",
        author_name AS "authorName",
        affiliation,
        date_label AS "dateLabel",
        created_at AS "createdAt",
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status,
        metrics,
        gathering_reason AS "gatheringReason",
        excerpt,
        body,
        tags,
        signals,
        claims,
        objections,
        evidence,
        tests,
        forks,
        saved,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy",
        quote
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );

    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

    const commentsResult = await client.query<CommentRow>(
      `SELECT
        id,
        revision,
        post_id AS "postId",
        parent_id AS "parentId",
        author_handle AS "authorHandle",
        author_name AS "authorName",
        stance,
        body,
        metrics,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy",
        quote,
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const [commentAttachments, postAttachments] = await getPostConversationAttachments(
      client,
      postId,
      commentsResult.rows
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existingComments = commentsByPost.get(postId) ?? [];
    const lockedItem = rowToItem(row, existingComments);
    if (isDeletedPost(lockedItem)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
    }
    if (comment.parentId && !findCommentInTree(existingComments, comment.parentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }
    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: requestedAttachmentIds,
      ownerId: comment.id as string,
      ownerType: "comment",
      uploaderHandle: handle
    });
    comment.attachments = attachmentChange.attachments.map(rowToAttachment);
    comment.quote = await resolveContentQuote(client, input.quoteSource, { ownerId: comment.id as string, ownerType: "comment" });

    const lockedNextCritiques = incrementMetric(lockedItem.metrics.critiques, 1);
    const lockedNextMetrics = { ...lockedItem.metrics, critiques: lockedNextCritiques };
    const lockedNextSignals = updateSignalValue(lockedItem.signals, "Critiques", lockedNextCritiques);
    const appended = appendCommentToTree(existingComments, comment);
    if (!appended.inserted) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }

    await client.query(
      `INSERT INTO comments (
        id, post_id, parent_id, author_handle, author_name, stance, body,
        metrics, saved_by, signaled_by, forked_by, quote, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        comment.id,
        postId,
        comment.parentId,
        comment.authorHandle,
        comment.author,
        comment.stance,
        comment.body,
        JSON.stringify(comment.metrics),
        JSON.stringify(comment.savedBy),
        JSON.stringify(comment.signaledBy),
        JSON.stringify(comment.forkedBy),
        comment.quote ? JSON.stringify(comment.quote) : null,
        comment.createdAt
      ]
    );
    const revisionResult = await client.query<{ revision: number }>(
      `UPDATE posts
       SET metrics = $2,
           signals = $3,
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING revision`,
      [postId, JSON.stringify(lockedNextMetrics), JSON.stringify(lockedNextSignals)]
    );

    updatedItem = rowToItem(
      {
        ...row,
        metrics: lockedNextMetrics,
        signals: lockedNextSignals,
        revision: revisionResult.rows[0].revision
      },
      appended.comments,
      postAttachments.get(postId) ?? []
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.create",
      subjectType: "comment",
      subjectId: comment.id as string,
      metadata: mutationAuditMetadata(mutation, {
        attachmentCount: comment.attachments.length,
        quotedSourceType: comment.quote?.sourceType,
        parentId: comment.parentId,
        postId
      })
    });
    await completeMutation(client, handle, mutation, { comment, item: updatedItem });
    stagedEvent = await stageEvent(client, {
      kind: "comment.created",
      actorHandle: comment.authorHandle,
      subjectType: "post",
      subjectId: postId,
      visibility: existing.room === "office" || existing.kind === "draft" ? "private" : "public",
      payload:
        existing.room === "office" || existing.kind === "draft"
          ? { comment, item: updatedItem, commentId: comment.id, parentId: comment.parentId }
          : { commentId: comment.id, itemId: postId, parentId: comment.parentId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return { comment, item: updatedItem };
};

export const updateComment = async (
  postId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updateCommentInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  const editedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted comments cannot be edited." });
    }
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this comment." });
    }
    const mapped = mapCommentTree(existing.comments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      editedAt,
      revision: (comment.revision ?? 1) + 1
    }));
    return { ...existing, comments: mapped.comments, revision: (existing.revision ?? 1) + 1 };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let removedAttachmentIds: string[] = [];
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, revision, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const [commentAttachments, postAttachments] = await getPostConversationAttachments(client, postId, commentsResult.rows);
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted comments cannot be edited." });
    }
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this comment." });
    }
    const currentEditedAt = original.editedAt ?? null;
    if (input.expectedEditedAt !== undefined && input.expectedEditedAt !== currentEditedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This comment changed after it was opened. Refresh before saving content references."
      });
    }
    if (input.attachmentIds?.length && (row.room === "office" || row.kind === "draft")) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Private comment attachments require protected delivery before they can be published."
      });
    }

    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: commentId,
      ownerType: "comment",
      uploaderHandle: handle
    });
    removedAttachmentIds = attachmentChange.removedAttachmentIds;
    const quote = await resolveUpdatedContentQuote(client, original.quote, input.quoteSource, { ownerId: commentId, ownerType: "comment" });

    const mapped = mapCommentTree(existingComments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      attachments: attachmentChange.attachments.map(rowToAttachment),
      quote,
      editedAt,
      revision: (comment.revision ?? 1) + 1
    }));
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

    await client.query(
      `UPDATE comments
       SET body = $3,
           edited_at = $4,
           quote = $5,
           revision = revision + 1,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [postId, commentId, input.body, editedAt, quote ? JSON.stringify(quote) : null]
    );

    const postRevisionResult = await client.query<{ revision: number }>(
      `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision`,
      [postId]
    );
    updatedItem = rowToItem(
      { ...row, revision: postRevisionResult.rows[0].revision },
      mapped.comments,
      postAttachments.get(postId) ?? []
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.update",
      subjectType: "comment",
      subjectId: commentId,
      metadata: {
        attachmentCount: attachmentChange.attachments.length,
        removedAttachmentCount: removedAttachmentIds.length,
        quotedSourceType: quote?.sourceType,
        editedAt,
        postId
      }
    });
    await completeMutation(client, handle, mutation, updatedItem);
    stagedEvent = await stageEvent(client, {
      kind: "comment.updated",
      actorHandle: handle,
      subjectType: "comment",
      subjectId: commentId,
      visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : "public",
      payload:
        updatedItem.room === "office" || updatedItem.kind === "draft"
          ? { item: updatedItem, commentId }
          : { itemId: postId, commentId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);
  if (removedAttachmentIds.length) await triggerStorageDeletion(removedAttachmentIds);

  return updatedItem;
};

export const deleteComment = async (
  postId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = rawInput && typeof rawInput === "object" ? (rawInput as { actorHandle?: unknown }) : {};
  const handle = actorHandle(actor, typeof input.actorHandle === "string" ? input.actorHandle : undefined);
  const deletedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) return existing;
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this comment." });
    }
    const deletion = tombstoneCommentInItem(existing, commentId, deletedAt);
    if (!deletion.deletedComment) return existing;
    const comments = mapCommentTree(deletion.item.comments, commentId, (comment) => ({
      ...comment,
      revision: (original.revision ?? 1) + 1
    })).comments;
    return { ...deletion.item, comments, revision: (existing.revision ?? 1) + 1 };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let didDelete = false;
  let storageAttachmentIds: string[] = [];
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, revision, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const [commentAttachments, postAttachments] = await getPostConversationAttachments(client, postId, commentsResult.rows);
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments, postAttachments.get(postId) ?? []);
      await markQuotedCommentUnavailable(client, commentId);
      storageAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(
        client,
        "comment",
        commentId,
        "comment_deleted"
      );
      await completeMutation(client, handle, mutation, updatedItem);
      await client.query("COMMIT");
    } else {
      if (!canManageComment(original, handle)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this comment." });
      }
      const deletion = tombstoneCommentInItem(rowToItem(row, existingComments), commentId, deletedAt);
      if (!deletion.deletedComment) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

      await client.query(
        `UPDATE comments
         SET author_handle = NULL,
             author_name = $3,
             stance = $4,
             body = $5,
             saved_by = $6,
             signaled_by = $7,
             forked_by = $8,
             quote = NULL,
             edited_at = NULL,
             deleted_at = $9,
             revision = revision + 1,
             updated_at = now()
         WHERE post_id = $1 AND id = $2`,
        [
          postId,
          commentId,
          deletion.deletedComment.author,
          deletion.deletedComment.stance,
          deletion.deletedComment.body,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          deletion.deletedComment.deletedAt
        ]
      );
      await markQuotedCommentUnavailable(client, commentId);
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE comment_id = $1 AND active = true`,
        [commentId]
      );

      const postRevisionResult = await client.query<{ revision: number }>(
        `UPDATE posts
         SET metrics = $2,
             signals = $3,
             revision = revision + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING revision`,
        [postId, JSON.stringify(deletion.item.metrics), JSON.stringify(deletion.item.signals)]
      );

      const comments = mapCommentTree(deletion.item.comments, commentId, (comment) => ({
        ...comment,
        attachments: [],
        revision: (original.revision ?? 1) + 1
      })).comments;
      updatedItem = {
        ...deletion.item,
        comments,
        attachments: postAttachments.get(postId) ?? [],
        revision: postRevisionResult.rows[0].revision
      };
      storageAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(
        client,
        "comment",
        commentId,
        "comment_deleted"
      );
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "comment.delete",
        subjectType: "comment",
        subjectId: commentId,
        metadata: { deletedAt, postId, storageAttachmentCount: storageAttachmentIds.length }
      });
      stagedEvent = await stageEvent(client, {
        kind: "comment.deleted",
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : "public",
        payload:
          updatedItem.room === "office" || updatedItem.kind === "draft"
            ? { item: updatedItem, commentId }
            : { itemId: postId, commentId }
      });
      await completeMutation(client, handle, mutation, updatedItem);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (didDelete && stagedEvent) await publishStoredEvent(stagedEvent);
  if (storageAttachmentIds.length) await triggerStorageDeletion(storageAttachmentIds);

  return updatedItem;
};

export const applyCommentAction = async (
  postId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<ActionMutationResult> => {
  const input: PostActionInputContract = commentActionInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) return { item: existing };
    if (input.action === "read" && !recordMemoryContentView("comment", commentId, handle)) {
      return { item: existing };
    }
    const mapped = mapCommentTree(existing.comments, commentId, (comment) => ({
      ...mutateCommentForActor(comment, input.action, handle, input.active),
      revision: (comment.revision ?? 1) + 1
    }));
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    return {
      item: { ...existing, comments: mapped.comments, revision: (existing.revision ?? 1) + 1 }
    };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let updatedComment: InquiryCommentContract | undefined;
  let activity: CanonicalActionActivityContract | undefined;
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ActionMutationResult>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, revision, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const [commentAttachments, postAttachments] = await getPostConversationAttachments(client, postId, commentsResult.rows);
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments, postAttachments.get(postId) ?? []);
      await completeMutation(client, handle, mutation, { item: updatedItem });
      await client.query("COMMIT");
      return { item: updatedItem };
    }

    if (
      input.action === "read" &&
      !(await recordContentView(client, "comment", commentId, handle, input.trigger, input.surface))
    ) {
      updatedItem = rowToItem(row, existingComments, postAttachments.get(postId) ?? []);
      await completeMutation(client, handle, mutation, { item: updatedItem });
      await client.query("COMMIT");
      return { item: updatedItem };
    }

    let canonicalOriginal = original;
    let canonicalActive = input.active;
    if (input.action !== "read") {
      const transition = await transitionCommentAction(
        client,
        postId,
        commentId,
        handle,
        input.action as ToggleActionContract,
        input.active
      );
      activity = transition.activity;
      canonicalActive = transition.activity.active;
      canonicalOriginal = setCommentActionMembership(
        original,
        input.action,
        handle,
        transition.previousActive
      );
    }

    const mapped = mapCommentTree(existingComments, commentId, () => ({
      ...mutateCommentForActor(canonicalOriginal, input.action, handle, canonicalActive),
      revision: (canonicalOriginal.revision ?? 1) + 1
    })
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    updatedComment = mapped.updated;

    await client.query(
      `UPDATE comments
       SET metrics = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           revision = revision + 1,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [
        postId,
        commentId,
        JSON.stringify(updatedComment.metrics ?? commentMetricsFallback),
        JSON.stringify(updatedComment.savedBy ?? []),
        JSON.stringify(updatedComment.signaledBy ?? []),
        JSON.stringify(updatedComment.forkedBy ?? [])
      ]
    );

    const postRevisionResult = await client.query<{ revision: number }>(
      `UPDATE posts SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision`,
      [postId]
    );
    updatedItem = rowToItem(
      { ...row, revision: postRevisionResult.rows[0].revision },
      mapped.comments,
      postAttachments.get(postId) ?? []
    );
    if (input.action !== "read") {
      await stageAuditLog(client, {
        actorHandle: handle,
        action: `comment.${input.action}`,
        subjectType: "comment",
        subjectId: commentId,
        metadata: mutationAuditMetadata(mutation, { active: activity?.active, postId })
      });
    }
    await completeMutation(client, handle, mutation, { item: updatedItem, activity });
    const privatePost = updatedItem.room === "office" || updatedItem.kind === "draft";
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `comment.${input.action}`,
          subjectType: "comment",
          subjectId: commentId,
          payload: { action: input.action, commentId, itemId: postId }
        })
      );
    }
    stagedEvents.push(
      await stageEvent(client, {
        kind: `comment.${input.action}`,
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: "private",
        payload: { action: input.action, active: activity?.active, activity, item: updatedItem, commentId }
      })
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);

  return { item: updatedItem, activity };
};
