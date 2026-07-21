import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  assistantActionSourceSchema,
  discardScribbleInputSchema,
  fileScribbleInputSchema,
  restoreScribbleInputSchema,
  saveAssistantQuickNoteInputSchema,
  updateScribbleInputSchema,
  type AssistantActionSourceContract,
  type VersionedDocumentContract
} from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";
import { assertExpectedRevision } from "./workspace";

type WorkspaceRow = { id: string; name: string; ownerHandle: string };
type ScribbleRow = {
  id: string;
  workspaceId: string;
  ownerHandle: string;
  body: string;
  document: VersionedDocumentContract;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const emptyDocument = (): VersionedDocumentContract => ({
  version: 1,
  nodes: [{ id: `scribble-${randomUUID()}`, type: "paragraph", content: [], align: "left", indent: 0 }],
  settings: { width: "standard", margin: "normal" }
});

const iso = (value: Date | string) => new Date(value).toISOString();
const mapScribble = (row: ScribbleRow) => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });

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

const insertScribbleRevision = async (
  client: PoolClient,
  scribble: Pick<ScribbleRow, "id" | "revision" | "body" | "document">,
  handle: string,
  reason: "created" | "autosave" | "filed" | "discarded" | "restored"
) => {
  await client.query(
    `INSERT INTO workspace_scribble_revisions (
       scribble_id, revision, editor_handle, body, content_document, reason
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (scribble_id, revision) DO NOTHING`,
    [scribble.id, scribble.revision, handle, scribble.body, JSON.stringify(scribble.document), reason]
  );
  await client.query(
    `DELETE FROM workspace_scribble_revisions
     WHERE scribble_id = $1 AND id IN (
       SELECT id FROM workspace_scribble_revisions
       WHERE scribble_id = $1
       ORDER BY revision DESC OFFSET 500
     )`,
    [scribble.id]
  );
};

const selectScribble = async (client: PoolClient, handle: string, lock = false) => {
  const result = await client.query<ScribbleRow>(
    `SELECT
       id::text,
       workspace_id::text AS "workspaceId",
       owner_handle AS "ownerHandle",
       body,
       content_document AS document,
       revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM workspace_scribbles
     WHERE owner_handle = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [handle]
  );
  return result.rows[0];
};

const ensureScribble = async (client: PoolClient, workspaceId: string, handle: string, lock = false) => {
  const existing = await selectScribble(client, handle, lock);
  if (existing) return existing;
  const document = emptyDocument();
  const created = await client.query<ScribbleRow>(
    `INSERT INTO workspace_scribbles (workspace_id, owner_handle, body, content_document)
     VALUES ($1, $2, '', $3)
     ON CONFLICT (owner_handle) DO NOTHING
     RETURNING
       id::text,
       workspace_id::text AS "workspaceId",
       owner_handle AS "ownerHandle",
       body,
       content_document AS document,
       revision,
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [workspaceId, handle, JSON.stringify(document)]
  );
  const scribble = created.rows[0] ?? await selectScribble(client, handle, lock);
  if (!scribble) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scribble could not be opened." });
  if (created.rows[0]) await insertScribbleRevision(client, scribble, handle, "created");
  return scribble;
};

const ownerNotebooks = async (client: PoolClient, workspaceId: string, handle: string) => {
  const result = await client.query<Record<string, unknown>>(
    `SELECT
       notebook.id::text,
       notebook.name,
       notebook.revision,
       notebook.created_at AS "createdAt",
       notebook.updated_at AS "updatedAt",
       (SELECT count(*)::int FROM workspace_notebook_grants grant_row
         WHERE grant_row.notebook_id = notebook.id) AS "collaboratorCount"
     FROM workspace_notebooks notebook
     WHERE notebook.workspace_id = $1 AND notebook.owner_handle = $2 AND notebook.deleted_at IS NULL
     ORDER BY notebook.updated_at DESC`,
    [workspaceId, handle]
  );
  return result.rows.map((row) => ({
    ...row,
    collaboratorCount: Number(row.collaboratorCount ?? 0),
    createdAt: iso(row.createdAt as Date | string),
    updatedAt: iso(row.updatedAt as Date | string)
  }));
};

const ensureNotebook = async (client: PoolClient, workspaceId: string, handle: string, notebookId: string | null) => {
  if (!notebookId) return null;
  const result = await client.query<{ id: string; name: string }>(
    `SELECT id::text, name FROM workspace_notebooks
     WHERE id = $1 AND workspace_id = $2 AND owner_handle = $3 AND deleted_at IS NULL
     FOR SHARE`,
    [notebookId, workspaceId, handle]
  );
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notebook not found." });
  return result.rows[0];
};

