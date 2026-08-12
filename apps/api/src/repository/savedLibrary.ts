import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  createSavedLibraryFolderInputSchema,
  deleteSavedLibraryFolderInputSchema,
  updateSavedLibraryEntryInputSchema,
  updateSavedLibraryFolderInputSchema,
  type SavedLibraryEntryContract,
  type SavedLibraryFolderContract,
  type SavedLibraryResponseContract
} from "../../../../packages/contracts/src";
import { buildLegacyProfileActivity } from "@/lib/profileActivity";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, getInitialState } from "./foundation";
import { listProfileActivitySubjects } from "./inquiryReads";

type SavedEntryRow = {
  subjectType: "post" | "comment";
  subjectId: string;
  postId: string;
  folderId: string | null;
  savedAt: Date | string;
  archivedAt: Date | string | null;
  archiveExpiresAt: Date | string | null;
  revision: number;
};

type SavedFolderRow = {
  id: string;
  name: string;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  itemCount: number;
};

type MemoryLibrary = {
  entries: Map<string, SavedLibraryEntryContract>;
  folders: SavedLibraryFolderContract[];
};

const memoryLibraries = new Map<string, MemoryLibrary>();
const archiveLifetimeMs = 60 * 24 * 60 * 60 * 1000;
const entryKey = (subjectType: "post" | "comment", subjectId: string) => `${subjectType}:${subjectId}`;
const iso = (value: Date | string) => new Date(value).toISOString();
const optionalIso = (value: Date | string | null) => value ? iso(value) : null;
const libraryFor = (handle: string) => {
  const existing = memoryLibraries.get(handle);
  if (existing) return existing;
  const created = { entries: new Map<string, SavedLibraryEntryContract>(), folders: [] };
  memoryLibraries.set(handle, created);
  return created;
};

const entryFromRow = (row: SavedEntryRow): SavedLibraryEntryContract => ({
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  postId: row.postId,
  folderId: row.folderId,
  savedAt: iso(row.savedAt),
  archivedAt: optionalIso(row.archivedAt),
  archiveExpiresAt: optionalIso(row.archiveExpiresAt),
  revision: row.revision
});

const folderFromRow = (row: SavedFolderRow): SavedLibraryFolderContract => ({
  id: row.id,
  name: row.name,
  revision: row.revision,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  itemCount: Number(row.itemCount)
});

const activeMemoryEntries = async (handle: string) => {
  const snapshot = await getInitialState();
  const activities = buildLegacyProfileActivity(
    snapshot.items.filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft"),
    handle,
    ["save"]
  );
  const library = libraryFor(handle);
  const activeKeys = new Set<string>();
  for (const activity of activities) {
    const key = entryKey(activity.subjectType, activity.subjectId);
    activeKeys.add(key);
    const current = library.entries.get(key);
    if (!current) {
      library.entries.set(key, {
        subjectType: activity.subjectType,
        subjectId: activity.subjectId,
        postId: activity.postId,
        folderId: null,
        savedAt: activity.occurredAt,
        archivedAt: null,
        archiveExpiresAt: null,
        revision: 1
      });
    }
  }
  for (const [key, entry] of library.entries) {
    if (!activeKeys.has(key) || (entry.archiveExpiresAt && Date.parse(entry.archiveExpiresAt) <= Date.now())) {
      library.entries.delete(key);
    }
  }
  return { snapshot, library };
};

const synchronizeSavedEntries = async (handle: string) => {
  await getPool().query(
    `WITH active_saves AS (
       SELECT
         'post'::text AS subject_type,
         action.post_id AS subject_id,
         action.post_id AS post_id,
         action.revision AS source_action_revision,
         action.updated_at AS saved_at
       FROM post_actions action
       INNER JOIN posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1
         AND action.action = 'save'
         AND action.active = true
         AND post.deleted_at IS NULL
         AND post.room <> 'office'
         AND post.kind <> 'draft'
       UNION ALL
       SELECT
         'comment'::text AS subject_type,
         action.comment_id AS subject_id,
         action.post_id,
         action.revision AS source_action_revision,
         action.updated_at AS saved_at
       FROM comment_actions action
       INNER JOIN comments comment ON comment.id = action.comment_id
       INNER JOIN posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1
         AND action.action = 'save'
         AND action.active = true
         AND comment.deleted_at IS NULL
         AND post.deleted_at IS NULL
         AND post.room <> 'office'
         AND post.kind <> 'draft'
     )
     INSERT INTO saved_library_entries (
       owner_handle, subject_type, subject_id, post_id, source_action_revision, saved_at
     )
     SELECT $1, subject_type, subject_id, post_id, source_action_revision, saved_at
     FROM active_saves
     ON CONFLICT (owner_handle, subject_type, subject_id)
     DO UPDATE SET
       post_id = EXCLUDED.post_id,
       folder_id = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN NULL
         ELSE saved_library_entries.folder_id
       END,
       archived_at = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN NULL
         ELSE saved_library_entries.archived_at
       END,
       archive_expires_at = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN NULL
         ELSE saved_library_entries.archive_expires_at
       END,
       saved_at = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN EXCLUDED.saved_at
         ELSE saved_library_entries.saved_at
       END,
       source_action_revision = EXCLUDED.source_action_revision,
       revision = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN saved_library_entries.revision + 1
         ELSE saved_library_entries.revision
       END,
       updated_at = CASE
         WHEN saved_library_entries.source_action_revision < EXCLUDED.source_action_revision
           THEN now()
         ELSE saved_library_entries.updated_at
       END`,
    [handle]
  );

  await getPool().query(
    `DELETE FROM saved_library_entries entry
     WHERE entry.owner_handle = $1
       AND NOT EXISTS (
         SELECT 1 FROM post_actions action
         WHERE entry.subject_type = 'post'
           AND action.post_id = entry.subject_id
           AND action.actor_handle = entry.owner_handle
           AND action.action = 'save'
           AND action.active = true
         UNION ALL
         SELECT 1 FROM comment_actions action
         WHERE entry.subject_type = 'comment'
           AND action.comment_id = entry.subject_id
           AND action.actor_handle = entry.owner_handle
           AND action.action = 'save'
           AND action.active = true
       )`,
    [handle]
  );
};

