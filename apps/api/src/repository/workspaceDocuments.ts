import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  createWorkspaceDocumentInputSchema,
  createWorkspaceNotebookInputSchema,
  deleteWorkspaceDocumentInputSchema,
  deleteWorkspaceNotebookInputSchema,
  updateWorkspaceDocumentInputSchema,
  updateWorkspaceNotebookInputSchema,
  workspaceSearchInputSchema,
  type WorkspaceAccessRoleContract,
  type WorkspaceDocumentKindContract
} from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { replaceOwnerAttachments } from "../services/attachmentOwnership";
import { queueAttachmentsForOwnerStorageDeletion, triggerStorageDeletion } from "../services/storageDeletion";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";
import { assertExpectedRevision } from "./workspace";

type WorkspaceRow = { id: string; name: string; ownerHandle: string };
type AccessRow = {
  id: string;
  ownerHandle: string;
  role: WorkspaceAccessRoleContract;
  revision: number;
  kind: WorkspaceDocumentKindContract;
  workspaceId: string;
};

const roleRank: Record<WorkspaceAccessRoleContract, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  publisher: 4,
  owner: 5
};

const defaultDocument = {
  version: 1 as const,
  nodes: [{ id: "workspace-empty", type: "paragraph" as const, content: [], align: "left" as const, indent: 0 }],
  settings: { width: "standard" as const, margin: "normal" as const }
};

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

const ensureWorkspace = async (client: PoolClient, handle: string) => {
  const result = await client.query<WorkspaceRow>(
    `INSERT INTO workspaces (owner_handle, name, visibility)
     VALUES ($1, 'Notebook', 'private')
     ON CONFLICT (owner_handle, name) DO UPDATE SET visibility = 'private'
     RETURNING id::text, name, owner_handle AS "ownerHandle"`,
    [handle]
  );
  return result.rows[0]!;
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
  const result = await client.query<AccessRow>(
    `SELECT
       note.id::text,
       note.workspace_id::text AS "workspaceId",
       note.owner_handle AS "ownerHandle",
       note.revision,
       note.kind,
       ${roleSql} AS role
     FROM notes note
     LEFT JOIN workspace_note_grants direct
       ON direct.note_id = note.id AND direct.grantee_handle = $2
     LEFT JOIN workspace_notebook_grants inherited
       ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
     WHERE note.id = $1
       AND note.deleted_at IS NULL
       AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
     ${lock ? "FOR UPDATE OF note" : ""}`,
    [noteId, handle]
  );
  return result.rows[0];
};

const assertCanEdit = (access: AccessRow) => {
  const owner = access.role === "owner";
  if (!owner && (!["note", "paper"].includes(access.kind) || roleRank[access.role] < roleRank.editor)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This draft is not editable with your current access." });
  }
};

const ensureNotebookForOwner = async (
  client: PoolClient,
  workspaceId: string,
  ownerHandle: string,
  notebookId: string | null
) => {
  if (!notebookId) return;
  const notebook = await client.query(
    `SELECT 1 FROM workspace_notebooks
     WHERE id = $1 AND workspace_id = $2 AND owner_handle = $3 AND deleted_at IS NULL
     FOR SHARE`,
    [notebookId, workspaceId, ownerHandle]
  );
  if (!notebook.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Notebook not found." });
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

const notebookAudienceHandles = async (client: PoolClient, notebookId: string) => {
  const result = await client.query<{ handle: string }>(
    `SELECT owner_handle AS handle FROM workspace_notebooks WHERE id = $1
     UNION
     SELECT grantee_handle AS handle FROM workspace_notebook_grants WHERE notebook_id = $1
     UNION
     SELECT note_grant.grantee_handle AS handle
     FROM notes note
     JOIN workspace_note_grants note_grant ON note_grant.note_id = note.id
     WHERE note.notebook_id = $1`,
    [notebookId]
  );
  return result.rows.map((row) => row.handle);
};

const lockWorkspaceDocument = (client: PoolClient, noteId: string) =>
  client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('symposium:workspace-note:' || $1, 0))",
    [noteId]
  );

const attachmentSelect = `
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
    WHERE attachment.owner_type = 'note'
      AND attachment.owner_id = note.id::text
      AND attachment.status IN ('uploaded', 'previewed')
  ), '[]'::jsonb) AS attachments`;

