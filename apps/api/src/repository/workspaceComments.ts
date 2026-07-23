import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  createWorkspaceCommentInputSchema,
  deleteWorkspaceCommentInputSchema,
  updateWorkspaceCommentInputSchema,
  workspaceCommentActionInputSchema,
  type InquiryCommentContract,
  type WorkspaceAccessRoleContract
} from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { replaceOwnerAttachments } from "../services/attachmentOwnership";
import { queueAttachmentsForOwnerStorageDeletion, triggerStorageDeletion } from "../services/storageDeletion";
import { runAtomic } from "../services/transactions";
import {
  createNotifications,
  notificationActorName,
  type CreateNotificationInput
} from "../services/notificationDelivery";
import { resolveActionTransition } from "./actions";
import { recordContentView } from "./contentViews";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type WorkspaceCommentAccessRow = {
  id: string;
  ownerHandle: string;
  title: string;
  role: WorkspaceAccessRoleContract;
};

type WorkspaceCommentRow = {
  id: string;
  parentId: string | null;
  authorHandle: string | null;
  authorName: string;
  stance: string;
  body: string;
  document: InquiryCommentContract["document"] | null;
  revision: number;
  createdAt: Date | string;
  editedAt: Date | string | null;
  deletedAt: Date | string | null;
  signalCount: string;
  saveCount: string;
  readCount: string;
  signaled: boolean;
  saved: boolean;
  attachments: InquiryCommentContract["attachments"];
};

const roleRank: Record<WorkspaceAccessRoleContract, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  publisher: 4,
  owner: 5
};

const roleSql = `
  CASE GREATEST(
    CASE WHEN note.owner_handle = $2 THEN 5 ELSE 0 END,
    CASE direct.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END,
    CASE inherited.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
  )
    WHEN 5 THEN 'owner'
    WHEN 4 THEN 'publisher'
    WHEN 3 THEN 'editor'
    WHEN 2 THEN 'commenter'
    ELSE 'viewer'
  END`;

const findDocumentAccess = async (client: PoolClient, noteId: string, handle: string, lock = false) => {
  const result = await client.query<WorkspaceCommentAccessRow>(
    `SELECT note.id::text, note.owner_handle AS "ownerHandle", note.title, ${roleSql} AS role
     FROM notes note
     LEFT JOIN workspace_note_grants direct
       ON direct.note_id = note.id AND direct.grantee_handle = $2
     LEFT JOIN workspace_notebook_grants inherited
       ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
     WHERE note.id = $1 AND note.deleted_at IS NULL
       AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
     ${lock ? "FOR UPDATE OF note" : ""}`,
    [noteId, handle]
  );
  return result.rows[0];
};

const assertCanComment = (access: WorkspaceCommentAccessRow | undefined) => {
  if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
  if (roleRank[access.role] < roleRank.commenter) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This draft cannot be commented on with your current access." });
  }
};

const documentAudienceHandles = async (client: PoolClient, noteId: string) => {
  const result = await client.query<{ handle: string }>(
    `SELECT owner_handle AS handle FROM notes WHERE id = $1
     UNION
     SELECT grantee_handle AS handle FROM workspace_note_grants WHERE note_id = $1
     UNION
     SELECT notebook_grant.grantee_handle AS handle
     FROM notes note
     JOIN workspace_notebook_grants notebook_grant ON notebook_grant.notebook_id = note.notebook_id
     WHERE note.id = $1`,
    [noteId]
  );
  return result.rows.map((row) => row.handle);
};

const lockDocument = (client: PoolClient, noteId: string) =>
  client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:workspace-note:' || $1, 0))", [noteId]);

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined;

