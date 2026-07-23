import { TRPCError } from "@trpc/server";
import {
  createPostInputSchema,
  documentFitsReducedEditor,
  postActionInputSchema,
  updatePostInputSchema,
  type CanonicalActionActivityContract,
  type InquiryItemContract,
  type PostActionInputContract,
  type ToggleActionContract
} from "../../../../packages/contracts/src";
import {
  cleanHandle,
  isDeletedPost,
  mutateItemForActor,
  setItemActionMembership,
  tombstonePost
} from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { markQuotedPostUnavailable, resolveContentQuote } from "../services/contentQuotes";
import {
  contentMentionNotificationInputs,
  quoteAnalyticsSubjects,
  quoteNotificationInput,
  sameQuoteSource
} from "../services/contentNotifications";
import {
  createPatronageProjection,
  insertPatronageProposal,
  patronagePostStatus,
  updatePatronageProjection,
  updatePatronageProposal
} from "../services/patronage";
import {
  assertUniqueAttachmentIds,
  canonicalAttachmentIds,
  replaceOwnerAttachments
} from "../services/attachmentOwnership";
import { queueAttachmentsForOwnerStorageDeletion, triggerStorageDeletion } from "../services/storageDeletion";
import {
  createNotifications,
  notificationActorName,
  resolveNotifications
} from "../services/notificationDelivery";
import { assertCanonicalOpportunityUpdate, createOpportunityProjection, opportunityPostStatus, updateOpportunityProjection } from "../services/opportunityPosts";
import { transitionPostAction } from "./actions";
import { assertCommunityParticipation, assertCommunityReadAccess, communityEventScope, stageCommunityProfileInvalidation } from "./communities";
import { assertCommunityPostDeletion } from "./communityAuthorization";
import { recordContentView, recordMemoryContentView } from "./contentViews";
import {
  actorHandle,
  commentTreesFromRows,
  defaultProfile,
  ensureLiveData,
  getActiveAttachmentsByOwner,
  getInitialState,
  getProfileByHandle,
  newId,
  rowToAttachment,
  rowToItem,
  searchablePostText,
  type AttachmentRow,
  type CommentRow,
  type SnapshotRow
} from "./foundation";
type ActionMutationResult = {
  item: InquiryItemContract;
  activity?: CanonicalActionActivityContract;
};
const lockedPostSelect = `SELECT
  id, revision, kind, post_type AS "postType", room, community_id AS "communityId", title, author_handle AS "authorHandle", author_name AS "authorName",
  affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt", deleted_at AS "deletedAt",
  status, metrics, gathering_reason AS "gatheringReason", excerpt, body, content_document AS "document", tags, signals,
  claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
  signaled_by AS "signaledBy", forked_by AS "forkedBy", quote, patronage, opportunity
 FROM posts
 WHERE id = $1
 FOR UPDATE`;