const documentSelect = `
  note.id::text,
  note.workspace_id::text AS "workspaceId",
  note.notebook_id::text AS "notebookId",
  notebook.name AS "notebookName",
  note.owner_handle AS "ownerHandle",
  owner.name AS "ownerName",
  note.kind,
  note.publication_target AS "publicationTarget",
  note.target_id AS "targetId",
  note.title,
  note.body,
  COALESCE(note.content_document, $1::jsonb) AS document,
  note.lifecycle,
  note.revision,
  note.published_post_id AS "publishedPostId",
  note.created_at AS "createdAt",
  note.updated_at AS "updatedAt",
  note.published_at AS "publishedAt",
  ${roleSql} AS role,
  (inherited.id IS NOT NULL) AS "inheritedFromNotebook",
  ${attachmentSelect}`;

const mapDocument = (row: Record<string, unknown>) => {
  const role = String(row.role ?? "viewer") as WorkspaceAccessRoleContract;
  const kind = String(row.kind ?? "note") as WorkspaceDocumentKindContract;
  const owner = role === "owner";
  const collaborative = kind === "note" || kind === "paper";
  return {
    ...row,
    notebookId: row.notebookId ?? null,
    notebookName: row.notebookName ?? null,
    targetId: row.targetId ?? null,
    publishedPostId: row.publishedPostId ?? null,
    createdAt: iso(row.createdAt as Date | string),
    updatedAt: iso(row.updatedAt as Date | string),
    publishedAt: iso(row.publishedAt as Date | string | null),
    access: {
      role,
      inheritedFromNotebook: Boolean(row.inheritedFromNotebook),
      canComment: roleRank[role] >= roleRank.commenter || owner,
      canEdit: owner || (collaborative && roleRank[role] >= roleRank.editor),
      canPublish: owner || (collaborative && roleRank[role] >= roleRank.publisher),
      canShare: owner || (collaborative && roleRank[role] >= roleRank.editor),
      canDelete: owner
    }
  };
};

const selectDocument = async (client: PoolClient, noteId: string, handle: string) => {
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${documentSelect}
     FROM notes note
     LEFT JOIN profiles owner ON owner.handle = note.owner_handle
     LEFT JOIN workspace_notebooks notebook ON notebook.id = note.notebook_id AND notebook.deleted_at IS NULL
     LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $2
     LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
     WHERE note.id = $3 AND note.deleted_at IS NULL
       AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)`,
    [JSON.stringify(defaultDocument), handle, noteId]
  );
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
  return mapDocument(result.rows[0]);
};

const insertRevision = async (
  client: PoolClient,
  input: {
    noteId: string;
    revision: number;
    editorHandle: string;
    title: string;
    body: string;
    document: unknown;
    kind: string;
    publicationTarget: string;
    targetId: string | null;
    notebookId: string | null;
    attachmentIds: string[];
    reason: string;
  }
) => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO workspace_note_revisions (
       note_id, revision, editor_handle, title, body, content_document, kind,
       publication_target, target_id, notebook_id, attachment_ids, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[], $12)
     RETURNING id::text`,
    [
      input.noteId,
      input.revision,
      input.editorHandle,
      input.title,
      input.body,
      JSON.stringify(input.document),
      input.kind,
      input.publicationTarget,
      input.targetId,
      input.notebookId,
      input.attachmentIds,
      input.reason
    ]
  );
  return result.rows[0]!.id;
};

export const getWorkspaceDocuments = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { workspace: null, notebooks: [], documents: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const workspace = await ensureWorkspace(client, handle);
    const notebooks = await client.query<Record<string, unknown>>(
      `SELECT DISTINCT
         notebook.id::text,
         notebook.workspace_id::text AS "workspaceId",
         notebook.owner_handle AS "ownerHandle",
         notebook.name,
         notebook.revision,
         notebook.created_at AS "createdAt",
         notebook.updated_at AS "updatedAt",
         CASE WHEN notebook.owner_handle = $1 THEN 'owner' ELSE grant_row.role END AS role,
         count(note.id)::int AS "documentCount"
       FROM workspace_notebooks notebook
       LEFT JOIN workspace_notebook_grants grant_row
         ON grant_row.notebook_id = notebook.id AND grant_row.grantee_handle = $1
       LEFT JOIN notes note ON note.notebook_id = notebook.id AND note.deleted_at IS NULL
       WHERE notebook.deleted_at IS NULL
         AND (notebook.owner_handle = $1 OR grant_row.id IS NOT NULL)
       GROUP BY notebook.id, grant_row.role
       ORDER BY notebook.updated_at DESC`,
      [handle]
    );
    const documents = await client.query<Record<string, unknown>>(
      `SELECT ${documentSelect}
       FROM notes note
       LEFT JOIN profiles owner ON owner.handle = note.owner_handle
       LEFT JOIN workspace_notebooks notebook ON notebook.id = note.notebook_id AND notebook.deleted_at IS NULL
       LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $2
       LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
       WHERE note.deleted_at IS NULL
         AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
       ORDER BY note.updated_at DESC`,
      [JSON.stringify(defaultDocument), handle]
    );
    return {
      value: {
        workspace,
        notebooks: notebooks.rows.map((notebook) => ({
          ...notebook,
          createdAt: iso(notebook.createdAt as Date | string),
          updatedAt: iso(notebook.updatedAt as Date | string)
        })),
        documents: documents.rows.map(mapDocument)
      }
    };
  });
};

