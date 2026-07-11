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
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { transitionCommentAction } from "./actions";
import { recordContentView, recordMemoryContentView } from "./contentViews";
import {
  actorHandle,
  commentTreesFromRows,
  ensureLiveData,
  getInitialState,
  newId,
  rowToItem,
  type CommentRow,
  type SnapshotRow
} from "./foundation";

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
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  if (isDeletedPost(existing)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
  }
  if (input.parentId && !findCommentInTree(existing.comments, input.parentId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
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
        forked_by AS "forkedBy"
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
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const lockedItem = rowToItem(row, existingComments);
    if (isDeletedPost(lockedItem)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
    }
    if (comment.parentId && !findCommentInTree(existingComments, comment.parentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }
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
        metrics, saved_by, signaled_by, forked_by, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        comment.createdAt
      ]
    );
    await client.query(
      `UPDATE posts
       SET metrics = $2,
           signals = $3,
           updated_at = now()
       WHERE id = $1`,
      [postId, JSON.stringify(lockedNextMetrics), JSON.stringify(lockedNextSignals)]
    );

    updatedItem = rowToItem(
      { ...row, metrics: lockedNextMetrics, signals: lockedNextSignals },
      appended.comments
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.create",
      subjectType: "comment",
      subjectId: comment.id as string,
      metadata: mutationAuditMetadata(mutation, {
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




export const updateComment = async (postId: string, commentId: string, rawInput: unknown, actor: Actor) => {
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
      editedAt
    }));
    return { ...existing, comments: mapped.comments };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
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
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted comments cannot be edited." });
    }
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this comment." });
    }

    const mapped = mapCommentTree(existingComments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      editedAt
    }));
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

    await client.query(
      `UPDATE comments
       SET body = $3,
           edited_at = $4,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [postId, commentId, input.body, editedAt]
    );

    updatedItem = rowToItem(row, mapped.comments);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.update",
      subjectType: "comment",
      subjectId: commentId,
      metadata: { editedAt, postId }
    });
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

  return updatedItem;
};

export const deleteComment = async (postId: string, commentId: string, rawInput: unknown, actor: Actor) => {
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
    return tombstoneCommentInItem(existing, commentId, deletedAt).item;
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let didDelete = false;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
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
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments);
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
             edited_at = NULL,
             deleted_at = $9,
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
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE comment_id = $1 AND active = true`,
        [commentId]
      );

      await client.query(
        `UPDATE posts
         SET metrics = $2,
             signals = $3,
             updated_at = now()
         WHERE id = $1`,
        [postId, JSON.stringify(deletion.item.metrics), JSON.stringify(deletion.item.signals)]
      );

      updatedItem = deletion.item;
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "comment.delete",
        subjectType: "comment",
        subjectId: commentId,
        metadata: { deletedAt, postId }
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
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (didDelete && stagedEvent) await publishStoredEvent(stagedEvent);

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
    const mapped = mapCommentTree(existing.comments, commentId, (comment) =>
      mutateCommentForActor(comment, input.action, handle, input.active)
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    return { item: { ...existing, comments: mapped.comments } };
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
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
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
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments);
      await completeMutation(client, handle, mutation, { item: updatedItem });
      await client.query("COMMIT");
      return { item: updatedItem };
    }

    if (
      input.action === "read" &&
      !(await recordContentView(client, "comment", commentId, handle, input.trigger, input.surface))
    ) {
      updatedItem = rowToItem(row, existingComments);
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

    const mapped = mapCommentTree(existingComments, commentId, () =>
      mutateCommentForActor(canonicalOriginal, input.action, handle, canonicalActive)
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    updatedComment = mapped.updated;

    await client.query(
      `UPDATE comments
       SET metrics = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
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

    updatedItem = rowToItem(row, mapped.comments);
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
