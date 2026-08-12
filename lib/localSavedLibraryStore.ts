import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSavedLibraryFolderInputSchema,
  deleteSavedLibraryFolderInputSchema,
  updateSavedLibraryEntryInputSchema,
  updateSavedLibraryFolderInputSchema,
  type SavedLibraryEntryContract,
  type SavedLibraryFolderContract,
  type SavedLibraryResponseContract
} from "@/packages/contracts/src";
import { applyCommentAction, applyPostAction, getSnapshot } from "@/lib/dataStore";
import { buildLegacyProfileActivity } from "@/lib/profileActivity";
import { cleanHandle } from "@/lib/symposiumCore";
import { createSerializedExecutor, readJsonFile, writeJsonFileAtomically } from "@/lib/localJsonStore";

type Library = { entries: SavedLibraryEntryContract[]; folders: SavedLibraryFolderContract[] };
type Store = { version: 1; libraries: Record<string, Library> };

export class LocalSavedLibraryStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const storePath = path.join(process.cwd(), ".data", "saved-library", "index.json");
const withStoreLock = createSerializedExecutor();
const archiveLifetimeMs = 60 * 24 * 60 * 60 * 1000;
const emptyStore = (): Store => ({ version: 1, libraries: {} });
const load = () => readJsonFile<Store>(storePath, emptyStore);
const save = (store: Store) => writeJsonFileAtomically(storePath, store);
const entryKey = (entry: Pick<SavedLibraryEntryContract, "subjectType" | "subjectId">) => `${entry.subjectType}:${entry.subjectId}`;
const ownerLibrary = (store: Store, rawHandle: string) => {
  const handle = cleanHandle(rawHandle);
  return store.libraries[handle] ??= { entries: [], folders: [] };
};

const synchronize = async (store: Store, rawHandle: string) => {
  const handle = cleanHandle(rawHandle);
  const library = ownerLibrary(store, handle);
  const now = Date.now();
  const expired = library.entries.filter((entry) => entry.archiveExpiresAt && Date.parse(entry.archiveExpiresAt) <= now);
  for (const entry of expired) {
    if (entry.subjectType === "post") {
      await applyPostAction(entry.postId, "save", handle, false);
    } else {
      await applyCommentAction(entry.postId, entry.subjectId, "save", handle, false);
    }
  }
  const snapshot = await getSnapshot();
  const activities = buildLegacyProfileActivity(
    snapshot.items.filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft"),
    handle,
    ["save"]
  );
  const currentByKey = new Map(library.entries.map((entry) => [entryKey(entry), entry]));
  library.entries = activities.map((activity) => currentByKey.get(`${activity.subjectType}:${activity.subjectId}`) ?? {
    subjectType: activity.subjectType,
    subjectId: activity.subjectId,
    postId: activity.postId,
    folderId: null,
    savedAt: activity.occurredAt,
    archivedAt: null,
    archiveExpiresAt: null,
    revision: 1
  });
  const activeFolderIds = new Set(library.folders.map((folder) => folder.id));
  library.entries = library.entries.map((entry) => entry.folderId && !activeFolderIds.has(entry.folderId)
    ? { ...entry, folderId: null, revision: entry.revision + 1 }
    : entry);
  return { snapshot, library };
};

export const getLocalSavedLibrary = (rawHandle: string): Promise<SavedLibraryResponseContract> =>
  withStoreLock(async () => {
    const handle = cleanHandle(rawHandle);
    const store = await load();
    const { snapshot, library } = await synchronize(store, handle);
    const counts = new Map<string, number>();
    for (const entry of library.entries) if (!entry.archivedAt && entry.folderId) counts.set(entry.folderId, (counts.get(entry.folderId) ?? 0) + 1);
    const postIds = new Set(library.entries.map((entry) => entry.postId));
    await save(store);
    return {
      entries: [...library.entries].sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt)),
      folders: library.folders.map((folder) => ({ ...folder, itemCount: counts.get(folder.id) ?? 0 })),
      items: snapshot.items.filter((item) => postIds.has(item.id)),
      profiles: snapshot.profiles
    };
  });