export const createWorkspaceDocument = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createWorkspaceDocumentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { id: randomUUID(), ...input, revision: 1 };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    await ensureNotebookForOwner(client, workspace.id, handle, input.notebookId);
    const created = await client.query<{ id: string; revision: number }>(
      `INSERT INTO notes (
         workspace_id, owner_handle, notebook_id, title, body, content_document, kind,
         publication_target, target_id, lifecycle, visibility
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', 'private')
       RETURNING id::text, revision`,
      [
        workspace.id,
        handle,
        input.notebookId,
        input.title,
        input.body,
        JSON.stringify(input.document),
        input.kind,
        input.publicationTarget,
        input.targetId
      ]
    );
    const note = created.rows[0]!;
    const attachmentResult = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: note.id,
      ownerType: "note",
      uploaderHandle: handle
    });
    const checkpointId = await insertRevision(client, {
      noteId: note.id,
      revision: note.revision,
      editorHandle: handle,
      ...input,
      reason: "created"
    });
    const value = { document: await selectDocument(client, note.id, handle), checkpointId, removedAttachmentIds: attachmentResult.removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.document.create",
      subjectType: "note",
      subjectId: note.id,
      metadata: mutationAuditMetadata(mutation, { kind: input.kind, notebookId: input.notebookId })
    });
    await completeMutation(client, handle, mutation, value);
    const audienceHandles = await documentAudienceHandles(client, note.id);
    const event = await stageEvent(client, {
      kind: "note.document.created",
      actorHandle: handle,
      audienceHandles,
      subjectType: "note",
      subjectId: note.id,
      visibility: "private",
      payload: { noteId: note.id, revision: note.revision, notebookId: input.notebookId }
    });
    return { value, events: [event] };
  });
};

export const updateWorkspaceDocument = async (
  noteId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updateWorkspaceDocumentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { id: noteId, ...input, revision: input.expectedRevision + 1 };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const preflightAccess = await findDocumentAccess(client, noteId, handle);
    if (!preflightAccess) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    assertCanEdit(preflightAccess);
    await ensureNotebookForOwner(client, preflightAccess.workspaceId, preflightAccess.ownerHandle, input.notebookId);
    await lockWorkspaceDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    assertCanEdit(access);
    assertExpectedRevision("note", access.revision, input.expectedRevision);
    if (input.kind !== access.kind && access.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can change a draft's type." });
    }
    const updated = await client.query<{ revision: number }>(
      `UPDATE notes SET
         notebook_id = $2,
         title = $3,
         body = $4,
         content_document = $5,
         kind = $6,
         publication_target = $7,
         target_id = $8,
         revision = revision + 1,
         updated_at = now()
       WHERE id = $1 AND revision = $9 AND deleted_at IS NULL
       RETURNING revision`,
      [
        noteId,
        input.notebookId,
        input.title,
        input.body,
        JSON.stringify(input.document),
        input.kind,
        input.publicationTarget,
        input.targetId,
        input.expectedRevision
      ]
    );
    if (!updated.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This draft changed before the save committed." });
    const revision = updated.rows[0]!.revision;
    const attachmentResult = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: noteId,
      ownerType: "note",
      uploaderHandle: handle
    });
    const checkpointId = await insertRevision(client, {
      noteId,
      revision,
      editorHandle: handle,
      ...input,
      reason: input.checkpoint ? "checkpoint" : "autosave"
    });
    const value = { document: await selectDocument(client, noteId, handle), checkpointId, removedAttachmentIds: attachmentResult.removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: input.checkpoint ? "workspace.document.checkpoint" : "workspace.document.autosave",
      subjectType: "note",
      subjectId: noteId,
      metadata: mutationAuditMetadata(mutation, { revision, notebookId: input.notebookId })
    });
    await completeMutation(client, handle, mutation, value);
    const audienceHandles = await documentAudienceHandles(client, noteId);
    const event = await stageEvent(client, {
      kind: input.checkpoint ? "note.document.checkpointed" : "note.document.updated",
      actorHandle: handle,
      audienceHandles,
      subjectType: "note",
      subjectId: noteId,
      visibility: "private",
      payload: { noteId, revision, notebookId: input.notebookId }
    });
    return { value, events: [event] };
  });
};

