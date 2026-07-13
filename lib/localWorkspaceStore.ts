import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkspaceDocumentInputSchema,
  createWorkspaceNotebookInputSchema,
  deleteWorkspaceDocumentInputSchema,
  deleteWorkspaceNotebookInputSchema,
  updateWorkspaceDocumentInputSchema,
  updateWorkspaceNotebookInputSchema,
  workspaceSearchInputSchema,
  type CreateWorkspaceDocumentInputContract,
  type UpdateWorkspaceDocumentInputContract
} from "@/packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import {
  deleteLocalOwnerAttachments,
  localAttachmentsForOwner,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import type { WorkspaceDocument, WorkspaceNotebook, WorkspaceSnapshot } from "@/lib/workspaceTypes";

type StoredDocument = Omit<WorkspaceDocument, "attachments" | "access">;
type StoredRevision = Pick<
  StoredDocument,
  "revision" | "title" | "body" | "document" | "kind" | "publicationTarget" | "targetId" | "notebookId"
> & { attachmentIds: string[]; checkpointId: string; reason: string; createdAt: string };
type StoredWorkspace = {
  workspace: NonNullable<WorkspaceSnapshot["workspace"]>;
  notebooks: WorkspaceNotebook[];
  documents: StoredDocument[];
  revisions: Record<string, StoredRevision[]>;
};
type LocalWorkspaceStore = { version: 1; workspaces: Record<string, StoredWorkspace> };

export class LocalWorkspaceStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const storeRoot = path.join(process.cwd(), ".data", "workspace");
const storePath = path.join(storeRoot, "index.json");
let storeQueue: Promise<void> = Promise.resolve();

const withStoreLock = async <T>(operation: () => Promise<T>) => {
  const run = storeQueue.then(operation, operation);
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
};

const emptyStore = (): LocalWorkspaceStore => ({ version: 1, workspaces: {} });