export const createLocalSavedLibraryFolder = (rawInput: unknown, rawHandle: string) =>
  withStoreLock(async () => {
    const input = createSavedLibraryFolderInputSchema.parse(rawInput);
    const store = await load();
    const library = ownerLibrary(store, rawHandle);
    if (library.folders.some((folder) => folder.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new LocalSavedLibraryStoreError("A saved folder already uses that name.", 409);
    }
    const now = new Date().toISOString();
    const folder = { id: randomUUID(), name: input.name, revision: 1, createdAt: now, updatedAt: now, itemCount: 0 };
    library.folders.unshift(folder);
    await save(store);
    return { folder };
  });

export const updateLocalSavedLibraryFolder = (folderId: string, rawInput: unknown, rawHandle: string) =>
  withStoreLock(async () => {
    const input = updateSavedLibraryFolderInputSchema.parse(rawInput);
    const store = await load();
    const library = ownerLibrary(store, rawHandle);
    const index = library.folders.findIndex((folder) => folder.id === folderId);
    const current = library.folders[index];
    if (!current) throw new LocalSavedLibraryStoreError("Saved folder not found.", 404);
    if (current.revision !== input.expectedRevision) throw new LocalSavedLibraryStoreError("This folder changed elsewhere.", 409);
    if (library.folders.some((folder) => folder.id !== folderId && folder.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new LocalSavedLibraryStoreError("A saved folder already uses that name.", 409);
    }
    const folder = { ...current, name: input.name, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    library.folders[index] = folder;
    await save(store);
    return { folder };
  });

export const deleteLocalSavedLibraryFolder = (folderId: string, rawInput: unknown, rawHandle: string) =>
  withStoreLock(async () => {
    const input = deleteSavedLibraryFolderInputSchema.parse(rawInput);
    const store = await load();
    const library = ownerLibrary(store, rawHandle);
    const current = library.folders.find((folder) => folder.id === folderId);
    if (!current) throw new LocalSavedLibraryStoreError("Saved folder not found.", 404);
    if (current.revision !== input.expectedRevision) throw new LocalSavedLibraryStoreError("This folder changed elsewhere.", 409);
    library.folders = library.folders.filter((folder) => folder.id !== folderId);
    library.entries = library.entries.map((entry) => entry.folderId === folderId
      ? { ...entry, folderId: null, revision: entry.revision + 1 }
      : entry);
    await save(store);
    return { deleted: { id: folderId } };
  });

export const updateLocalSavedLibraryEntry = (rawInput: unknown, rawHandle: string) =>
  withStoreLock(async () => {
    const input = updateSavedLibraryEntryInputSchema.parse(rawInput);
    const store = await load();
    const { library } = await synchronize(store, rawHandle);
    const index = library.entries.findIndex((entry) => entry.subjectType === input.subjectType && entry.subjectId === input.subjectId);
    const current = library.entries[index];
    if (!current) throw new LocalSavedLibraryStoreError("Saved item not found.", 404);
    if (current.revision !== input.expectedRevision) throw new LocalSavedLibraryStoreError("This saved item changed elsewhere.", 409);
    if (input.folderId && !library.folders.some((folder) => folder.id === input.folderId)) {
      throw new LocalSavedLibraryStoreError("Saved folder not found.", 404);
    }
    const now = new Date();
    const entry: SavedLibraryEntryContract = {
      ...current,
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.archived === true ? { archivedAt: now.toISOString(), archiveExpiresAt: new Date(now.getTime() + archiveLifetimeMs).toISOString() } : {}),
      ...(input.archived === false ? { archivedAt: null, archiveExpiresAt: null } : {}),
      revision: current.revision + 1
    };
    library.entries[index] = entry;
    await save(store);
    return { entry };
  });