const hasContent = (body: string, document: VersionedDocumentContract) =>
  Boolean(body.trim()) || document.nodes.some((node) =>
    node.type !== "paragraph" || node.content.some((run) => run.text.trim())
  );

const titleForScribble = (body: string, document: VersionedDocumentContract, preferred?: string) => {
  if (preferred?.trim()) return preferred.trim();
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 240);
  const sourceTitle = document.nodes.find((node) =>
    (node.type === "reference" || node.type === "citation") && node.source?.title
  );
  if (sourceTitle && (sourceTitle.type === "reference" || sourceTitle.type === "citation")) {
    return `On ${sourceTitle.source?.title}`.slice(0, 240);
  }
  return `Scribble · ${new Date().toISOString().slice(0, 10)}`;
};

const quickNoteResourceTypes = {
  post: "post",
  community: "community",
  profile: "profile",
  workspace: "note",
  messages: "conversation",
  opportunity: "opportunity",
  attachment: "attachment"
} as const;

const assistantQuickNoteDocument = (body: string, source: AssistantActionSourceContract): VersionedDocumentContract => {
  const paragraphs = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const nodes: VersionedDocumentContract["nodes"] = (paragraphs.length ? paragraphs : [""]).map((paragraph) => ({
    id: `assistant-note-${randomUUID()}`,
    type: "paragraph" as const,
    content: paragraph ? [{ text: paragraph }] : [],
    align: "left" as const,
    indent: 0
  }));
  if (source.entityId && source.surface in quickNoteResourceTypes) {
    const surface = source.surface as keyof typeof quickNoteResourceTypes;
    nodes.push({
      id: `assistant-source-${randomUUID()}`,
      type: "reference",
      resource: { type: quickNoteResourceTypes[surface], id: source.entityId, label: source.title }
    });
  }
  return { version: 1, nodes, settings: { width: "standard", margin: "normal" } };
};

const insertQuickNote = async (client: PoolClient, input: {
  workspaceId: string;
  handle: string;
  notebookId: string | null;
  title: string;
  body: string;
  document: VersionedDocumentContract;
}) => {
  const created = await client.query<{ id: string; revision: number; createdAt: Date | string }>(
    `INSERT INTO notes (
       workspace_id, owner_handle, notebook_id, title, body, content_document, kind,
       publication_target, lifecycle, visibility
     ) VALUES ($1, $2, $3, $4, $5, $6, 'quick', 'undecided', 'draft', 'private')
     RETURNING id::text, revision, created_at AS "createdAt"`,
    [input.workspaceId, input.handle, input.notebookId, input.title, input.body, JSON.stringify(input.document)]
  );
  const note = created.rows[0]!;
  await client.query(
    `INSERT INTO workspace_note_revisions (
       note_id, revision, editor_handle, title, body, content_document, kind,
       publication_target, target_id, notebook_id, attachment_ids, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, 'quick', 'undecided', NULL, $7, ARRAY[]::UUID[], 'created')`,
    [note.id, note.revision, input.handle, input.title, input.body, JSON.stringify(input.document), input.notebookId]
  );
  return note;
};

const emptyLocalScribble = (handle: string) => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    ownerHandle: handle,
    body: "",
    document: emptyDocument(),
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
};

export const getScribble = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { scribble: emptyLocalScribble(handle), notebooks: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const workspace = await ensureWorkspace(client, handle);
    const scribble = await ensureScribble(client, workspace.id, handle);
    return { value: { scribble: mapScribble(scribble), notebooks: await ownerNotebooks(client, workspace.id, handle) } };
  });
};