const loadStore = async () => {
  await mkdir(storeRoot, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<LocalWorkspaceStore>;
    return { version: 1, workspaces: parsed.workspaces ?? {} } satisfies LocalWorkspaceStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
};

const saveStore = async (store: LocalWorkspaceStore) => {
  await mkdir(storeRoot, { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, storePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};

const ownerAccess = {
  role: "owner" as const,
  inheritedFromNotebook: false,
  canComment: true,
  canEdit: true,
  canPublish: true,
  canShare: true,
  canDelete: true
};

const ensureWorkspace = (store: LocalWorkspaceStore, rawHandle: string) => {
  const handle = cleanHandle(rawHandle);
  store.workspaces[handle] ??= {
    workspace: { id: randomUUID(), name: "Notebook", ownerHandle: handle },
    notebooks: [],
    documents: [],
    revisions: {}
  };
  return store.workspaces[handle]!;
};

const hydrateDocument = async (document: StoredDocument, handle: string): Promise<WorkspaceDocument> => ({
  ...document,
  attachments: await localAttachmentsForOwner("note", document.id, handle),
  access: ownerAccess
});

const snapshot = async (workspace: StoredWorkspace, handle: string): Promise<WorkspaceSnapshot> => ({
  workspace: workspace.workspace,
  notebooks: workspace.notebooks
    .map((notebook) => ({
      ...notebook,
      documentCount: workspace.documents.filter((document) => document.notebookId === notebook.id).length
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  documents: await Promise.all(
    [...workspace.documents]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((document) => hydrateDocument(document, handle))
  )
});

const revisionFor = (
  document: StoredDocument,
  attachmentIds: string[],
  reason: string
): StoredRevision => ({
  checkpointId: randomUUID(),
  revision: document.revision,
  title: document.title,
  body: document.body,
  document: document.document,
  kind: document.kind,
  publicationTarget: document.publicationTarget,
  targetId: document.targetId,
  notebookId: document.notebookId,
  attachmentIds,
  reason,
  createdAt: new Date().toISOString()
});

const notebookFor = (workspace: StoredWorkspace, notebookId: string | null) => {
  if (!notebookId) return null;
  const notebook = workspace.notebooks.find((candidate) => candidate.id === notebookId);
  if (!notebook) throw new LocalWorkspaceStoreError("Notebook not found.", 404);
  return notebook;
};

export const getLocalWorkspace = async (actorHandle: string) => withStoreLock(async () => {
  const store = await loadStore();
  const workspace = ensureWorkspace(store, actorHandle);
  await saveStore(store);
  return snapshot(workspace, cleanHandle(actorHandle));
});

export const createLocalWorkspaceDocument = async (rawInput: unknown, actorHandle: string) => {
  const input = createWorkspaceDocumentInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const workspace = ensureWorkspace(store, handle);
    const notebook = notebookFor(workspace, input.notebookId);
    const now = new Date().toISOString();
    const document: StoredDocument = {
      id: randomUUID(),
      workspaceId: workspace.workspace.id,
      notebookId: notebook?.id ?? null,
      notebookName: notebook?.name ?? null,
      ownerHandle: handle,
      ownerName: handle.replace(/^@/, ""),
      kind: input.kind,
      publicationTarget: input.publicationTarget,
      targetId: input.targetId,
      title: input.title,
      body: input.body,
      document: input.document,
      lifecycle: "draft",
      revision: 1,
      publishedPostId: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null
    };
    const attachments = await replaceLocalOwnerAttachments({
      actorHandle: handle,
      attachmentIds: input.attachmentIds,
      ownerId: document.id,
      ownerType: "note"
    });
    workspace.documents.push(document);
    workspace.revisions[document.id] = [revisionFor(document, input.attachmentIds, "created")];
    await saveStore(store);
    return { document: { ...document, attachments, access: ownerAccess }, checkpointId: workspace.revisions[document.id]![0]!.checkpointId };
  });
};

export const updateLocalWorkspaceDocument = async (noteId: string, rawInput: unknown, actorHandle: string) => {
  const input = updateWorkspaceDocumentInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const workspace = ensureWorkspace(store, handle);
    const index = workspace.documents.findIndex((document) => document.id === noteId);
    const existing = workspace.documents[index];
    if (!existing) throw new LocalWorkspaceStoreError("Draft not found.", 404);
    if (existing.revision !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("This draft changed after it was opened. Refresh before overwriting it.", 409);
    }
    const notebook = notebookFor(workspace, input.notebookId);
    const document: StoredDocument = {
      ...existing,
      notebookId: notebook?.id ?? null,
      notebookName: notebook?.name ?? null,
      title: input.title,
      body: input.body,
      document: input.document,
      kind: input.kind,
      publicationTarget: input.publicationTarget,
      targetId: input.targetId,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString()
    };
    const attachments = await replaceLocalOwnerAttachments({
      actorHandle: handle,
      attachmentIds: input.attachmentIds,
      ownerId: noteId,
      ownerType: "note"
    });
    workspace.documents[index] = document;
    const revision = revisionFor(document, input.attachmentIds, input.checkpoint ? "checkpoint" : "autosave");
    (workspace.revisions[noteId] ??= []).push(revision);
    await saveStore(store);
    return { document: { ...document, attachments, access: ownerAccess }, checkpointId: revision.checkpointId };
  });
};

export const deleteLocalWorkspaceDocument = async (noteId: string, rawInput: unknown, actorHandle: string) => {
  const input = deleteWorkspaceDocumentInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const workspace = ensureWorkspace(store, actorHandle);
    const document = workspace.documents.find((candidate) => candidate.id === noteId);
    if (!document) throw new LocalWorkspaceStoreError("Draft not found.", 404);
    if (document.revision !== input.expectedRevision) throw new LocalWorkspaceStoreError("This draft changed before deletion.", 409);
    workspace.documents = workspace.documents.filter((candidate) => candidate.id !== noteId);
    delete workspace.revisions[noteId];
    await deleteLocalOwnerAttachments("note", noteId);
    await saveStore(store);
    return { deleted: true, noteId };
  });
};

export const createLocalWorkspaceNotebook = async (rawInput: unknown, actorHandle: string) => {
  const input = createWorkspaceNotebookInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const workspace = ensureWorkspace(store, handle);
    if (workspace.notebooks.some((notebook) => notebook.name.toLowerCase() === input.name.toLowerCase())) {
      throw new LocalWorkspaceStoreError("A notebook with that name already exists.", 409);
    }
    const now = new Date().toISOString();
    const notebook: WorkspaceNotebook = {
      id: randomUUID(),
      workspaceId: workspace.workspace.id,
      ownerHandle: handle,
      name: input.name,
      revision: 1,
      role: "owner",
      documentCount: 0,
      createdAt: now,
      updatedAt: now
    };
    workspace.notebooks.push(notebook);
    await saveStore(store);
    return { notebook };
  });
};