export const deleteWorkspaceDocument = async (
  noteId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = deleteWorkspaceDocumentInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { deleted: true, noteId };
  await ensureLiveData();
  let removedAttachmentIds: string[] = [];
  const result = await runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    await lockWorkspaceDocument(client, noteId);
    const access = await findDocumentAccess(client, noteId, handle, true);
    if (!access || access.role !== "owner") throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    assertExpectedRevision("note", access.revision, input.expectedRevision);
    const deleted = await client.query(
      `UPDATE notes SET deleted_at = now(), revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $2 AND deleted_at IS NULL
       RETURNING id`,
      [noteId, input.expectedRevision]
    );
    if (!deleted.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This draft changed before deletion." });
    removedAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(client, "note", noteId, "workspace_document_deleted");
    const value = { deleted: true, noteId, removedAttachmentIds };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.document.delete",
      subjectType: "note",
      subjectId: noteId,
      metadata: mutationAuditMetadata(mutation)
    });
    await completeMutation(client, handle, mutation, value);
    const audienceHandles = await documentAudienceHandles(client, noteId);
    const event = await stageEvent(client, {
      kind: "note.document.deleted",
      actorHandle: handle,
      audienceHandles,
      subjectType: "note",
      subjectId: noteId,
      visibility: "private"
    });
    return { value, events: [event] };
  });
  if (removedAttachmentIds.length) await triggerStorageDeletion(removedAttachmentIds);
  return result;
};

export const createWorkspaceNotebook = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createWorkspaceNotebookInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { id: randomUUID(), ...input, revision: 1 };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    let notebook;
    try {
      notebook = await client.query<Record<string, unknown>>(
        `INSERT INTO workspace_notebooks (workspace_id, owner_handle, name)
         VALUES ($1, $2, $3)
         RETURNING id::text, workspace_id::text AS "workspaceId", owner_handle AS "ownerHandle", name, revision,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [workspace.id, handle, input.name]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({ code: "CONFLICT", message: "A notebook with that name already exists." });
      }
      throw error;
    }
    const notebookId = String(notebook.rows[0]!.id);
    const value = { notebook: { ...notebook.rows[0], role: "owner", documentCount: 0 } };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.notebook.create",
      subjectType: "notebook",
      subjectId: notebookId,
      metadata: mutationAuditMetadata(mutation, { name: input.name })
    });
    await completeMutation(client, handle, mutation, value);
    const audienceHandles = await notebookAudienceHandles(client, notebookId);
    const event = await stageEvent(client, {
      kind: "note.notebook.created",
      actorHandle: handle,
      audienceHandles,
      subjectType: "notebook",
      subjectId: notebookId,
      visibility: "private"
    });
    return { value, events: [event] };
  });
};

export const updateWorkspaceNotebook = async (
  notebookId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updateWorkspaceNotebookInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { id: notebookId, ...input, revision: input.expectedRevision + 1 };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    let updated;
    try {
      updated = await client.query<Record<string, unknown>>(
        `UPDATE workspace_notebooks SET name = $3, revision = revision + 1, updated_at = now()
         WHERE id = $1 AND owner_handle = $2 AND revision = $4 AND deleted_at IS NULL
         RETURNING id::text, workspace_id::text AS "workspaceId", owner_handle AS "ownerHandle", name, revision,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [notebookId, handle, input.name, input.expectedRevision]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({ code: "CONFLICT", message: "A notebook with that name already exists." });
      }
      throw error;
    }
    if (!updated.rowCount) throw new TRPCError({ code: "CONFLICT", message: "The notebook changed or is no longer available." });
    const value = { notebook: { ...updated.rows[0], role: "owner" } };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.notebook.update",
      subjectType: "notebook",
      subjectId: notebookId,
      metadata: mutationAuditMetadata(mutation, { name: input.name })
    });
    await completeMutation(client, handle, mutation, value);
    const audienceHandles = await notebookAudienceHandles(client, notebookId);
    const event = await stageEvent(client, {
      kind: "note.notebook.updated",
      actorHandle: handle,
      audienceHandles,
      subjectType: "notebook",
      subjectId: notebookId,
      visibility: "private"
    });
    return { value, events: [event] };
  });
};