const selectWorkspaceComments = async (client: PoolClient, noteId: string, handle: string) => {
  const result = await client.query<WorkspaceCommentRow>(
    `SELECT
       comment.id::text,
       comment.parent_id::text AS "parentId",
       comment.author_handle AS "authorHandle",
       comment.author_name AS "authorName",
       comment.stance,
       comment.body,
       comment.content_document AS document,
       comment.revision,
       comment.created_at AS "createdAt",
       comment.edited_at AS "editedAt",
       comment.deleted_at AS "deletedAt",
       COALESCE((
         SELECT sum(action.count)::text FROM workspace_note_comment_actions action
         WHERE action.comment_id = comment.id AND action.action = 'signal' AND action.active
       ), '0') AS "signalCount",
       COALESCE((
         SELECT sum(action.count)::text FROM workspace_note_comment_actions action
         WHERE action.comment_id = comment.id AND action.action = 'save' AND action.active
       ), '0') AS "saveCount",
       COALESCE((
         SELECT count(*)::text FROM content_views view_row
         WHERE view_row.target_type = 'note_comment' AND view_row.target_id = comment.id::text
       ), '0') AS "readCount",
       EXISTS (
         SELECT 1 FROM workspace_note_comment_actions action
         WHERE action.comment_id = comment.id AND action.actor_handle = $2
           AND action.action = 'signal' AND action.active
       ) AS signaled,
       EXISTS (
         SELECT 1 FROM workspace_note_comment_actions action
         WHERE action.comment_id = comment.id AND action.actor_handle = $2
           AND action.action = 'save' AND action.active
       ) AS saved,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', attachment.id::text,
           'fileName', attachment.file_name,
           'contentType', attachment.content_type,
           'byteSize', attachment.byte_size,
           'url', '/api/workspace/attachments/' || attachment.id::text || '?actorHandle=' || $2,
           'status', attachment.status,
           'kind', CASE
             WHEN attachment.content_type LIKE 'image/%' THEN 'image'
             WHEN attachment.content_type LIKE 'video/%' THEN 'video'
             WHEN attachment.content_type = 'application/pdf' THEN 'pdf'
             WHEN attachment.content_type LIKE 'text/%' THEN 'text'
             ELSE 'document'
           END,
           'metadata', attachment.metadata,
           'createdAt', attachment.created_at
         ) ORDER BY attachment.created_at ASC)
         FROM attachments attachment
         WHERE attachment.owner_type = 'note_comment'
           AND attachment.owner_id = comment.id::text
           AND attachment.status IN ('uploaded', 'previewed')
       ), '[]'::jsonb) AS attachments
     FROM workspace_note_comments comment
     WHERE comment.note_id = $1
     ORDER BY comment.created_at ASC, comment.id ASC`,
    [noteId, handle]
  );

  const byId = new Map<string, InquiryCommentContract>();
  for (const row of result.rows) {
    byId.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      author: row.authorName,
      authorHandle: row.authorHandle ?? undefined,
      stance: row.stance,
      body: row.body,
      document: row.document ?? undefined,
      revision: row.revision,
      createdAt: iso(row.createdAt),
      editedAt: iso(row.editedAt),
      deletedAt: iso(row.deletedAt),
      metrics: { signal: row.signalCount, forks: "0", saves: row.saveCount, reads: row.readCount },
      signaledBy: row.signaled ? [handle] : [],
      savedBy: row.saved ? [handle] : [],
      forkedBy: [],
      attachments: row.attachments ?? [],
      replies: []
    });
  }

  const roots: InquiryCommentContract[] = [];
  for (const row of result.rows) {
    const comment = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) parent.replies!.push(comment);
    else roots.push(comment);
  }
  return roots;
};

const responseFor = async (client: PoolClient, noteId: string, handle: string, commentId?: string) => {
  const comments = await selectWorkspaceComments(client, noteId, handle);
  const find = (nodes: InquiryCommentContract[]): InquiryCommentContract | undefined => {
    for (const node of nodes) {
      if (node.id === commentId) return node;
      const nested = find(node.replies ?? []);
      if (nested) return nested;
    }
  };
  return { comments, comment: commentId ? find(comments) : undefined };
};

export const getWorkspaceComments = async (noteId: string, actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { comments: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const access = await findDocumentAccess(client, noteId, handle);
    if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    return { value: await responseFor(client, noteId, handle) };
  });
};