export const updateScribble = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = updateScribbleInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { scribble: { ...emptyLocalScribble(handle), ...input, revision: input.expectedRevision + 1 } };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    const current = await ensureScribble(client, workspace.id, handle, true);
    assertExpectedRevision("scribble", current.revision, input.expectedRevision);
    const result = await client.query<ScribbleRow>(
      `UPDATE workspace_scribbles SET
         body = $2,
         content_document = $3,
         revision = revision + 1,
         updated_at = now()
       WHERE id = $1 AND revision = $4
       RETURNING
         id::text,
         workspace_id::text AS "workspaceId",
         owner_handle AS "ownerHandle",
         body,
         content_document AS document,
         revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [current.id, input.body, JSON.stringify(input.document), input.expectedRevision]
    );
    if (!result.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This Scribble changed before the autosave committed." });
    const scribble = result.rows[0];
    await insertScribbleRevision(client, scribble, handle, "autosave");
    const value = { scribble: mapScribble(scribble) };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.scribble.update",
      subjectType: "scribble",
      subjectId: scribble.id,
      metadata: mutationAuditMetadata(mutation, { revision: scribble.revision })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "scribble.updated",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "scribble",
      subjectId: scribble.id,
      visibility: "private",
      payload: { revision: scribble.revision }
    });
    return { value, events: [event] };
  });
};

export const fileScribble = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = fileScribbleInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Local filing is handled by the web fallback." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    const current = await ensureScribble(client, workspace.id, handle, true);
    assertExpectedRevision("scribble", current.revision, input.expectedRevision);
    if (!hasContent(current.body, current.document)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Write or add something before filing this Scribble." });
    }
    const notebook = await ensureNotebook(client, workspace.id, handle, input.notebookId);
    const title = titleForScribble(current.body, current.document, input.title);
    const filed = await insertQuickNote(client, {
      workspaceId: workspace.id,
      handle,
      notebookId: notebook?.id ?? null,
      title,
      body: current.body,
      document: current.document
    });
    const resetDocument = emptyDocument();
    const resetResult = await client.query<ScribbleRow>(
      `UPDATE workspace_scribbles SET
         body = '', content_document = $2, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3
       RETURNING
         id::text,
         workspace_id::text AS "workspaceId",
         owner_handle AS "ownerHandle",
         body,
         content_document AS document,
         revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [current.id, JSON.stringify(resetDocument), input.expectedRevision]
    );
    if (!resetResult.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This Scribble changed before it could be filed." });
    const scribble = resetResult.rows[0];
    await insertScribbleRevision(client, scribble, handle, "filed");
    const value = {
      scribble: mapScribble(scribble),
      filed: {
        id: filed.id,
        title,
        revision: filed.revision,
        notebookId: notebook?.id ?? null,
        notebookName: notebook?.name ?? null,
        createdAt: iso(filed.createdAt)
      }
    };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.scribble.file",
      subjectType: "scribble",
      subjectId: scribble.id,
      metadata: mutationAuditMetadata(mutation, { noteId: filed.id, notebookId: notebook?.id ?? null })
    });
    await completeMutation(client, handle, mutation, value);
    const noteAudience = notebook?.id
      ? (await client.query<{ handle: string }>(
          `SELECT $1::text AS handle UNION SELECT grantee_handle FROM workspace_notebook_grants WHERE notebook_id = $2`,
          [handle, notebook.id]
        )).rows.map((row) => row.handle)
      : [handle];
    const noteEvent = await stageEvent(client, {
      kind: "note.document.created",
      actorHandle: handle,
      audienceHandles: noteAudience,
      subjectType: "note",
      subjectId: filed.id,
      visibility: "private",
      payload: { noteId: filed.id, revision: filed.revision, notebookId: notebook?.id ?? null, kind: "quick" }
    });
    const scribbleEvent = await stageEvent(client, {
      kind: "scribble.filed",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "scribble",
      subjectId: scribble.id,
      visibility: "private",
      payload: { revision: scribble.revision, noteId: filed.id }
    });
    return { value, events: [noteEvent, scribbleEvent] };
  });
};

