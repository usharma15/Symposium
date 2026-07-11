import { TRPCError } from "@trpc/server";
import {
  createPostInputSchema,
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
import { transitionPostAction } from "./actions";
import { recordContentView, recordMemoryContentView } from "./contentViews";
import {
  actorHandle,
  commentTreesFromRows,
  defaultProfile,
  ensureLiveData,
  getInitialState,
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

export const createPost = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createPostInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle];
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  const isPaper = input.kind === "paper";
  const requestedAttachments = (input.attachments ?? []).map((attachment) => ({
    ...attachment,
    status: "uploaded" as const
  }));
  const requestedAttachmentIds = requestedAttachments.map((attachment) => attachment.id);
  if (new Set(requestedAttachmentIds).size !== requestedAttachmentIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Each post attachment can only be attached once." });
  }
  const item: InquiryItemContract = {
    id: newId("post"),
    kind: input.kind,
    room: input.room,
    title: input.title,
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    createdAt: new Date().toISOString(),
    status: isPaper ? "Draft" : "New",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: "A new working post added to the live beta.",
    excerpt: input.body,
    body: input.body,
    tags: [input.room, input.kind, ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: isPaper ? "Draft" : "New" },
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
    attachments: requestedAttachments,
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (!hasDatabase()) return item;
  await ensureLiveData();

  const client = await getPool().connect();
  let attachedRows: AttachmentRow[] = [];
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    await client.query(
      `INSERT INTO posts (
        id, kind, room, title, author_handle, author_name, affiliation, date_label, created_at, status,
        metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
        tests, forks, saved, saved_by, signaled_by, forked_by, search_text
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26
      )`,
      [
        item.id,
        item.kind,
        item.room,
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
        searchablePostText({ ...item, authorName: item.author })
      ]
    );

    if (item.authorHandle && item.savedBy?.includes(item.authorHandle)) {
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
         VALUES ($1, $2, 'save', true, 1, 1, $3, $3)
         ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
        [item.id, item.authorHandle, item.createdAt]
      );
    }

    if (requestedAttachmentIds.length) {
      const result = await client.query<AttachmentRow>(
        `UPDATE attachments
         SET owner_id = $1,
             updated_at = now()
         WHERE id = ANY($2::uuid[])
           AND owner_type = 'post'
           AND uploader_handle = $3
           AND status IN ('uploaded', 'previewed')
           AND (owner_id IS NULL OR owner_id = $1)
         RETURNING
           id::text,
           owner_id AS "ownerId",
           file_name AS "fileName",
           content_type AS "contentType",
           byte_size AS "byteSize",
           status,
           metadata,
           object_key AS "objectKey",
           created_at AS "createdAt"`,
        [item.id, requestedAttachmentIds, item.authorHandle]
      );

      if ((result.rowCount ?? 0) !== requestedAttachmentIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One or more attachments could not be attached to this post." });
      }

      const rowById = new Map(result.rows.map((row) => [row.id, row]));
      attachedRows = requestedAttachmentIds.map((id) => rowById.get(id)).filter((row): row is AttachmentRow => Boolean(row));
    }

    item.attachments = attachedRows.map(rowToAttachment);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.create",
      subjectType: "post",
      subjectId: item.id,
      metadata: mutationAuditMetadata(mutation, {
        attachmentCount: item.attachments.length,
        kind: item.kind,
        room: item.room
      })
    });
    await completeMutation(client, handle, mutation, item);
    stagedEvent = await stageEvent(client, {
      kind: "post.created",
      actorHandle: item.authorHandle,
      subjectType: "post",
      subjectId: item.id,
      visibility: item.room === "office" || item.kind === "draft" ? "private" : "public",
      payload: { item, room: item.room, kind: item.kind, title: item.title }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

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
      item: mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active)
    };
  }

  await ensureLiveData();

  const client = await getPool().connect();
  let updated: InquiryItemContract;
  const stagedEvents: StoredLiveEvent[] = [];
  let activity: CanonicalActionActivityContract | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ActionMutationResult>(client, handle, mutation);
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
    const existing = rowToItem(row, commentsByPost.get(postId) ?? []);
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

    await client.query(
      `UPDATE posts
       SET metrics = $2,
           saved = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           signals = $7,
           updated_at = now()
       WHERE id = $1`,
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
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `post.${input.action}`,
          subjectType: "post",
          subjectId: postId,
          payload: { action: input.action, itemId: postId }
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

export const updatePost = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input = updatePostInputSchema.parse(rawInput);
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
    if (isDeletedPost(existing)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }
    return { ...existing, title: input.title, body: input.body, excerpt: input.body, claims: [input.body], editedAt };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updated: InquiryItemContract;
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
    if (row.deletedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }

    await client.query(
      `UPDATE posts
       SET title = $2,
           body = $3,
           excerpt = $3,
           claims = $4,
           search_text = $5,
           edited_at = $6,
           updated_at = now()
       WHERE id = $1`,
      [
        postId,
        input.title,
        input.body,
        JSON.stringify([input.body]),
        searchablePostText({ title: input.title, body: input.body, excerpt: input.body, authorName: row.authorName }),
        editedAt
      ]
    );

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
    updated = rowToItem(
      { ...row, title: input.title, body: input.body, excerpt: input.body, claims: [input.body], editedAt },
      commentsByPost.get(postId) ?? []
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.update",
      subjectType: "post",
      subjectId: postId,
      metadata: { editedAt }
    });
    stagedEvent = await stageEvent(client, {
      kind: "post.updated",
      actorHandle: handle,
      subjectType: "post",
      subjectId: postId,
      visibility: updated.room === "office" || updated.kind === "draft" ? "private" : "public",
      payload:
        updated.room === "office" || updated.kind === "draft"
          ? { item: updated }
          : { itemId: postId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return updated;
};

export const deletePost = async (postId: string, actor: Actor) => {
  const handle = actorHandle(actor);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (isDeletedPost(existing)) return existing;
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this post." });
    }
    return tombstonePost(existing);
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let deleted: InquiryItemContract | null = null;
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
    const existing = rowToItem(row, commentsByPost.get(postId) ?? []);

    if (isDeletedPost(existing)) {
      deleted = existing;
      await client.query("COMMIT");
    } else {
      if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this post." });
      }
      const deletedPost = {
        ...tombstonePost(existing),
        saved: false,
        savedBy: [],
        signaledBy: [],
        forkedBy: []
      };
      deleted = deletedPost;
      await client.query(
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
             search_text = $16,
             edited_at = NULL,
             deleted_at = $17,
             updated_at = now()
         WHERE id = $1`,
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
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "post.delete",
        subjectType: "post",
        subjectId: postId,
        metadata: { deletedAt: deletedPost.deletedAt }
      });
      stagedEvent = await stageEvent(client, {
        kind: "post.deleted",
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: deleted.room === "office" || deleted.kind === "draft" ? "private" : "public",
        payload:
          deleted.room === "office" || deleted.kind === "draft"
            ? { itemId: postId, item: deleted }
            : { itemId: postId }
      });
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  if (didDelete && stagedEvent) await publishStoredEvent(stagedEvent);

  return deleted;
};