export const createWorkspaceComment = async (
  noteId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = createWorkspaceCommentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent draft comments require the live database." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    await lockDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    assertCanComment(access);
    let parentAuthorHandle: string | null = null;
    if (input.parentId) {
      const parent = await client.query<{ authorHandle: string | null }>(
        `SELECT author_handle AS "authorHandle" FROM workspace_note_comments
         WHERE id = $1 AND note_id = $2 AND deleted_at IS NULL FOR SHARE`,
        [input.parentId, noteId]
      );
      if (!parent.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Reply target is no longer available." });
      parentAuthorHandle = parent.rows[0]?.authorHandle ?? null;
    }
    const profile = await client.query<{ name: string }>("SELECT name FROM profiles WHERE handle = $1", [handle]);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO workspace_note_comments (
         note_id, parent_id, author_handle, author_name, stance, body, content_document
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text`,
      [noteId, input.parentId ?? null, handle, profile.rows[0]?.name ?? handle, input.stance, input.body, input.document ? JSON.stringify(input.document) : null]
    );
    const commentId = inserted.rows[0]!.id;
    const attachmentResult = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: commentId,
      ownerType: "note_comment",
      uploaderHandle: handle
    });
    const value = { ...(await responseFor(client, noteId, handle, commentId)), removedAttachmentIds: attachmentResult.removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: input.parentId ? "workspace.comment.reply" : "workspace.comment.create",
      subjectType: "note_comment",
      subjectId: commentId,
      metadata: mutationAuditMetadata(mutation, { noteId, parentId: input.parentId ?? null })
    });
    await completeMutation(client, handle, mutation, value);
    const notificationInputs: CreateNotificationInput[] = [];
    const href = `/workspace?view=notes&note=${encodeURIComponent(noteId)}&comment=${encodeURIComponent(commentId)}`;
    const actorName = profile.rows[0]?.name ?? handle;
    if (parentAuthorHandle && parentAuthorHandle !== handle) {
      notificationInputs.push({
        profileHandle: parentAuthorHandle,
        kind: "workspace_comment_reply",
        title: `${actorName} replied to your draft comment`,
        body: access!.title,
        href,
        dedupeKey: `workspace-comment-reply:${commentId}:${parentAuthorHandle}`,
        metadata: { noteId, commentId, parentCommentId: input.parentId, actorHandle: handle }
      });
    }
    if (access!.ownerHandle !== handle && access!.ownerHandle !== parentAuthorHandle) {
      notificationInputs.push({
        profileHandle: access!.ownerHandle,
        kind: "workspace_comment",
        title: `${actorName} commented on your draft`,
        body: access!.title,
        href,
        dedupeKey: `workspace-comment:${commentId}:${access!.ownerHandle}`,
        metadata: { noteId, commentId, actorHandle: handle }
      });
    }
    const createdNotifications = await createNotifications(client, notificationInputs);
    const event = await stageEvent(client, {
      kind: input.parentId ? "note.comment.replied" : "note.comment.created",
      actorHandle: handle,
      audienceHandles: await documentAudienceHandles(client, noteId),
      subjectType: "note_comment",
      subjectId: commentId,
      visibility: "private",
      payload: { noteId, commentId, parentId: input.parentId ?? null }
    });
    return { value, events: [...createdNotifications.events, event] };
  });
};

export const updateWorkspaceComment = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updateWorkspaceCommentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent draft comments require the live database." });
  await ensureLiveData();
  let removedAttachmentIds: string[] = [];
  const result = await runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    await lockDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    const comment = await client.query<{ authorHandle: string | null; revision: number }>(
      `SELECT author_handle AS "authorHandle", revision
       FROM workspace_note_comments
       WHERE id = $1 AND note_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [commentId, noteId]
    );
    const current = comment.rows[0];
    if (!current || current.authorHandle !== handle) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (current.revision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This comment changed after it was opened. Refresh before overwriting it." });
    }
    const attachmentResult = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: commentId,
      ownerType: "note_comment",
      uploaderHandle: handle
    });
    removedAttachmentIds = attachmentResult.removedAttachmentIds;
    await client.query(
      `UPDATE workspace_note_comments
       SET body = $3, content_document = $4, revision = revision + 1, edited_at = now(), updated_at = now()
       WHERE id = $1 AND note_id = $2`,
      [commentId, noteId, input.body, input.document ? JSON.stringify(input.document) : null]
    );
    const value = { ...(await responseFor(client, noteId, handle, commentId)), removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.comment.update",
      subjectType: "note_comment",
      subjectId: commentId,
      metadata: mutationAuditMetadata(mutation, { noteId, revision: input.expectedRevision + 1 })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.comment.updated",
      actorHandle: handle,
      audienceHandles: await documentAudienceHandles(client, noteId),
      subjectType: "note_comment",
      subjectId: commentId,
      visibility: "private",
      payload: { noteId, commentId, revision: input.expectedRevision + 1 }
    });
    return { value, events: [event] };
  });
  if (removedAttachmentIds.length) await triggerStorageDeletion(removedAttachmentIds);
  return result;
};