const expireArchivedEntries = async (handle: string) => {
  await runAtomic(async (client) => {
    const expired = await client.query<{ subjectType: "post" | "comment"; subjectId: string; postId: string }>(
      `SELECT subject_type AS "subjectType", subject_id AS "subjectId", post_id AS "postId"
       FROM saved_library_entries
       WHERE owner_handle = $1
         AND archive_expires_at IS NOT NULL
         AND archive_expires_at <= now()
       FOR UPDATE`,
      [handle]
    );
    if (!expired.rows.length) return { value: undefined };

    const postIds = expired.rows.filter((entry) => entry.subjectType === "post").map((entry) => entry.subjectId);
    const commentIds = expired.rows.filter((entry) => entry.subjectType === "comment").map((entry) => entry.subjectId);
    if (postIds.length) {
      await client.query(
        `UPDATE post_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE actor_handle = $1 AND action = 'save' AND active = true AND post_id = ANY($2::text[])`,
        [handle, postIds]
      );
      await client.query(
        `UPDATE posts post
         SET saved_by = COALESCE((
               SELECT jsonb_agg(action.actor_handle ORDER BY action.actor_handle)
               FROM post_actions action
               WHERE action.post_id = post.id AND action.action = 'save' AND action.active = true
             ), '[]'::jsonb),
             saved = EXISTS (
               SELECT 1 FROM post_actions action
               WHERE action.post_id = post.id AND action.action = 'save' AND action.active = true
             ),
             metrics = jsonb_set(
               COALESCE(post.metrics, '{}'::jsonb),
               '{saves}',
               to_jsonb((SELECT count(*)::text FROM post_actions action WHERE action.post_id = post.id AND action.action = 'save' AND action.active = true)),
               true
             ),
             revision = revision + 1,
             updated_at = now()
         WHERE post.id = ANY($1::text[])`,
        [postIds]
      );
    }
    if (commentIds.length) {
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE actor_handle = $1 AND action = 'save' AND active = true AND comment_id = ANY($2::text[])`,
        [handle, commentIds]
      );
      await client.query(
        `UPDATE comments comment
         SET saved_by = COALESCE((
               SELECT jsonb_agg(action.actor_handle ORDER BY action.actor_handle)
               FROM comment_actions action
               WHERE action.comment_id = comment.id AND action.action = 'save' AND action.active = true
             ), '[]'::jsonb),
             metrics = jsonb_set(
               COALESCE(comment.metrics, '{}'::jsonb),
               '{saves}',
               to_jsonb((SELECT count(*)::text FROM comment_actions action WHERE action.comment_id = comment.id AND action.action = 'save' AND action.active = true)),
               true
             ),
             revision = revision + 1,
             updated_at = now()
         WHERE comment.id = ANY($1::text[])`,
        [commentIds]
      );
      await client.query(
        `UPDATE posts SET revision = revision + 1, updated_at = now()
         WHERE id = ANY($1::text[])`,
        [Array.from(new Set(expired.rows.filter((entry) => entry.subjectType === "comment").map((entry) => entry.postId)))]
      );
    }
    await client.query(
      `DELETE FROM saved_library_entries
       WHERE owner_handle = $1 AND archive_expires_at IS NOT NULL AND archive_expires_at <= now()`,
      [handle]
    );
    return { value: undefined };
  });
};

export const listSavedLibrary = async (actor: Actor): Promise<SavedLibraryResponseContract> => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    const { snapshot, library } = await activeMemoryEntries(handle);
    const entries = [...library.entries.values()].sort((left, right) =>
      Date.parse(right.savedAt) - Date.parse(left.savedAt)
    );
    const postIds = new Set(entries.map((entry) => entry.postId));
    const itemCounts = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.archivedAt && entry.folderId) itemCounts.set(entry.folderId, (itemCounts.get(entry.folderId) ?? 0) + 1);
    }
    return {
      entries,
      folders: library.folders.map((folder) => ({ ...folder, itemCount: itemCounts.get(folder.id) ?? 0 })),
      items: snapshot.items.filter((item) => postIds.has(item.id)),
      profiles: snapshot.profiles
    };
  }

  await ensureLiveData();
  await expireArchivedEntries(handle);
  await synchronizeSavedEntries(handle);
  const [entriesResult, foldersResult] = await Promise.all([
    getPool().query<SavedEntryRow>(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         post_id AS "postId",
         folder_id AS "folderId",
         saved_at AS "savedAt",
         archived_at AS "archivedAt",
         archive_expires_at AS "archiveExpiresAt",
         revision
       FROM saved_library_entries
       WHERE owner_handle = $1
       ORDER BY saved_at DESC, subject_type DESC, subject_id DESC
       LIMIT 500`,
      [handle]
    ),
    getPool().query<SavedFolderRow>(
      `SELECT
         folder.id,
         folder.name,
         folder.revision,
         folder.created_at AS "createdAt",
         folder.updated_at AS "updatedAt",
         count(entry.subject_id) FILTER (WHERE entry.archived_at IS NULL)::int AS "itemCount"
       FROM saved_library_folders folder
       LEFT JOIN saved_library_entries entry
         ON entry.owner_handle = folder.owner_handle AND entry.folder_id = folder.id
       WHERE folder.owner_handle = $1
       GROUP BY folder.id
       ORDER BY folder.updated_at DESC, lower(folder.name), folder.id
       LIMIT 100`,
      [handle]
    )
  ]);
  const entries = entriesResult.rows.map(entryFromRow);
  const hydration = await listProfileActivitySubjects(
    entries.map((entry) => entry.postId),
    entries.filter((entry) => entry.subjectType === "comment").map((entry) => entry.subjectId),
    handle
  );
  return {
    entries,
    folders: foldersResult.rows.map(folderFromRow),
    ...hydration
  };
};