export const updateLocalWorkspaceNotebook = async (notebookId: string, rawInput: unknown, actorHandle: string) => {
  const input = updateWorkspaceNotebookInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const workspace = ensureWorkspace(store, actorHandle);
    const index = workspace.notebooks.findIndex((notebook) => notebook.id === notebookId);
    const existing = workspace.notebooks[index];
    if (!existing || existing.revision !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("The notebook changed or is no longer available.", 409);
    }
    if (workspace.notebooks.some((notebook) => notebook.id !== notebookId && notebook.name.toLowerCase() === input.name.toLowerCase())) {
      throw new LocalWorkspaceStoreError("A notebook with that name already exists.", 409);
    }
    const updated = { ...existing, name: input.name, revision: existing.revision + 1, updatedAt: new Date().toISOString() };
    workspace.notebooks[index] = updated;
    workspace.documents = workspace.documents.map((document) => document.notebookId === notebookId ? { ...document, notebookName: updated.name } : document);
    await saveStore(store);
    return { notebook: updated };
  });
};

export const deleteLocalWorkspaceNotebook = async (notebookId: string, rawInput: unknown, actorHandle: string) => {
  const input = deleteWorkspaceNotebookInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const workspace = ensureWorkspace(store, actorHandle);
    const notebook = workspace.notebooks.find((candidate) => candidate.id === notebookId);
    if (!notebook || notebook.revision !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("The notebook changed or is no longer available.", 409);
    }
    const movedDocumentIds: string[] = [];
    workspace.documents = workspace.documents.map((document) => {
      if (document.notebookId !== notebookId) return document;
      movedDocumentIds.push(document.id);
      const moved = {
        ...document,
        notebookId: null,
        notebookName: null,
        revision: document.revision + 1,
        updatedAt: new Date().toISOString()
      };
      const previous = workspace.revisions[document.id]?.at(-1);
      (workspace.revisions[document.id] ??= []).push(revisionFor(moved, previous?.attachmentIds ?? [], "notebook-deleted"));
      return moved;
    });
    workspace.notebooks = workspace.notebooks.filter((candidate) => candidate.id !== notebookId);
    await saveStore(store);
    return { deleted: true, notebookId, movedDocumentIds };
  });
};

export const searchLocalWorkspace = async (rawInput: unknown, actorHandle: string) => {
  const input = workspaceSearchInputSchema.parse(rawInput);
  const current = await getLocalWorkspace(actorHandle);
  const phrase = input.query.toLowerCase();
  const documents = current.documents
    .filter((document) => !input.kind || document.kind === input.kind)
    .filter((document) => input.notebookId === undefined || document.notebookId === input.notebookId)
    .filter((document) => [document.title, document.body, document.ownerName, document.ownerHandle, document.notebookName ?? "", JSON.stringify(document.document), ...document.attachments.map((attachment) => `${attachment.fileName} ${JSON.stringify(attachment.metadata ?? {})}`)].join(" ").toLowerCase().includes(phrase))
    .slice(0, input.limit);
  const collaborators = Array.from(
    new Map(
      current.documents
        .filter((document) => `${document.ownerName} ${document.ownerHandle}`.toLowerCase().includes(phrase))
        .map((document) => [document.ownerHandle, { handle: document.ownerHandle, name: document.ownerName }])
    ).values()
  ).slice(0, 12);
  return {
    query: input.query,
    documents,
    notebooks: current.notebooks.filter((notebook) => notebook.name.toLowerCase().includes(phrase)).slice(0, 12),
    collaborators
  };
};

export const getLocalWorkspaceRevision = async (noteId: string, revision: number, actorHandle: string) => withStoreLock(async () => {
  const store = await loadStore();
  const workspace = ensureWorkspace(store, actorHandle);
  const document = workspace.documents.find((candidate) => candidate.id === noteId);
  const checkpoint = workspace.revisions[noteId]?.find((candidate) => candidate.revision === revision);
  if (!document || !checkpoint || document.revision !== revision) {
    throw new LocalWorkspaceStoreError("This draft changed after it was opened. Review the latest revision before publishing.", 409);
  }
  return { document, checkpoint };
});

export const markLocalWorkspacePublished = async (
  noteId: string,
  revision: number,
  postId: string,
  actorHandle: string
) => withStoreLock(async () => {
  const store = await loadStore();
  const workspace = ensureWorkspace(store, actorHandle);
  const index = workspace.documents.findIndex((candidate) => candidate.id === noteId);
  const document = workspace.documents[index];
  if (!document || document.revision !== revision) throw new LocalWorkspaceStoreError("The draft changed before publication completed.", 409);
  const now = new Date().toISOString();
  workspace.documents[index] = { ...document, lifecycle: "published", publishedAt: now, publishedPostId: postId, updatedAt: now };
  await saveStore(store);
  return workspace.documents[index]!;
});
