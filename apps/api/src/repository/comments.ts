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
import {
  createNotifications,
  notificationActorName,
  type CreateNotificationInput
} from "../services/notificationDelivery";
import { transitionCommentAction } from "./actions";
import { assertCommunityParticipation, assertCommunityReadAccess, communityEventScope, stageCommunityProfileInvalidation } from "./communities";
import { assertCommunityCommentDeletion } from "./communityAuthorization";
import { recordContentView, recordMemoryContentView } from "./contentViews";
import { actorHandle, commentTreesFromRows, ensureLiveData, getInitialState, getPostConversationAttachments, getProfileByHandle, newId, rowToAttachment, rowToItem, type CommentRow, type SnapshotRow } from "./foundation";
type ActionMutationResult = {
  item: InquiryItemContract;
  activity?: CanonicalActionActivityContract;
};
export const addComment = async (postId: string, rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommentInputSchema.parse(rawInput);
  const requestedAttachmentIds = canonicalAttachmentIds(input);
  assertUniqueAttachmentIds(requestedAttachmentIds, "comment");
  const handle = actorHandle(actor, input.authorHandle);
  const author = await getProfileByHandle(handle);
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  const comment: InquiryCommentContract = {
    id: newId("comment"),
    revision: 1,
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance || "Comment",
    body: input.body,
    document: input.document,
    createdAt: new Date().toISOString(),
    metrics: { ...commentMetricsFallback },
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    attachments: [],
    replies: []
  };
  if (!hasDatabase()) {
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
    if (existing.communityId && existing.postType !== "paper") await assertCommunityParticipation(existing.communityId, handle);
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
    const nextMetrics = { ...existing.metrics, critiques: nextCritiques };
    const nextSignals = updateSignalValue(existing.signals, "Critiques", nextCritiques);
    const memoryAppend = appendCommentToTree(existing.comments, comment);
    if (!memoryAppend.inserted) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }
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
  const stagedEvents: StoredLiveEvent[] = [];

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
        id, revision, kind, post_type AS "postType", room, community_id AS "communityId",
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
        body, content_document AS "document",
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
        quote, patronage, opportunity
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
        body, content_document AS "document",
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
    if (lockedItem.communityId && lockedItem.postType !== "paper") {
      await assertCommunityParticipation(lockedItem.communityId, handle);
    }
    if (
      (lockedItem.room === "office" || lockedItem.kind === "draft") &&
      (!lockedItem.authorHandle || cleanHandle(lockedItem.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (requestedAttachmentIds.length && (lockedItem.room === "office" || lockedItem.kind === "draft")) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Private comment attachments require protected delivery before they can be published."
      });
    }
    const parentComment = comment.parentId
      ? findCommentInTree(existingComments, comment.parentId)
      : null;
    if (comment.parentId && !parentComment) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }
    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: requestedAttachmentIds,
      ownerId: comment.id as string,
      ownerType: "comment",
      uploaderHandle: handle
    });
    comment.attachments = attachmentChange.attachments.map(rowToAttachment);
    comment.quote = await resolveContentQuote(client, input.quoteSource, {
      ownerId: comment.id as string, ownerType: "comment", actorHandle: handle,
      targetCommunityId: lockedItem.communityId, targetPostType: lockedItem.postType
    });

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
    if (input.document) await client.query("UPDATE comments SET content_document = $2 WHERE id = $1", [comment.id, JSON.stringify(input.document)]);
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
    const eventScope = await communityEventScope(client, lockedItem.postType === "paper" ? null : lockedItem.communityId);
    const eligibleCommunityRecipients = eventScope.visibility === "community"
      ? new Set(eventScope.audienceHandles ?? [])
      : null;
    const canNotify = (recipient: string | null | undefined) =>
      Boolean(
        recipient &&
        recipient !== handle &&
        (!eligibleCommunityRecipients || eligibleCommunityRecipients.has(recipient))
      );
    const notificationInputs: CreateNotificationInput[] = [];
    if (canNotify(parentComment?.authorHandle)) {
      notificationInputs.push({
        profileHandle: parentComment!.authorHandle!,
        kind: "comment_reply",
        title: `${comment.author} replied to your comment`,
        body: lockedItem.title,
        href: `/posts/${encodeURIComponent(postId)}?comment=${encodeURIComponent(comment.id as string)}`,
        dedupeKey: `comment-reply:${comment.id}:${parentComment!.authorHandle}`,
        metadata: { postId, commentId: comment.id, parentCommentId: parentComment!.id, actorHandle: handle }
      });
    }
    if (
      canNotify(lockedItem.authorHandle) &&
      lockedItem.authorHandle !== parentComment?.authorHandle
    ) {
      notificationInputs.push({
        profileHandle: lockedItem.authorHandle!,
        kind: "post_comment",
        title: `${comment.author} commented on your ${lockedItem.postType ?? "post"}`,
        body: lockedItem.title,
        href: `/posts/${encodeURIComponent(postId)}?comment=${encodeURIComponent(comment.id as string)}`,
        dedupeKey: `post-comment:${comment.id}:${lockedItem.authorHandle}`,
        metadata: {
          postId,
          commentId: comment.id,
          actorHandle: handle,
          subjectLabel: lockedItem.postType ?? "post"
        }
      });
    }
    const createdNotifications = await createNotifications(client, notificationInputs);
    stagedEvents.push(...createdNotifications.events);
    stagedEvents.push(await stageEvent(client, {
      kind: "comment.created",
      actorHandle: comment.authorHandle,
      subjectType: "post",
      subjectId: postId,
      visibility: lockedItem.room === "office" || lockedItem.kind === "draft" ? "private" : eventScope.visibility,
      audienceHandles: lockedItem.room === "office" || lockedItem.kind === "draft" ? [handle] : eventScope.audienceHandles,
      payload:
        lockedItem.room === "office" || lockedItem.kind === "draft"
          ? { comment, item: updatedItem, commentId: comment.id, parentId: comment.parentId }
          : { commentId: comment.id, itemId: postId, parentId: comment.parentId }
    }));
    await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);

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
    if (existing.communityId && existing.postType !== "paper") await assertCommunityReadAccess(existing.communityId, handle);
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
      document: input.document ?? comment.document,
      editedAt,
      revision: (comment.revision ?? 1) + 1
    }));
    return { ...existing, comments: mapped.comments, revision: (existing.revision ?? 1) + 1 };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let removedAttachmentIds: string[] = [];
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, revision, kind, post_type AS "postType", room, community_id AS "communityId", title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, content_document AS "document", tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, patronage, opportunity
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (row.communityId && row.postType !== "paper") await assertCommunityReadAccess(row.communityId, handle);
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, content_document AS "document", metrics, saved_by AS "savedBy",
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
    const quote = await resolveUpdatedContentQuote(client, original.quote, input.quoteSource, {
      ownerId: commentId, ownerType: "comment", actorHandle: handle,
      targetCommunityId: row.communityId, targetPostType: row.postType
    });

    const mapped = mapCommentTree(existingComments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      document: input.document ?? comment.document,
      attachments: attachmentChange.attachments.map(rowToAttachment),
      quote,
      editedAt,
      revision: (comment.revision ?? 1) + 1
    }));
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

    await client.query(
      `UPDATE comments
       SET body = $3,
           content_document = $6,
           edited_at = $4,
           quote = $5,
           revision = revision + 1,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [postId, commentId, input.body, editedAt, quote ? JSON.stringify(quote) : null, input.document ? JSON.stringify(input.document) : original.document ? JSON.stringify(original.document) : null]
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
    const eventScope = await communityEventScope(client, updatedItem.postType === "paper" ? null : updatedItem.communityId);
    stagedEvents.push(await stageEvent(client, {
      kind: "comment.updated",
      actorHandle: handle,
      subjectType: "comment",
      subjectId: commentId,
      visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : eventScope.visibility,
      audienceHandles: updatedItem.room === "office" || updatedItem.kind === "draft" ? [handle] : eventScope.audienceHandles,
      payload:
        updatedItem.room === "office" || updatedItem.kind === "draft"
          ? { item: updatedItem, commentId }
          : { itemId: postId, commentId }
    }));
    await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);
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
    if (existing.communityId && existing.postType !== "paper") await assertCommunityReadAccess(existing.communityId, handle);
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
      await assertCommunityCommentDeletion(existing, handle);
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
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, revision, kind, post_type AS "postType", room, community_id AS "communityId", title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, content_document AS "document", tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, patronage, opportunity
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (row.communityId && row.postType !== "paper") await assertCommunityReadAccess(row.communityId, handle);
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, content_document AS "document", metrics, saved_by AS "savedBy",
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
        await assertCommunityCommentDeletion(row, handle, client);
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
      const eventScope = await communityEventScope(client, updatedItem.postType === "paper" ? null : updatedItem.communityId);
      stagedEvents.push(await stageEvent(client, {
        kind: "comment.deleted",
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : eventScope.visibility,
        audienceHandles: updatedItem.room === "office" || updatedItem.kind === "draft" ? [handle] : eventScope.audienceHandles,
        payload:
          updatedItem.room === "office" || updatedItem.kind === "draft"
            ? { item: updatedItem, commentId }
            : { itemId: postId, commentId }
      }));
      await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
      await completeMutation(client, handle, mutation, updatedItem);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (didDelete) for (const event of stagedEvents) await publishStoredEvent(event);
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
    if (existing.communityId && existing.postType !== "paper") await assertCommunityReadAccess(existing.communityId, handle);
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
  let actionChanged = false;
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
        id, revision, kind, post_type AS "postType", room, community_id AS "communityId", title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, content_document AS "document", tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, patronage, opportunity
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (row.communityId && row.postType !== "paper") await assertCommunityReadAccess(row.communityId, handle);
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, revision, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, content_document AS "document", metrics, saved_by AS "savedBy",
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
      actionChanged = transition.changed;
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
    const eventScope = await communityEventScope(client, updatedItem.postType === "paper" ? null : updatedItem.communityId);
    if (input.action !== "read") {
      await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
    }
    const canNotifyAuthor =
      !privatePost &&
      actionChanged &&
      activity?.active === true &&
      (input.action === "signal" || input.action === "fork") &&
      Boolean(original.authorHandle && original.authorHandle !== handle) &&
      (
        eventScope.visibility !== "community" ||
        Boolean(original.authorHandle && eventScope.audienceHandles?.includes(original.authorHandle))
      );
    if (canNotifyAuthor) {
      const actionLabel = input.action === "signal" ? "liked" : "reshared";
      const analyticsView = input.action === "signal" ? "likes" : "reshares";
      const createdNotifications = await createNotifications(client, [{
        profileHandle: original.authorHandle!,
        kind: input.action === "signal" ? "comment_signal" : "comment_reshare",
        title: `${await notificationActorName(client, handle)} ${actionLabel} your comment`,
        body: updatedItem.title,
        href: `/posts/${encodeURIComponent(postId)}?comment=${encodeURIComponent(commentId)}&analytics=${analyticsView}`,
        dedupeKey: `comment-${input.action}:${commentId}:${handle}:${activity!.revision}`,
        metadata: { postId, commentId, action: input.action, actorHandle: handle, analyticsView }
      }]);
      stagedEvents.push(...createdNotifications.events);
    }
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `comment.${input.action}`,
          subjectType: "comment",
          subjectId: commentId,
          visibility: eventScope.visibility,
          audienceHandles: eventScope.audienceHandles,
          payload: {
            action: input.action,
            commentId,
            itemId: postId,
            metrics: updatedComment.metrics,
            revision: updatedItem.revision,
            commentRevision: updatedComment.revision
          }
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