export const createAssistantQuickNote = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = saveAssistantQuickNoteInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI Quick Notes require the live workspace." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const assistantMessage = await client.query<{ id: string; metadata: Record<string, unknown> }>(
      `SELECT message.id, message.metadata
       FROM ai_messages message
       JOIN ai_conversations conversation ON conversation.id = message.conversation_id
       WHERE message.id = $1
         AND message.conversation_id = $2
         AND message.role = 'assistant'
         AND conversation.owner_handle = $3
         AND (
           (message.metadata -> 'translation' IS NOT NULL AND message.metadata -> 'translation' <> 'null'::jsonb)
           OR (message.metadata -> 'quickNote' IS NOT NULL AND message.metadata -> 'quickNote' <> 'null'::jsonb)
         )
       FOR SHARE OF message, conversation`,
      [input.assistantMessageId, input.conversationId, handle]
    );
    const actionMessage = assistantMessage.rows[0];
    if (!actionMessage) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That Quick Note draft is not available to save." });
    }
    const quickNoteMetadata = actionMessage.metadata.quickNote as { source?: unknown } | null | undefined;
    const translationMetadata = actionMessage.metadata.translation as { source?: unknown } | null | undefined;
    const source = assistantActionSourceSchema.parse(quickNoteMetadata?.source ?? translationMetadata?.source);
    const workspace = await ensureWorkspace(client, handle);
    const notebook = await ensureNotebook(client, workspace.id, handle, input.notebookId);
    const document = assistantQuickNoteDocument(input.body, source);
    const note = await insertQuickNote(client, {
      workspaceId: workspace.id,
      handle,
      notebookId: notebook?.id ?? null,
      title: input.title,
      body: input.body,
      document
    });
    const value = {
      id: note.id,
      title: input.title,
      revision: note.revision,
      createdAt: iso(note.createdAt),
      notebookId: notebook?.id ?? null,
      notebookName: notebook?.name ?? null,
      href: `/workspace?view=notes&note=${encodeURIComponent(note.id)}`
    };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "assistant.quick_note.create",
      subjectType: "note",
      subjectId: note.id,
      metadata: mutationAuditMetadata(mutation, {
        assistantMessageId: input.assistantMessageId,
        conversationId: input.conversationId,
        targetLanguage: input.targetLanguage,
        sourceSurface: source.surface,
        sourceId: source.entityId ?? null,
        notebookId: notebook?.id ?? null
      })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.document.created",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "note",
      subjectId: note.id,
      visibility: "private",
      payload: {
        noteId: note.id,
        revision: note.revision,
        notebookId: notebook?.id ?? null,
        kind: "quick",
        source: input.targetLanguage ? "assistant_translation" : "assistant_quick_note"
      }
    });
    return { value, events: [event] };
  });
};

export const discardScribble = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = discardScribbleInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Local discard is handled by the web fallback." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    const current = await ensureScribble(client, workspace.id, handle, true);
    assertExpectedRevision("scribble", current.revision, input.expectedRevision);
    const discardedRevision = current.revision;
    const document = emptyDocument();
    const result = await client.query<ScribbleRow>(
      `UPDATE workspace_scribbles SET
         body = '', content_document = $2, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $3
       RETURNING
         id::text,
         workspace_id::text AS "workspaceId",
         owner_handle AS "ownerHandle",
         body,
         content_document AS document,
         revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [current.id, JSON.stringify(document), input.expectedRevision]
    );
    if (!result.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This Scribble changed before discard completed." });
    const scribble = result.rows[0];
    await insertScribbleRevision(client, scribble, handle, "discarded");
    const value = { scribble: mapScribble(scribble), discardedRevision };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.scribble.discard",
      subjectType: "scribble",
      subjectId: scribble.id,
      metadata: mutationAuditMetadata(mutation, { discardedRevision })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "scribble.discarded",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "scribble",
      subjectId: scribble.id,
      visibility: "private",
      payload: { revision: scribble.revision, discardedRevision }
    });
    return { value, events: [event] };
  });
};

export const restoreScribble = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = restoreScribbleInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Local restore is handled by the web fallback." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const workspace = await ensureWorkspace(client, handle);
    const current = await ensureScribble(client, workspace.id, handle, true);
    assertExpectedRevision("scribble", current.revision, input.expectedRevision);
    if (hasContent(current.body, current.document)) {
      throw new TRPCError({ code: "CONFLICT", message: "The new Scribble already has content and cannot be replaced." });
    }
    const snapshot = await client.query<{ body: string; document: VersionedDocumentContract }>(
      `SELECT body, content_document AS document
       FROM workspace_scribble_revisions
       WHERE scribble_id = $1 AND revision = $2`,
      [current.id, input.discardedRevision]
    );
    if (!snapshot.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "That discarded Scribble is no longer recoverable." });
    const result = await client.query<ScribbleRow>(
      `UPDATE workspace_scribbles SET
         body = $2, content_document = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $4
       RETURNING
         id::text,
         workspace_id::text AS "workspaceId",
         owner_handle AS "ownerHandle",
         body,
         content_document AS document,
         revision,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [current.id, snapshot.rows[0].body, JSON.stringify(snapshot.rows[0].document), input.expectedRevision]
    );
    if (!result.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This Scribble changed before recovery completed." });
    const scribble = result.rows[0];
    await insertScribbleRevision(client, scribble, handle, "restored");
    const value = { scribble: mapScribble(scribble) };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.scribble.restore",
      subjectType: "scribble",
      subjectId: scribble.id,
      metadata: mutationAuditMetadata(mutation, { restoredRevision: input.discardedRevision })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: "scribble.restored",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "scribble",
      subjectId: scribble.id,
      visibility: "private",
      payload: { revision: scribble.revision }
    });
    return { value, events: [event] };
  });
};