export const deleteWorkspaceComment = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = deleteWorkspaceCommentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent draft comments require the live database." });
  await ensureLiveData();
  let removedAttachmentIds: string[] = [];
  const result = await runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    await lockDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    const deleted = await client.query(
      `UPDATE workspace_note_comments
       SET deleted_at = now(), revision = revision + 1, updated_at = now()
       WHERE id = $1 AND note_id = $2 AND author_handle = $3
         AND revision = $4 AND deleted_at IS NULL
       RETURNING id`,
      [commentId, noteId, handle, input.expectedRevision]
    );
    if (!deleted.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This comment changed or is no longer available." });
    removedAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(client, "note_comment", commentId, "workspace_comment_deleted");
    const value = { ...(await responseFor(client, noteId, handle, commentId)), removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.comment.delete",
      subjectType: "note_comment",
      subjectId: commentId,
      metadata: mutationAuditMetadata(mutation, { noteId })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.comment.deleted",
      actorHandle: handle,
      audienceHandles: await documentAudienceHandles(client, noteId),
      subjectType: "note_comment",
      subjectId: commentId,
      visibility: "private",
      payload: { noteId, commentId }
    });
    return { value, events: [event] };
  });
  if (removedAttachmentIds.length) await triggerStorageDeletion(removedAttachmentIds);
  return result;
};

export const applyWorkspaceCommentAction = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = workspaceCommentActionInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Persistent draft comments require the live database." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    await lockDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    const comment = await client.query<{ id: string; authorHandle: string | null }>(
      `SELECT id::text, author_handle AS "authorHandle" FROM workspace_note_comments
       WHERE id = $1 AND note_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [commentId, noteId]
    );
    if (!comment.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

    let changed = false;
    let active = input.active;
    let actionRevision: number | null = null;
    if (input.action === "read") {
      changed = await recordContentView(client, "note_comment", commentId, handle, input.trigger, input.surface ?? "workspace");
    } else {
      const existing = await client.query<{ active: boolean; revision: number }>(
        `SELECT active, revision FROM workspace_note_comment_actions
         WHERE comment_id = $1 AND actor_handle = $2 AND action = $3 FOR UPDATE`,
        [commentId, handle, input.action]
      );
      const transition = resolveActionTransition(existing.rows[0]?.active, input.active);
      changed = transition.changed;
      active = transition.nextActive;
      if (!existing.rows[0]) {
        const inserted = await client.query<{ revision: number }>(
          `INSERT INTO workspace_note_comment_actions (
             comment_id, note_id, actor_handle, action, active, count
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING revision`,
          [commentId, noteId, handle, input.action, active, active ? 1 : 0]
        );
        actionRevision = inserted.rows[0]!.revision;
      } else if (changed) {
        const updated = await client.query<{ revision: number }>(
          `UPDATE workspace_note_comment_actions
           SET active = $4, count = CASE WHEN $4 THEN 1 ELSE 0 END,
               revision = revision + 1, updated_at = now()
           WHERE comment_id = $1 AND actor_handle = $2 AND action = $3
           RETURNING revision`,
          [commentId, handle, input.action, active]
        );
        actionRevision = updated.rows[0]!.revision;
      } else {
        actionRevision = existing.rows[0].revision;
      }
    }
    if (changed) {
      await client.query(
        `UPDATE workspace_note_comments SET revision = revision + 1, updated_at = now()
         WHERE id = $1 AND note_id = $2`,
        [commentId, noteId]
      );
    }
    const value = { ...(await responseFor(client, noteId, handle, commentId)), active };
    if (changed && input.action !== "read") {
      await stageAuditLog(client, {
        actorHandle: handle,
        action: `workspace.comment.${input.action}`,
        subjectType: "note_comment",
        subjectId: commentId,
        metadata: mutationAuditMetadata(mutation, { noteId, active })
      });
    }
    await completeMutation(client, handle, mutation, value);
    if (!changed) return { value };
    const createdNotifications = input.action === "signal" && active && comment.rows[0]?.authorHandle && comment.rows[0].authorHandle !== handle
      ? await createNotifications(client, [{
          profileHandle: comment.rows[0].authorHandle,
          kind: "workspace_comment_signal",
          title: `${await notificationActorName(client, handle)} liked your draft comment`,
          body: access.title,
          href: `/workspace?view=notes&note=${encodeURIComponent(noteId)}&comment=${encodeURIComponent(commentId)}`,
          dedupeKey: `workspace-comment-signal:${commentId}:${handle}:${actionRevision}`,
          metadata: { noteId, commentId, actorHandle: handle }
        }])
      : { notifications: [], events: [] };
    const event = await stageEvent(client, {
      kind: `note.comment.${input.action}`,
      actorHandle: handle,
      audienceHandles: await documentAudienceHandles(client, noteId),
      subjectType: "note_comment",
      subjectId: commentId,
      visibility: "private",
      payload: { noteId, commentId, action: input.action, active }
    });
    return { value, events: [...createdNotifications.events, event] };
  });
};
