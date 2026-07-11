import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { saveNoteBlockInputSchema } from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData } from "./foundation";

type OwnedWorkspaceRow = { id: string; name: string; visibility: string };
type OwnedNoteRow = { id: string; workspaceId: string };
type OwnedBlockRow = { id: string; noteId: string; workspaceId: string };

const ensureOwnedWorkspace = async (client: PoolClient, handle: string, workspaceId?: string) => {
  if (workspaceId) {
    const owned = await client.query<OwnedWorkspaceRow>(
      `SELECT id, name, visibility FROM workspaces
       WHERE id = $1 AND owner_handle = $2
       FOR SHARE`,
      [workspaceId, handle]
    );
    if (!owned.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found." });
    return owned.rows[0];
  }

  const workspace = await client.query<OwnedWorkspaceRow>(
    `INSERT INTO workspaces (owner_handle, name)
     VALUES ($1, 'Notebook')
     ON CONFLICT (owner_handle, name) DO UPDATE SET updated_at = workspaces.updated_at
     RETURNING id, name, visibility`,
    [handle]
  );
  return workspace.rows[0]!;
};

const findOwnedNote = async (client: PoolClient, handle: string, noteId: string) => {
  const result = await client.query<OwnedNoteRow>(
    `SELECT note.id, note.workspace_id AS "workspaceId"
     FROM notes note
     JOIN workspaces workspace ON workspace.id = note.workspace_id
     WHERE note.id = $1 AND workspace.owner_handle = $2
     FOR SHARE OF note`,
    [noteId, handle]
  );
  return result.rows[0];
};

const findOwnedBlock = async (client: PoolClient, handle: string, blockId: string) => {
  const result = await client.query<OwnedBlockRow>(
    `SELECT block.id, block.note_id AS "noteId", note.workspace_id AS "workspaceId"
     FROM note_blocks block
     JOIN notes note ON note.id = block.note_id
     JOIN workspaces workspace ON workspace.id = note.workspace_id
     WHERE block.id = $1 AND workspace.owner_handle = $2
     FOR UPDATE OF block`,
    [blockId, handle]
  );
  return result.rows[0];
};


export const getWorkspace = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { workspace: null, notes: [], blocks: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const workspaceRow = await ensureOwnedWorkspace(client, handle);
    const notes = await client.query(
      "SELECT id, title, visibility, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM notes WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceRow.id]
    );
    const blocks = await client.query(
      `SELECT nb.id, nb.note_id AS "noteId", nb.kind, nb.body, nb.sort_order AS "sortOrder", nb.updated_at AS "updatedAt"
       FROM note_blocks nb
       JOIN notes n ON n.id = nb.note_id
       WHERE n.workspace_id = $1
       ORDER BY nb.sort_order ASC, nb.created_at ASC`,
      [workspaceRow.id]
    );
    return { value: { workspace: workspaceRow, notes: notes.rows, blocks: blocks.rows } };
  });
};

export const saveNoteBlock = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = saveNoteBlockInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { id: input.blockId ?? randomUUID(), body: input.body };
  await ensureLiveData();

  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };

    let workspace = input.workspaceId
      ? await ensureOwnedWorkspace(client, handle, input.workspaceId)
      : undefined;
    let noteId = input.noteId;
    if (noteId) {
      const ownedNote = await findOwnedNote(client, handle, noteId);
      if (!ownedNote) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      if (workspace && workspace.id !== ownedNote.workspaceId) {
        throw new TRPCError({ code: "CONFLICT", message: "The note does not belong to this workspace." });
      }
      workspace ??= await ensureOwnedWorkspace(client, handle, ownedNote.workspaceId);
    }

    const existingBlock = input.blockId
      ? await findOwnedBlock(client, handle, input.blockId)
      : undefined;
    if (input.blockId && !existingBlock) {
      const foreignBlock = await client.query("SELECT 1 FROM note_blocks WHERE id = $1", [input.blockId]);
      if (foreignBlock.rowCount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note block not found." });
      }
    }
    if (existingBlock) {
      if (noteId && noteId !== existingBlock.noteId) {
        throw new TRPCError({ code: "CONFLICT", message: "The block already belongs to another note." });
      }
      if (workspace && workspace.id !== existingBlock.workspaceId) {
        throw new TRPCError({ code: "CONFLICT", message: "The block does not belong to this workspace." });
      }
      noteId = existingBlock.noteId;
      workspace ??= await ensureOwnedWorkspace(client, handle, existingBlock.workspaceId);
    }

    workspace ??= await ensureOwnedWorkspace(client, handle);
    if (!noteId) {
      const note = await client.query<{ id: string }>(
        `INSERT INTO notes (workspace_id, title, visibility)
         VALUES ($1, 'Notebook', $2)
         RETURNING id`,
        [workspace.id, input.visibility]
      );
      noteId = note.rows[0]!.id;
    }

    const block = existingBlock
      ? await client.query(
          `UPDATE note_blocks SET body = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
          [existingBlock.id, input.body]
        )
      : await client.query(
          `INSERT INTO note_blocks (id, note_id, body)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
           RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
          [input.blockId ?? null, noteId, input.body]
        );
    await client.query("UPDATE workspaces SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [workspace.id, handle]);
    const value = block.rows[0] as Record<string, unknown>;
    await stageAuditLog(client, {
      actorHandle: handle,
      action: existingBlock ? "note.block.update" : "note.block.create",
      subjectType: "note_block",
      subjectId: String(value.id),
      metadata: mutationAuditMetadata(mutation, { noteId, workspaceId: workspace.id })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: existingBlock ? "note.block.updated" : "note.block.created",
      actorHandle: handle,
      subjectType: "note_block",
      subjectId: String(value.id),
      visibility: "private",
      payload: { noteId, workspaceId: workspace.id }
    });
    return { value, events: [event] };
  });
};