export const createSavedLibraryFolder = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<SavedLibraryFolderContract> => {
  const input = createSavedLibraryFolderInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    const library = libraryFor(handle);
    if (library.folders.some((folder) => folder.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new TRPCError({ code: "CONFLICT", message: "A saved folder already uses that name." });
    }
    const now = new Date().toISOString();
    const folder = { id: randomUUID(), name: input.name, revision: 1, createdAt: now, updatedAt: now, itemCount: 0 };
    library.folders.unshift(folder);
    return folder;
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<SavedLibraryFolderContract>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const id = randomUUID();
    let result;
    try {
      result = await client.query<SavedFolderRow>(
        `INSERT INTO saved_library_folders (id, owner_handle, name)
         VALUES ($1, $2, $3)
         RETURNING id, name, revision, created_at AS "createdAt", updated_at AS "updatedAt", 0::int AS "itemCount"`,
        [id, handle, input.name]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({ code: "CONFLICT", message: "A saved folder already uses that name." });
      }
      throw error;
    }
    const folder = folderFromRow(result.rows[0]);
    await completeMutation(client, handle, mutation, folder);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "saved_library.folder.create",
      subjectType: "saved_library_folder",
      subjectId: folder.id,
      metadata: mutationAuditMetadata(mutation, { name: folder.name })
    });
    return { value: folder };
  });
};