export const createPost = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createPostInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.authorHandle);
  const author = await getProfileByHandle(handle);
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  if (input.communityId) await assertCommunityParticipation(input.communityId, handle);
  const isPaper = input.kind === "paper";
  const patronage = createPatronageProjection(input.patronage);
  const isProposal = Boolean(patronage);
  const opportunity = createOpportunityProjection(input.opportunity);
  const isOpportunity = Boolean(opportunity);
  const postStatus = patronagePostStatus(patronage, isPaper ? "Draft" : "New");
  const legacyRequestedAttachments = (input.attachments ?? []).map((attachment) => ({
    ...attachment,
    status: "uploaded" as const
  }));
  const requestedAttachmentIds = canonicalAttachmentIds(input);
  assertUniqueAttachmentIds(requestedAttachmentIds, "post");
  if (requestedAttachmentIds.length && (input.room === "office" || input.kind === "draft")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private post attachments require protected delivery before they can be published."
    });
  }
  const item: InquiryItemContract = {
    id: newId("post"),
    revision: 1,
    kind: input.kind,
    postType: input.postType,
    room: input.room,
    communityId: input.communityId,
    title: input.title,
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    createdAt: new Date().toISOString(),
    status: opportunityPostStatus(opportunity, postStatus),
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: isProposal ? "A public Patronage proposal seeking practical support." : isOpportunity ? "A public opportunity inviting applications." : "A new working post added to the live beta.",
    excerpt: input.body,
    body: input.body,
    document: input.document,
    tags: [input.room, input.kind, ...(isProposal ? ["patronage", "proposal"] : []), ...(isOpportunity ? ["opportunity", opportunity!.kind] : []), ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: postStatus },
      { label: "Critiques", value: "0" },
      { label: "Forks", value: "0" },
      { label: "Next action", value: "Invite critique" }
    ],
    claims: [input.body],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    comments: [],
    attachments: hasDatabase() ? [] : legacyRequestedAttachments,
    patronage,
    opportunity,
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (!hasDatabase()) return item;
  await ensureLiveData();

  const client = await getPool().connect();
  let attachedRows: AttachmentRow[] = [];
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    item.quote = await resolveContentQuote(client, input.quoteSource, {
      ownerId: item.id, ownerType: "post", actorHandle: handle, targetCommunityId: item.communityId, targetPostType: item.postType
    });
    await client.query(
      `INSERT INTO posts (
        id, kind, post_type, room, community_id, title, author_handle, author_name, affiliation, date_label, created_at, status,
        metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
        tests, forks, saved, saved_by, signaled_by, forked_by, quote, search_text, patronage, opportunity, visibility
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
      )`,
      [
        item.id,
        item.kind,
        item.postType,
        item.room,
        item.communityId ?? null,
        item.title,
        item.authorHandle,
        item.author,
        item.affiliation,
        item.date,
        item.createdAt,
        item.status,
        JSON.stringify(item.metrics),
        item.gatheringReason,
        item.excerpt,
        item.body,
        JSON.stringify(item.tags),
        JSON.stringify(item.signals),
        JSON.stringify(item.claims),
        JSON.stringify(item.objections),
        JSON.stringify(item.evidence),
        JSON.stringify(item.tests),
        JSON.stringify(item.forks),
        item.saved,
        JSON.stringify(item.savedBy ?? []),
        JSON.stringify(item.signaledBy ?? []),
        JSON.stringify(item.forkedBy ?? []),
        item.quote ? JSON.stringify(item.quote) : null,
        searchablePostText({ ...item, authorName: item.author }),
        item.patronage ? JSON.stringify(item.patronage) : null,
        item.opportunity ? JSON.stringify(item.opportunity) : null,
        item.communityId && item.postType !== "paper" ? "community" : "public"
      ]
    );
    await insertPatronageProposal(client, item.id, item.patronage);
    if (input.document) {
      await client.query("UPDATE posts SET content_document = $2 WHERE id = $1", [item.id, JSON.stringify(input.document)]);
    }

    if (item.authorHandle && item.savedBy?.includes(item.authorHandle)) {
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
         VALUES ($1, $2, 'save', true, 1, 1, $3, $3)
         ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
        [item.id, item.authorHandle, item.createdAt]
      );
    }

    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: requestedAttachmentIds,
      ownerId: item.id,
      ownerType: "post",
      uploaderHandle: handle
    });
    attachedRows = attachmentChange.attachments;

    item.attachments = attachedRows.map(rowToAttachment);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.create",
      subjectType: "post",
      subjectId: item.id,
      metadata: mutationAuditMetadata(mutation, {
        attachmentCount: item.attachments.length,
        quotedSourceType: item.quote?.sourceType,
        kind: item.kind,
        room: item.room
      })
    });
    await completeMutation(client, handle, mutation, item);
    const eventScope = await communityEventScope(client, item.postType === "paper" ? null : item.communityId);
    stagedEvents.push(await stageEvent(client, {
      kind: "post.created",
      actorHandle: item.authorHandle,
      subjectType: "post",
      subjectId: item.id,
      visibility: item.room === "office" || item.kind === "draft" ? "private" : eventScope.visibility,
      audienceHandles: item.room === "office" || item.kind === "draft" ? [handle] : eventScope.audienceHandles,
      payload: {
        item,
        room: item.room,
        kind: item.kind,
        title: item.title,
        analyticsSubjects: quoteAnalyticsSubjects(item.quote)
      }
    }));
    if (item.room !== "office" && item.kind !== "draft") {
      const mentionNotifications = await contentMentionNotificationInputs(client, {
        sourceType: "post",
        sourceId: item.id,
        postId: item.id,
        communityId: item.communityId,
        actorHandle: handle,
        actorName: author.name,
        body: item.title,
        href: `/posts/${encodeURIComponent(item.id)}`,
        next: { body: item.body, document: item.document },
        audienceHandles: eventScope.visibility === "community"
          ? eventScope.audienceHandles
          : undefined
      });
      const quoteRecipient = item.quote?.authorHandle
        ? cleanHandle(item.quote.authorHandle)
        : null;
      const quoteNotification = quoteNotificationInput({
        quote: item.quote,
        quoteOwnerType: "post",
        quoteOwnerId: item.id,
        quoteOwnerPostId: item.id,
        actorHandle: handle,
        actorName: author.name,
        body: item.title,
        communityId: item.communityId,
        recipientCanRead: eventScope.visibility !== "community"
          || Boolean(quoteRecipient && eventScope.audienceHandles?.includes(quoteRecipient))
      });
      const createdNotifications = await createNotifications(client, [
        ...mentionNotifications.inputs,
        ...(quoteNotification ? [quoteNotification] : [])
      ]);
      stagedEvents.push(...createdNotifications.events);
    }
    await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);

  return item;
};