export const deleteWorkspaceNotebook = async (
  notebookId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = deleteWorkspaceNotebookInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { deleted: true, notebookId, movedDocumentIds: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const notebook = await client.query<{ workspaceId: string }>(
      `SELECT workspace_id::text AS "workspaceId" FROM workspace_notebooks
       WHERE id = $1 AND owner_handle = $2 AND revision = $3 AND deleted_at IS NULL FOR UPDATE`,
      [notebookId, handle, input.expectedRevision]
    );
    if (!notebook.rowCount) throw new TRPCError({ code: "CONFLICT", message: "The notebook changed or is no longer available." });
    const audienceHandles = await notebookAudienceHandles(client, notebookId);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('symposium:workspace-note:' || locked_note.id::text, 0))
       FROM (
         SELECT id FROM notes WHERE notebook_id = $1 AND deleted_at IS NULL ORDER BY id
       ) locked_note`,
      [notebookId]
    );
    const moved = await client.query<{ id: string }>(
      `UPDATE notes SET notebook_id = NULL, revision = revision + 1, updated_at = now()
       WHERE notebook_id = $1 AND deleted_at IS NULL
       RETURNING id::text`,
      [notebookId]
    );
    if (moved.rowCount) {
      await client.query(
        `INSERT INTO workspace_note_revisions (
           note_id, revision, editor_handle, title, body, content_document, kind,
           publication_target, target_id, notebook_id, attachment_ids, reason
         )
         SELECT
           note.id,
           note.revision,
           $2,
           note.title,
           note.body,
           COALESCE(note.content_document, $3::jsonb),
           note.kind,
           note.publication_target,
           note.target_id,
           NULL,
           COALESCE(array_agg(attachment.id) FILTER (WHERE attachment.id IS NOT NULL), ARRAY[]::UUID[]),
           'notebook-deleted'
         FROM notes note
         LEFT JOIN attachments attachment
           ON attachment.owner_type = 'note' AND attachment.owner_id = note.id::text
             AND attachment.status IN ('uploaded', 'previewed')
         WHERE note.id = ANY($1::uuid[])
         GROUP BY note.id
         ON CONFLICT (note_id, revision) DO NOTHING`,
        [moved.rows.map((row) => row.id), handle, JSON.stringify(defaultDocument)]
      );
    }
    await client.query(
      `UPDATE workspace_notebooks SET deleted_at = now(), revision = revision + 1, updated_at = now()
       WHERE id = $1`,
      [notebookId]
    );
    const value = { deleted: true, notebookId, movedDocumentIds: moved.rows.map((row) => row.id) };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.notebook.delete",
      subjectType: "notebook",
      subjectId: notebookId,
      metadata: mutationAuditMetadata(mutation, { movedDocumentIds: value.movedDocumentIds })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.notebook.deleted",
      actorHandle: handle,
      audienceHandles,
      subjectType: "notebook",
      subjectId: notebookId,
      visibility: "private",
      payload: { movedDocumentIds: value.movedDocumentIds }
    });
    return { value, events: [event] };
  });
};

export const searchWorkspaceDocuments = async (rawInput: unknown, actor: Actor) => {
  const input = workspaceSearchInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { query: input.query, documents: [], notebooks: [], collaborators: [] };
  await ensureLiveData();
  const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
  return runAtomic(async (client) => {
    const documents = await client.query<Record<string, unknown>>(
      `SELECT ${documentSelect}
       FROM notes note
       LEFT JOIN profiles owner ON owner.handle = note.owner_handle
       LEFT JOIN workspace_notebooks notebook ON notebook.id = note.notebook_id AND notebook.deleted_at IS NULL
       LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $2
       LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
       WHERE note.deleted_at IS NULL
         AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
         AND ($4::text IS NULL OR note.kind = $4)
         AND ($5::uuid IS NULL OR note.notebook_id = $5)
         AND (
           note.title ILIKE $3 ESCAPE '\\'
           OR note.body ILIKE $3 ESCAPE '\\'
           OR owner.name ILIKE $3 ESCAPE '\\'
           OR owner.handle ILIKE $3 ESCAPE '\\'
           OR notebook.name ILIKE $3 ESCAPE '\\'
           OR EXISTS (
             SELECT 1 FROM workspace_note_comments comment
             WHERE comment.note_id = note.id AND comment.deleted_at IS NULL AND comment.body ILIKE $3 ESCAPE '\\'
           )
           OR EXISTS (
             SELECT 1 FROM attachments attachment
             WHERE attachment.owner_type = 'note' AND attachment.owner_id = note.id::text
               AND (attachment.file_name ILIKE $3 ESCAPE '\\' OR attachment.metadata::text ILIKE $3 ESCAPE '\\')
           )
           OR note.content_document::text ILIKE $3 ESCAPE '\\'
         )
       ORDER BY
         CASE WHEN note.title ILIKE $3 ESCAPE '\\' THEN 0 WHEN notebook.name ILIKE $3 ESCAPE '\\' THEN 1 ELSE 2 END,
         note.updated_at DESC
       LIMIT $6`,
      [JSON.stringify(defaultDocument), handle, pattern, input.kind ?? null, input.notebookId ?? null, input.limit]
    );
    const notebooks = await client.query<Record<string, unknown>>(
      `SELECT notebook.id::text, notebook.name, notebook.owner_handle AS "ownerHandle", notebook.updated_at AS "updatedAt"
       FROM workspace_notebooks notebook
       LEFT JOIN workspace_notebook_grants grant_row
         ON grant_row.notebook_id = notebook.id AND grant_row.grantee_handle = $1
       WHERE notebook.deleted_at IS NULL
         AND (notebook.owner_handle = $1 OR grant_row.id IS NOT NULL)
         AND notebook.name ILIKE $2 ESCAPE '\\'
       ORDER BY notebook.updated_at DESC LIMIT 12`,
      [handle, pattern]
    );
    const collaborators = await client.query<Record<string, unknown>>(
      `WITH visible_notes AS (
         SELECT DISTINCT note.id, note.owner_handle, note.notebook_id
         FROM notes note
         LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $1
         LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $1
         WHERE note.deleted_at IS NULL
           AND (note.owner_handle = $1 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
       ), people AS (
         SELECT owner_handle AS handle FROM visible_notes
         UNION
         SELECT note_grant.grantee_handle AS handle
         FROM visible_notes note
         JOIN workspace_note_grants note_grant ON note_grant.note_id = note.id
         UNION
         SELECT notebook_grant.grantee_handle AS handle
         FROM visible_notes note
         JOIN workspace_notebook_grants notebook_grant ON notebook_grant.notebook_id = note.notebook_id
       )
       SELECT DISTINCT profile.handle, profile.name, profile.avatar_url AS "avatarUrl"
       FROM people
       JOIN profiles profile ON profile.handle = people.handle
       WHERE profile.name ILIKE $2 ESCAPE '\\' OR profile.handle ILIKE $2 ESCAPE '\\'
       LIMIT 12`,
      [handle, pattern]
    );
    return {
      value: {
        query: input.query,
        documents: documents.rows.map(mapDocument),
        notebooks: notebooks.rows.map((notebook) => ({ ...notebook, updatedAt: iso(notebook.updatedAt as Date | string) })),
        collaborators: collaborators.rows
      }
    };
  });
};

export const assertWorkspaceAttachmentAccess = async (attachmentId: string, actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  await ensureLiveData();
  const result = await runAtomic(async (client) => {
    const attachment = await client.query<{ objectKey: string }>(
      `SELECT attachment.object_key AS "objectKey"
       FROM attachments attachment
       JOIN notes note ON attachment.owner_type = 'note' AND attachment.owner_id = note.id::text
       LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $2
       LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
       WHERE attachment.id = $1 AND attachment.status IN ('uploaded', 'previewed')
         AND note.deleted_at IS NULL
         AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)`,
      [attachmentId, handle]
    );
    if (!attachment.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
    return { value: attachment.rows[0] };
  });
  return result;
};