export const updateSavedLibraryFolder = async (
  folderId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<SavedLibraryFolderContract> => {
  const input = updateSavedLibraryFolderInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    const library = libraryFor(handle);
    const index = library.folders.findIndex((folder) => folder.id === folderId);
    const current = library.folders[index];
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Saved folder not found." });
    if (current.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This folder changed elsewhere." });
    const updated = { ...current, name: input.name, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    library.folders[index] = updated;
    return updated;
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<SavedLibraryFolderContract>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    let result;
    try {
      result = await client.query<SavedFolderRow>(
        `UPDATE saved_library_folders folder
         SET name = $4, revision = revision + 1, updated_at = now()
         WHERE folder.id = $1 AND folder.owner_handle = $2 AND folder.revision = $3
         RETURNING folder.id, folder.name, folder.revision, folder.created_at AS "createdAt", folder.updated_at AS "updatedAt",
           (SELECT count(*)::int FROM saved_library_entries entry WHERE entry.owner_handle = $2 AND entry.folder_id = folder.id AND entry.archived_at IS NULL) AS "itemCount"`,
        [folderId, handle, input.expectedRevision, input.name]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new TRPCError({ code: "CONFLICT", message: "A saved folder already uses that name." });
      throw error;
    }
    if (!result.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This folder changed or no longer exists." });
    const folder = folderFromRow(result.rows[0]);
    await completeMutation(client, handle, mutation, folder);
    await stageAuditLog(client, { actorHandle: handle, action: "saved_library.folder.update", subjectType: "saved_library_folder", subjectId: folder.id, metadata: mutationAuditMetadata(mutation, { name: folder.name }) });
    return { value: folder };
  });
};

export const deleteSavedLibraryFolder = async (
  folderId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = deleteSavedLibraryFolderInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    const library = libraryFor(handle);
    const current = library.folders.find((folder) => folder.id === folderId);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Saved folder not found." });
    if (current.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This folder changed elsewhere." });
    library.folders = library.folders.filter((folder) => folder.id !== folderId);
    for (const [key, entry] of library.entries) if (entry.folderId === folderId) library.entries.set(key, { ...entry, folderId: null, revision: entry.revision + 1 });
    return { deleted: { id: folderId } };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ deleted: { id: string } }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const result = await client.query(
      `DELETE FROM saved_library_folders WHERE id = $1 AND owner_handle = $2 AND revision = $3 RETURNING id`,
      [folderId, handle, input.expectedRevision]
    );
    if (!result.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This folder changed or no longer exists." });
    const value = { deleted: { id: folderId } };
    await completeMutation(client, handle, mutation, value);
    await stageAuditLog(client, { actorHandle: handle, action: "saved_library.folder.delete", subjectType: "saved_library_folder", subjectId: folderId, metadata: mutationAuditMetadata(mutation) });
    return { value };
  });
};

export const updateSavedLibraryEntry = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<SavedLibraryEntryContract> => {
  const input = updateSavedLibraryEntryInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const key = entryKey(input.subjectType, input.subjectId);
  if (!hasDatabase()) {
    const library = libraryFor(handle);
    const current = library.entries.get(key);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Saved item not found." });
    if (current.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This saved item changed elsewhere." });
    if (input.folderId && !library.folders.some((folder) => folder.id === input.folderId)) throw new TRPCError({ code: "NOT_FOUND", message: "Saved folder not found." });
    const now = new Date();
    const updated = {
      ...current,
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.archived === true ? { archivedAt: now.toISOString(), archiveExpiresAt: new Date(now.getTime() + archiveLifetimeMs).toISOString() } : {}),
      ...(input.archived === false ? { archivedAt: null, archiveExpiresAt: null } : {}),
      revision: current.revision + 1
    };
    library.entries.set(key, updated);
    return updated;
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<SavedLibraryEntryContract>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    if (input.folderId) {
      const folder = await client.query("SELECT 1 FROM saved_library_folders WHERE id = $1 AND owner_handle = $2", [input.folderId, handle]);
      if (!folder.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Saved folder not found." });
    }
    const result = await client.query<SavedEntryRow>(
      `UPDATE saved_library_entries entry
       SET folder_id = CASE WHEN $5::boolean THEN $4::uuid ELSE entry.folder_id END,
           archived_at = CASE WHEN $6::boolean IS TRUE THEN now() WHEN $6::boolean IS FALSE THEN NULL ELSE entry.archived_at END,
           archive_expires_at = CASE WHEN $6::boolean IS TRUE THEN now() + interval '60 days' WHEN $6::boolean IS FALSE THEN NULL ELSE entry.archive_expires_at END,
           revision = revision + 1,
           updated_at = now()
       WHERE entry.owner_handle = $1 AND entry.subject_type = $2 AND entry.subject_id = $3 AND entry.revision = $7
       RETURNING entry.subject_type AS "subjectType", entry.subject_id AS "subjectId", entry.post_id AS "postId", entry.folder_id AS "folderId", entry.saved_at AS "savedAt", entry.archived_at AS "archivedAt", entry.archive_expires_at AS "archiveExpiresAt", entry.revision`,
      [handle, input.subjectType, input.subjectId, input.folderId ?? null, input.folderId !== undefined, input.archived ?? null, input.expectedRevision]
    );
    if (!result.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "This saved item changed or no longer exists." });
    const entry = entryFromRow(result.rows[0]);
    await completeMutation(client, handle, mutation, entry);
    await stageAuditLog(client, { actorHandle: handle, action: input.archived === true ? "saved_library.entry.archive" : input.archived === false ? "saved_library.entry.restore" : "saved_library.entry.file", subjectType: input.subjectType, subjectId: input.subjectId, metadata: mutationAuditMetadata(mutation, { folderId: entry.folderId, postId: entry.postId, archiveExpiresAt: entry.archiveExpiresAt }) });
    return { value: entry };
  });
};