export const applyPostAction = async (
  postId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<ActionMutationResult> => {
  const input: PostActionInputContract = postActionInputSchema.parse(rawInput);
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
    if (isDeletedPost(existing)) return { item: existing };
    if (input.action === "read" && !recordMemoryContentView("post", postId, handle)) {
      return { item: existing };
    }
    return {
      item: {
        ...mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active),
        revision: (existing.revision ?? 1) + 1
      }
    };
  }

  await ensureLiveData();

  const client = await getPool().connect();
  let updated: InquiryItemContract;
  const stagedEvents: StoredLiveEvent[] = [];
  let activity: CanonicalActionActivityContract | undefined;
  let actionChanged = false;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ActionMutationResult>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(lockedPostSelect, [postId]);

    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (row.communityId && row.postType !== "paper") await assertCommunityReadAccess(row.communityId, handle);

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
        content_document AS "document",
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
    const [commentAttachments, postAttachments] = await Promise.all([
      getActiveAttachmentsByOwner(client, "comment", commentsResult.rows.map((comment) => comment.id)),
      getActiveAttachmentsByOwner(client, "post", [postId])
    ]);
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existing = rowToItem(
      row,
      commentsByPost.get(postId) ?? [],
      postAttachments.get(postId) ?? []
    );
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (isDeletedPost(existing)) {
      updated = existing;
      await completeMutation(client, handle, mutation, { item: updated });
      await client.query("COMMIT");
      return { item: updated };
    }

    if (
      input.action === "read" &&
      !(await recordContentView(client, "post", postId, handle, input.trigger, input.surface))
    ) {
      updated = existing;
      await completeMutation(client, handle, mutation, { item: updated });
      await client.query("COMMIT");
      return { item: updated };
    }

    if (input.action === "read") {
      updated = mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active);
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision)
         VALUES ($1, $2, $3, true, 1, 1)
         ON CONFLICT (post_id, actor_handle, action)
         DO UPDATE SET
           active = true,
           count = post_actions.count + 1,
           revision = post_actions.revision + 1,
           updated_at = now()`,
        [postId, handle, input.action]
      );
    } else {
      const transition = await transitionPostAction(
        client,
        postId,
        handle,
        input.action as ToggleActionContract,
        input.active
      );
      activity = transition.activity;
      actionChanged = transition.changed;
      const reconciled = setItemActionMembership(
        existing,
        input.action,
        handle,
        transition.previousActive,
        defaultProfile.handle
      );
      updated = mutateItemForActor(
        reconciled,
        input.action,
        handle,
        defaultProfile.handle,
        transition.activity.active
      );
    }

    const revisionResult = await client.query<{ revision: number }>(
      `UPDATE posts
       SET metrics = $2,
           saved = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           signals = $7,
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING revision`,
      [
        postId,
        JSON.stringify(updated.metrics),
        Boolean(updated.saved),
        JSON.stringify(updated.savedBy ?? []),
        JSON.stringify(updated.signaledBy ?? []),
        JSON.stringify(updated.forkedBy ?? []),
        JSON.stringify(updated.signals)
      ]
    );
    updated = { ...updated, revision: revisionResult.rows[0].revision };

    if (input.action !== "read") {
      await stageAuditLog(client, {
        actorHandle: handle,
        action: `post.${input.action}`,
        subjectType: "post",
        subjectId: postId,
        metadata: mutationAuditMetadata(mutation, { active: activity?.active })
      });
    }
    await completeMutation(client, handle, mutation, { item: updated, activity });
    const privatePost = updated.room === "office" || updated.kind === "draft";
    const eventScope = await communityEventScope(client, updated.postType === "paper" ? null : updated.communityId);
    await stageCommunityProfileInvalidation(client, handle, input.action !== "read" && eventScope.visibility === "community", stagedEvents);
    const canNotifyAuthor =
      !privatePost &&
      actionChanged &&
      activity?.active === true &&
      (input.action === "signal" || input.action === "fork") &&
      Boolean(updated.authorHandle && updated.authorHandle !== handle) &&
      (
        eventScope.visibility !== "community" ||
        Boolean(updated.authorHandle && eventScope.audienceHandles?.includes(updated.authorHandle))
      );
    if (
      actionChanged &&
      activity?.active === false &&
      (input.action === "signal" || input.action === "fork") &&
      updated.authorHandle &&
      updated.authorHandle !== handle
    ) {
      const resolvedNotifications = await resolveNotifications(client, {
        kinds: [input.action === "signal" ? "post_signal" : "post_reshare"],
        metadataMatches: [{ postId, actorHandle: handle }],
        profileHandles: [updated.authorHandle],
        reason: input.action === "signal" ? "post_like_removed" : "post_reshare_removed"
      });
      stagedEvents.push(...resolvedNotifications.events);
    }
    if (canNotifyAuthor) {
      const actionLabel = input.action === "signal" ? "liked" : "reshared";
      const subjectLabel = updated.postType ?? "post";
      const analyticsView = input.action === "signal" ? "likes" : "reshares";
      const createdNotifications = await createNotifications(client, [{
        profileHandle: updated.authorHandle!,
        kind: input.action === "signal" ? "post_signal" : "post_reshare",
        title: `${await notificationActorName(client, handle)} ${actionLabel} your ${subjectLabel}`,
        body: updated.title,
        href: `/posts/${encodeURIComponent(postId)}?analytics=${analyticsView}`,
        dedupeKey: `post-${input.action}:${postId}:${handle}:${activity!.revision}`,
        metadata: { postId, action: input.action, actorHandle: handle, subjectLabel, analyticsView }
      }]);
      stagedEvents.push(...createdNotifications.events);
    }
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `post.${input.action}`,
          subjectType: "post",
          subjectId: postId,
          visibility: eventScope.visibility,
          audienceHandles: eventScope.audienceHandles,
          payload: {
            action: input.action,
            itemId: postId,
            metrics: updated.metrics,
            revision: updated.revision
          }
        })
      );
    }
    stagedEvents.push(
      await stageEvent(client, {
        kind: `post.${input.action}`,
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: "private",
        payload: { action: input.action, active: activity?.active, activity, item: updated }
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

  return { item: updated, activity };
};

export const updatePost = async (
  postId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updatePostInputSchema.parse(rawInput);
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
    if (isDeletedPost(existing)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }
    assertCanonicalOpportunityUpdate(input.opportunity, existing);
    const patronage = updatePatronageProjection(input.patronage, existing.patronage);
    const opportunity = updateOpportunityProjection(input.opportunity, existing.opportunity);
    return {
      ...existing,
      title: input.title,
      body: input.body,
      document: input.document ?? existing.document,
      excerpt: input.body,
      claims: [input.body],
      status: opportunityPostStatus(opportunity, patronagePostStatus(patronage, existing.status)),
      patronage,
      opportunity,
      editedAt,
      revision: (existing.revision ?? 1) + 1
    };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updated: InquiryItemContract;
  let removedAttachmentIds: string[] = [];
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(lockedPostSelect, [postId]);
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (row.communityId && row.postType !== "paper") await assertCommunityReadAccess(row.communityId, handle);
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (row.deletedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }
    assertCanonicalOpportunityUpdate(input.opportunity, row);
    if (row.kind !== "paper" && input.document && !documentFitsReducedEditor(input.document)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Thoughts use the reduced editor formatting set." });
    }
    const currentEditedAt = row.editedAt ? new Date(row.editedAt).toISOString() : null;
    if (input.expectedEditedAt !== undefined && input.expectedEditedAt !== currentEditedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This post changed after it was opened. Refresh before saving content references."
      });
    }
    if (input.attachmentIds?.length && (row.room === "office" || row.kind === "draft")) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Private post attachments require protected delivery before they can be published."
      });
    }

    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: postId,
      ownerType: "post",
      uploaderHandle: handle
    });
    removedAttachmentIds = attachmentChange.removedAttachmentIds;
    const quote = input.quoteSource === undefined
      ? row.quote
      : input.quoteSource === null
        ? undefined
        : await resolveContentQuote(client, input.quoteSource, {
            ownerId: postId, ownerType: "post", actorHandle: handle,
            targetCommunityId: row.communityId, targetPostType: row.postType
          });
    const patronage = updatePatronageProjection(input.patronage, row.patronage);
    const opportunity = updateOpportunityProjection(input.opportunity, row.opportunity);
    const status = opportunityPostStatus(opportunity, patronagePostStatus(patronage, row.status));

    const revisionResult = await client.query<{ revision: number }>(
      `UPDATE posts
       SET title = $2,
           body = $3,
           content_document = $8,
           excerpt = $3,
           claims = $4,
           search_text = $5,
           edited_at = $6,
           quote = $7,
           patronage = $9,
           status = $10,
           opportunity = $11,
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING revision`,
      [
        postId,
        input.title,
        input.body,
        JSON.stringify([input.body]),
        searchablePostText({ title: input.title, body: input.body, excerpt: input.body, authorName: row.authorName }),
        editedAt,
        quote ? JSON.stringify(quote) : null,
        input.document ? JSON.stringify(input.document) : row.document ? JSON.stringify(row.document) : null,
        patronage ? JSON.stringify(patronage) : null,
        status,
        opportunity ? JSON.stringify(opportunity) : null
      ]
    );
    await updatePatronageProposal(client, postId, input.patronage);

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
    const commentAttachments = await getActiveAttachmentsByOwner(
      client,
      "comment",
      commentsResult.rows.map((comment) => comment.id)
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    updated = rowToItem(
      {
        ...row,
        title: input.title,
        body: input.body,
        document: input.document ?? row.document ?? undefined,
        excerpt: input.body,
        claims: [input.body],
        quote,
        patronage,
        opportunity,
        status,
        editedAt,
        revision: revisionResult.rows[0].revision
      },
      commentsByPost.get(postId) ?? [],
      attachmentChange.attachments.map(rowToAttachment)
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.update",
      subjectType: "post",
      subjectId: postId,
      metadata: {
        attachmentCount: attachmentChange.attachments.length,
        removedAttachmentCount: removedAttachmentIds.length,
        quotedSourceType: quote?.sourceType,
        editedAt
      }
    });
    await completeMutation(client, handle, mutation, updated);
    const eventScope = await communityEventScope(client, updated.postType === "paper" ? null : updated.communityId);
    const quoteChanged = !sameQuoteSource(row.quote, quote);
    const analyticsSubjects = quoteChanged
      ? quoteAnalyticsSubjects(row.quote, quote)
      : [];
    stagedEvents.push(await stageEvent(client, {
      kind: "post.updated",
      actorHandle: handle,
      subjectType: "post",
      subjectId: postId,
      visibility: updated.room === "office" || updated.kind === "draft" ? "private" : eventScope.visibility,
      audienceHandles: updated.room === "office" || updated.kind === "draft" ? [handle] : eventScope.audienceHandles,
      payload:
        updated.room === "office" || updated.kind === "draft"
          ? { item: updated, analyticsSubjects }
          : { itemId: postId, analyticsSubjects }
    }));
    if (updated.room !== "office" && updated.kind !== "draft") {
      const mentionNotifications = await contentMentionNotificationInputs(client, {
        sourceType: "post",
        sourceId: postId,
        postId,
        communityId: updated.communityId,
        actorHandle: handle,
        actorName: row.authorName,
        body: updated.title,
        href: `/posts/${encodeURIComponent(postId)}`,
        current: { body: row.body, document: row.document ?? undefined },
        next: { body: updated.body, document: updated.document },
        audienceHandles: eventScope.visibility === "community"
          ? eventScope.audienceHandles
          : undefined
      });
      if (mentionNotifications.removedHandles.length) {
        const resolvedMentions = await resolveNotifications(client, {
          kinds: ["post_mention"],
          metadataMatches: [{ mentionSourceType: "post", mentionSourceId: postId }],
          profileHandles: mentionNotifications.removedHandles,
          reason: "mention_removed"
        });
        stagedEvents.push(...resolvedMentions.events);
      }
      if (quoteChanged && row.quote) {
        const resolvedQuote = await resolveNotifications(client, {
          kinds: [row.quote.sourceType === "post" ? "post_quote" : "comment_quote"],
          metadataMatches: [{
            quoteOwnerType: "post",
            quoteOwnerId: postId,
            sourceType: row.quote.sourceType,
            sourceId: row.quote.sourceId
          }],
          reason: "quote_removed_or_changed"
        });
        stagedEvents.push(...resolvedQuote.events);
      }
      const quoteRecipient = quote?.authorHandle ? cleanHandle(quote.authorHandle) : null;
      const quoteNotification = quoteChanged
        ? quoteNotificationInput({
            quote,
            quoteOwnerType: "post",
            quoteOwnerId: postId,
            quoteOwnerPostId: postId,
            actorHandle: handle,
            actorName: row.authorName,
            body: updated.title,
            communityId: updated.communityId,
            recipientCanRead: eventScope.visibility !== "community"
              || Boolean(quoteRecipient && eventScope.audienceHandles?.includes(quoteRecipient))
          })
        : null;
      const createdNotifications = await createNotifications(client, [
        ...mentionNotifications.inputs,
        ...(quoteNotification ? [quoteNotification] : [])
      ]);
      stagedEvents.push(...createdNotifications.events);
    }
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

  return updated;
};

export const deletePost = async (postId: string, actor: Actor, mutation?: MutationContext) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (existing.communityId && existing.postType !== "paper") await assertCommunityReadAccess(existing.communityId, handle);
    if (isDeletedPost(existing)) return existing;
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      await assertCommunityPostDeletion(existing, handle);
    }
    return { ...tombstonePost(existing), revision: (existing.revision ?? 1) + 1 };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let deleted: InquiryItemContract | null = null;
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
    const postResult = await client.query<SnapshotRow>(lockedPostSelect, [postId]);
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
    const [commentAttachments, postAttachments] = await Promise.all([
      getActiveAttachmentsByOwner(client, "comment", commentsResult.rows.map((comment) => comment.id)),
      getActiveAttachmentsByOwner(client, "post", [postId])
    ]);
    const commentsByPost = commentTreesFromRows(commentsResult.rows, commentAttachments);
    const existing = rowToItem(
      row,
      commentsByPost.get(postId) ?? [],
      postAttachments.get(postId) ?? []
    );
    const commentIds = commentsResult.rows.map((comment) => comment.id);
    const applicationRows = row.opportunity
      ? await client.query<{ id: string }>(`SELECT id::text FROM opportunity_applications WHERE post_id = $1 FOR UPDATE`, [postId])
      : { rows: [] };
    const applicationIds = applicationRows.rows.map((application) => application.id);

    if (isDeletedPost(existing)) {
      deleted = existing;
      await markQuotedPostUnavailable(client, postId);
      storageAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(
        client,
        "post",
        postId,
        "post_deleted"
      );
      storageAttachmentIds.push(
        ...(await queueAttachmentsForOwnerStorageDeletion(
          client,
          "comment",
          commentIds,
          "post_deleted"
        ))
      );
      storageAttachmentIds.push(...await queueAttachmentsForOwnerStorageDeletion(client, "opportunity_application", applicationIds, "opportunity_post_deleted"));
      if (applicationIds.length) await client.query(`DELETE FROM opportunity_applications WHERE post_id = $1`, [postId]);
      await completeMutation(client, handle, mutation, deleted);
      await client.query("COMMIT");
    } else {
      if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
        await assertCommunityPostDeletion(row, handle, client);
      }
      const deletedPost = {
        ...tombstonePost(existing),
        saved: false,
        savedBy: [],
        signaledBy: [],
        forkedBy: []
      };
      const revisionResult = await client.query<{ revision: number }>(
        `UPDATE posts
         SET title = $2,
             author_handle = NULL,
             author_name = $3,
             affiliation = $4,
             status = $5,
             gathering_reason = $6,
             excerpt = $7,
             body = $8,
             tags = $9,
             signals = $10,
             claims = $11,
             objections = $12,
             evidence = $13,
             tests = $14,
             forks = $15,
             saved = false,
             saved_by = '[]'::jsonb,
             signaled_by = '[]'::jsonb,
             forked_by = '[]'::jsonb,
             quote = NULL,
             patronage = NULL,
             opportunity = NULL,
             search_text = $16,
             edited_at = NULL,
             deleted_at = $17,
             revision = revision + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING revision`,
        [
          postId,
          deletedPost.title,
          deletedPost.author,
          deletedPost.affiliation,
          deletedPost.status,
          deletedPost.gatheringReason,
          deletedPost.excerpt,
          deletedPost.body,
          JSON.stringify(deletedPost.tags),
          JSON.stringify(deletedPost.signals),
          JSON.stringify(deletedPost.claims),
          JSON.stringify(deletedPost.objections),
          JSON.stringify(deletedPost.evidence),
          JSON.stringify(deletedPost.tests),
          JSON.stringify(deletedPost.forks),
          searchablePostText({
            title: deletedPost.title,
            body: deletedPost.body,
            excerpt: deletedPost.excerpt,
            authorName: deletedPost.author
          }),
          deletedPost.deletedAt
        ]
      );
      deleted = { ...deletedPost, revision: revisionResult.rows[0].revision };
      await markQuotedPostUnavailable(client, postId);
      await client.query(
        `UPDATE post_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE post_id = $1 AND action IN ('save', 'signal', 'fork') AND active = true`,
        [postId]
      );
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE post_id = $1 AND active = true`,
        [postId]
      );
      storageAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(
        client,
        "post",
        postId,
        "post_deleted"
      );
      storageAttachmentIds.push(
        ...(await queueAttachmentsForOwnerStorageDeletion(
          client,
          "comment",
          commentIds,
          "post_deleted"
        ))
      );
      storageAttachmentIds.push(...await queueAttachmentsForOwnerStorageDeletion(client, "opportunity_application", applicationIds, "opportunity_post_deleted"));
      if (applicationIds.length) await client.query(`DELETE FROM opportunity_applications WHERE post_id = $1`, [postId]);
      const resolvedNotifications = await resolveNotifications(client, {
        kinds: [
          "comment_mention",
          "comment_quote",
          "post_signal",
          "post_mention",
          "post_quote",
          "post_reshare",
          "post_comment",
          "comment_reply",
          "comment_signal",
          "comment_reshare",
          "opportunity_application_received"
        ],
        metadataMatches: [
          { postId },
          { sourceType: "post", sourceId: postId },
          { sourcePostId: postId },
          { quoteOwnerType: "post", quoteOwnerId: postId },
          { quoteOwnerType: "comment", quoteOwnerPostId: postId }
        ],
        reason: "source_post_deleted"
      });
      stagedEvents.push(...resolvedNotifications.events);
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "post.delete",
        subjectType: "post",
        subjectId: postId,
        metadata: {
          deletedAt: deletedPost.deletedAt,
          storageAttachmentCount: storageAttachmentIds.length
        }
      });
      const eventScope = await communityEventScope(client, deleted.postType === "paper" ? null : deleted.communityId);
      stagedEvents.push(await stageEvent(client, {
        kind: "post.deleted",
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: deleted.room === "office" || deleted.kind === "draft" ? "private" : eventScope.visibility,
        audienceHandles: deleted.room === "office" || deleted.kind === "draft" ? [handle] : eventScope.audienceHandles,
        payload:
          deleted.room === "office" || deleted.kind === "draft"
            ? {
                itemId: postId,
                item: deleted,
                analyticsSubjects: quoteAnalyticsSubjects(existing.quote)
              }
            : {
                itemId: postId,
                analyticsSubjects: quoteAnalyticsSubjects(existing.quote)
              }
      }));
      await stageCommunityProfileInvalidation(client, handle, eventScope.visibility === "community", stagedEvents);
      await completeMutation(client, handle, mutation, deleted);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  if (didDelete) for (const event of stagedEvents) await publishStoredEvent(event);
  if (storageAttachmentIds.length) await triggerStorageDeletion(storageAttachmentIds);

  return deleted;
};
