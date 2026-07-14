import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkspaceDocumentInputSchema,
  createWorkspaceGrantInputSchema,
  createWorkspaceNotebookInputSchema,
  deleteWorkspaceGrantInputSchema,
  deleteWorkspaceDocumentInputSchema,
  deleteWorkspaceNotebookInputSchema,
  updateWorkspaceDocumentInputSchema,
  updateWorkspaceGrantInputSchema,
  updateWorkspaceNotebookInputSchema,
  workspaceAccessRoleRank,
  workspaceCollaboratorSearchInputSchema,
  workspaceDocumentSupportsCollaborativeEditing,
  workspaceGrantCeiling,
  workspaceRoleWithinCeiling,
  workspaceSearchInputSchema,
  type CreateWorkspaceDocumentInputContract,
  type UpdateWorkspaceDocumentInputContract,
  type WorkspaceAccessResourceContract,
  type WorkspaceAccessRoleContract,
  type WorkspaceGrantRoleContract
} from "@/packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { profilesByName } from "@/lib/mockData";
import {
  deleteLocalOwnerAttachments,
  localAttachmentsForOwner,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import type {
  WorkspaceAccessOverview,
  WorkspaceDocument,
  WorkspaceNotebook,
  WorkspaceSnapshot
} from "@/lib/workspaceTypes";

type StoredDocument = Omit<WorkspaceDocument, "attachments" | "access" | "collaboratorCount" | "commentCount">;
type StoredRevision = Pick<
  StoredDocument,
  "revision" | "title" | "body" | "document" | "kind" | "publicationTarget" | "targetId" | "notebookId"
> & { attachmentIds: string[]; checkpointId: string; reason: string; createdAt: string };
type StoredGrant = {
  id: string;
  granteeHandle: string;
  role: WorkspaceGrantRoleContract;
  revision: number;
  grantedByHandle: string;
  createdAt: string;
  updatedAt: string;
};
type StoredWorkspace = {
  workspace: NonNullable<WorkspaceSnapshot["workspace"]>;
  notebooks: WorkspaceNotebook[];
  documents: StoredDocument[];
  revisions: Record<string, StoredRevision[]>;
  notebookGrants: Record<string, StoredGrant[]>;
  documentGrants: Record<string, StoredGrant[]>;
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
    const workspaces = parsed.workspaces ?? {};
    for (const workspace of Object.values(workspaces)) {
      workspace.notebookGrants ??= {};
      workspace.documentGrants ??= {};
    }
    return { version: 1, workspaces } satisfies LocalWorkspaceStore;
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

const ensureWorkspace = (store: LocalWorkspaceStore, rawHandle: string) => {
  const handle = cleanHandle(rawHandle);
  store.workspaces[handle] ??= {
    workspace: { id: randomUUID(), name: "Notebook", ownerHandle: handle },
    notebooks: [],
    documents: [],
    revisions: {},
    notebookGrants: {},
    documentGrants: {}
  };
  return store.workspaces[handle]!;
};

const roleFor = (workspace: StoredWorkspace, document: StoredDocument, handle: string): WorkspaceAccessRoleContract => {
  if (document.ownerHandle === handle) return "owner";
  const direct = workspace.documentGrants[document.id]?.find((grant) => grant.granteeHandle === handle)?.role;
  const inherited = document.notebookId
    ? workspace.notebookGrants[document.notebookId]?.find((grant) => grant.granteeHandle === handle)?.role
    : undefined;
  const projected = !direct
    ? inherited ?? "viewer"
    : !inherited
      ? direct
      : workspaceAccessRoleRank[direct] >= workspaceAccessRoleRank[inherited] ? direct : inherited;
  return !workspaceDocumentSupportsCollaborativeEditing(document.kind)
    && workspaceAccessRoleRank[projected] > workspaceAccessRoleRank.commenter
    ? "commenter"
    : projected;
};

const hydrateDocument = async (workspace: StoredWorkspace, document: StoredDocument, handle: string): Promise<WorkspaceDocument> => {
  const role = roleFor(workspace, document, handle);
  const owner = role === "owner";
  const collaborative = workspaceDocumentSupportsCollaborativeEditing(document.kind);
  const directHandles = workspace.documentGrants[document.id]?.map((grant) => grant.granteeHandle) ?? [];
  const inheritedHandles = document.notebookId
    ? workspace.notebookGrants[document.notebookId]?.map((grant) => grant.granteeHandle) ?? []
    : [];
  const { getLocalWorkspaceCommentCount } = await import("@/lib/localWorkspaceCommentStore");
  return {
  ...document,
  attachments: await localAttachmentsForOwner("note", document.id, handle),
  collaboratorCount: new Set([...directHandles, ...inheritedHandles]).size,
  commentCount: await getLocalWorkspaceCommentCount(document.id),
  access: {
    role,
    inheritedFromNotebook: Boolean(document.notebookId && inheritedHandles.includes(handle)),
    canComment: owner || workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.commenter,
    canEdit: owner || (collaborative && workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.editor),
    canPublish: owner || (collaborative && workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.publisher),
    canShare: owner || (collaborative && workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.editor),
    canDelete: owner
  }
};
};

const snapshot = async (store: LocalWorkspaceStore, ownWorkspace: StoredWorkspace, handle: string): Promise<WorkspaceSnapshot> => {
  const visibleWorkspaces = Object.values(store.workspaces);
  const notebooks = visibleWorkspaces.flatMap((workspace) => workspace.notebooks
    .filter((notebook) => notebook.ownerHandle === handle || workspace.notebookGrants[notebook.id]?.some((grant) => grant.granteeHandle === handle))
    .map((notebook) => {
      const role = notebook.ownerHandle === handle
        ? "owner" as const
        : workspace.notebookGrants[notebook.id]?.find((grant) => grant.granteeHandle === handle)?.role ?? "viewer";
      return {
        ...notebook,
        role,
        documentCount: workspace.documents.filter((document) => document.notebookId === notebook.id).length,
        collaboratorCount: workspace.notebookGrants[notebook.id]?.length ?? 0,
        canShare: Boolean(workspaceGrantCeiling(role))
      };
    }));
  const visibleDocuments = visibleWorkspaces.flatMap((workspace) => workspace.documents
    .filter((document) => document.ownerHandle === handle
      || workspace.documentGrants[document.id]?.some((grant) => grant.granteeHandle === handle)
      || Boolean(document.notebookId && workspace.notebookGrants[document.notebookId]?.some((grant) => grant.granteeHandle === handle)))
    .map((document) => ({ workspace, document })));
  return {
  workspace: ownWorkspace.workspace,
  notebooks: notebooks
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  documents: await Promise.all(
    visibleDocuments
      .sort((left, right) => right.document.updatedAt.localeCompare(left.document.updatedAt))
      .map(({ workspace, document }) => hydrateDocument(workspace, document, handle))
  )
};
};

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

const documentWorkspaceFor = (store: LocalWorkspaceStore, noteId: string) => {
  for (const workspace of Object.values(store.workspaces)) {
    const index = workspace.documents.findIndex((document) => document.id === noteId);
    if (index >= 0) return { workspace, index, document: workspace.documents[index]! };
  }
  return null;
};

const notebookWorkspaceFor = (store: LocalWorkspaceStore, notebookId: string) => {
  for (const workspace of Object.values(store.workspaces)) {
    const index = workspace.notebooks.findIndex((notebook) => notebook.id === notebookId);
    if (index >= 0) return { workspace, index, notebook: workspace.notebooks[index]! };
  }
  return null;
};

const assertLocalDocumentAccess = (
  workspace: StoredWorkspace,
  document: StoredDocument,
  handle: string,
  capability: "view" | "edit" | "publish" | "owner"
) => {
  const role = roleFor(workspace, document, handle);
  const owner = document.ownerHandle === handle;
  const collaborative = workspaceDocumentSupportsCollaborativeEditing(document.kind);
  const allowed = capability === "view"
    ? owner || workspace.documentGrants[document.id]?.some((grant) => grant.granteeHandle === handle)
      || Boolean(document.notebookId && workspace.notebookGrants[document.notebookId]?.some((grant) => grant.granteeHandle === handle))
    : capability === "owner"
      ? owner
      : capability === "publish"
        ? owner || (collaborative && workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.publisher)
        : owner || (collaborative && workspaceAccessRoleRank[role] >= workspaceAccessRoleRank.editor);
  if (!allowed) throw new LocalWorkspaceStoreError(capability === "view" ? "Draft not found." : `This draft is not available for ${capability}ing with your current access.`, capability === "view" ? 404 : 403);
  return role;
};

export const getLocalWorkspace = async (actorHandle: string) => withStoreLock(async () => {
  const store = await loadStore();
  const workspace = ensureWorkspace(store, actorHandle);
  await saveStore(store);
  return snapshot(store, workspace, cleanHandle(actorHandle));
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
    return {
      document: { ...(await hydrateDocument(workspace, document, handle)), attachments },
      checkpointId: workspace.revisions[document.id]![0]!.checkpointId
    };
  });
};

export const updateLocalWorkspaceDocument = async (noteId: string, rawInput: unknown, actorHandle: string) => {
  const input = updateWorkspaceDocumentInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const located = documentWorkspaceFor(store, noteId);
    if (!located) throw new LocalWorkspaceStoreError("Draft not found.", 404);
    const { workspace, index, document: existing } = located;
    const role = assertLocalDocumentAccess(workspace, existing, handle, "edit");
    if (existing.revision !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("This draft changed after it was opened. Refresh before overwriting it.", 409);
    }
    if (input.notebookId !== existing.notebookId && role !== "owner") {
      throw new LocalWorkspaceStoreError("Only the owner can move a draft between notebooks.", 403);
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
    await replaceLocalOwnerAttachments({
      actorHandle: handle,
      attachmentIds: input.attachmentIds,
      ownerId: noteId,
      ownerType: "note"
    });
    workspace.documents[index] = document;
    const revision = revisionFor(document, input.attachmentIds, input.checkpoint ? "checkpoint" : "autosave");
    (workspace.revisions[noteId] ??= []).push(revision);
    await saveStore(store);
    return {
      document: await hydrateDocument(workspace, document, handle),
      checkpointId: revision.checkpointId
    };
  });
};

export const deleteLocalWorkspaceDocument = async (noteId: string, rawInput: unknown, actorHandle: string) => {
  const input = deleteWorkspaceDocumentInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const located = documentWorkspaceFor(store, noteId);
    if (!located) throw new LocalWorkspaceStoreError("Draft not found.", 404);
    const { workspace, document } = located;
    assertLocalDocumentAccess(workspace, document, handle, "owner");
    if (document.revision !== input.expectedRevision) throw new LocalWorkspaceStoreError("This draft changed before deletion.", 409);
    workspace.documents = workspace.documents.filter((candidate) => candidate.id !== noteId);
    delete workspace.revisions[noteId];
    delete workspace.documentGrants[noteId];
    await deleteLocalOwnerAttachments("note", noteId);
    const { deleteLocalWorkspaceCommentsForDocument } = await import("@/lib/localWorkspaceCommentStore");
    await deleteLocalWorkspaceCommentsForDocument(noteId);
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
      collaboratorCount: 0,
      canShare: true,
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
    const handle = cleanHandle(actorHandle);
    const located = notebookWorkspaceFor(store, notebookId);
    if (!located) throw new LocalWorkspaceStoreError("The notebook changed or is no longer available.", 409);
    const { workspace, index, notebook: existing } = located;
    if (existing.ownerHandle !== handle) throw new LocalWorkspaceStoreError("The notebook is only editable by its owner.", 403);
    if (existing.revision !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("The notebook changed or is no longer available.", 409);
    }
    if (workspace.notebooks.some((notebook) => notebook.id !== notebookId && notebook.name.toLowerCase() === input.name.toLowerCase())) {
      throw new LocalWorkspaceStoreError("A notebook with that name already exists.", 409);
    }
    const role = "owner" as const;
    const updated: WorkspaceNotebook = {
      ...existing,
      name: input.name,
      revision: existing.revision + 1,
      role,
      documentCount: workspace.documents.filter((document) => document.notebookId === notebookId).length,
      collaboratorCount: workspace.notebookGrants[notebookId]?.length ?? 0,
      canShare: true,
      updatedAt: new Date().toISOString()
    };
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
    const handle = cleanHandle(actorHandle);
    const located = notebookWorkspaceFor(store, notebookId);
    if (!located) throw new LocalWorkspaceStoreError("The notebook changed or is no longer available.", 409);
    const { workspace, notebook } = located;
    if (notebook.ownerHandle !== handle) throw new LocalWorkspaceStoreError("The notebook is only removable by its owner.", 403);
    if (notebook.revision !== input.expectedRevision) {
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
    delete workspace.notebookGrants[notebookId];
    await saveStore(store);
    return { deleted: true, notebookId, movedDocumentIds };
  });
};

export const searchLocalWorkspace = async (rawInput: unknown, actorHandle: string) => {
  const input = workspaceSearchInputSchema.parse(rawInput);
  const current = await getLocalWorkspace(actorHandle);
  const phrase = input.query.toLowerCase();
  const { getLocalWorkspaceComments } = await import("@/lib/localWorkspaceCommentStore");
  const commentTextByDocument = new Map(await Promise.all(current.documents.map(async (document) => {
    const discussion = await getLocalWorkspaceComments(document.id, actorHandle);
    return [document.id, JSON.stringify(discussion.comments)] as const;
  })));
  const documents = current.documents
    .filter((document) => !input.kind || document.kind === input.kind)
    .filter((document) => input.notebookId === undefined || document.notebookId === input.notebookId)
    .filter((document) => [document.title, document.body, document.ownerName, document.ownerHandle, document.notebookName ?? "", JSON.stringify(document.document), commentTextByDocument.get(document.id) ?? "", ...document.attachments.map((attachment) => `${attachment.fileName} ${JSON.stringify(attachment.metadata ?? {})}`)].join(" ").toLowerCase().includes(phrase))
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
  const handle = cleanHandle(actorHandle);
  const located = documentWorkspaceFor(store, noteId);
  if (!located) throw new LocalWorkspaceStoreError("Draft not found.", 404);
  const { workspace, document } = located;
  assertLocalDocumentAccess(workspace, document, handle, "publish");
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
  const handle = cleanHandle(actorHandle);
  const located = documentWorkspaceFor(store, noteId);
  if (!located) throw new LocalWorkspaceStoreError("Draft not found.", 404);
  const { workspace, index, document } = located;
  assertLocalDocumentAccess(workspace, document, handle, "publish");
  if (!document || document.revision !== revision) throw new LocalWorkspaceStoreError("The draft changed before publication completed.", 409);
  const now = new Date().toISOString();
  workspace.documents[index] = { ...document, lifecycle: "published", publishedAt: now, publishedPostId: postId, updatedAt: now };
  await saveStore(store);
  return workspace.documents[index]!;
});

type LocalAccessResource = {
  type: WorkspaceAccessResourceContract;
  id: string;
  name: string;
  ownerHandle: string;
  actorRole: WorkspaceAccessRoleContract;
  workspace: StoredWorkspace;
  kind?: WorkspaceDocument["kind"];
  notebookId?: string | null;
  notebookName?: string | null;
};

const localProfile = (handle: string) => Object.values(profilesByName).find((person) => person.handle === handle);

const localResourceFor = (
  store: LocalWorkspaceStore,
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  actorHandle: string
): LocalAccessResource => {
  if (type === "document") {
    const located = documentWorkspaceFor(store, resourceId);
    if (!located) throw new LocalWorkspaceStoreError("Draft not found.", 404);
    const { workspace, document } = located;
    assertLocalDocumentAccess(workspace, document, actorHandle, "view");
    return {
      type,
      id: document.id,
      name: document.title,
      ownerHandle: document.ownerHandle,
      actorRole: roleFor(workspace, document, actorHandle),
      workspace,
      kind: document.kind,
      notebookId: document.notebookId,
      notebookName: document.notebookName
    };
  }
  const located = notebookWorkspaceFor(store, resourceId);
  if (!located) throw new LocalWorkspaceStoreError("Notebook not found.", 404);
  const { workspace, notebook } = located;
  const direct = workspace.notebookGrants[notebook.id]?.find((grant) => grant.granteeHandle === actorHandle);
  if (notebook.ownerHandle !== actorHandle && !direct) throw new LocalWorkspaceStoreError("Notebook not found.", 404);
  return {
    type,
    id: notebook.id,
    name: notebook.name,
    ownerHandle: notebook.ownerHandle,
    actorRole: notebook.ownerHandle === actorHandle ? "owner" : direct!.role,
    workspace
  };
};

const localGrantList = (resource: LocalAccessResource) => resource.type === "document"
  ? resource.workspace.documentGrants[resource.id] ?? []
  : resource.workspace.notebookGrants[resource.id] ?? [];

const localInheritedGrantList = (resource: LocalAccessResource) => resource.type === "document" && resource.notebookId
  ? resource.workspace.notebookGrants[resource.notebookId] ?? []
  : [];

const localAccessOverview = (resource: LocalAccessResource, actorHandle: string): WorkspaceAccessOverview => {
  const direct = localGrantList(resource);
  const inherited = localInheritedGrantList(resource);
  const people = new Map<string, WorkspaceAccessOverview["collaborators"][number]>();
  for (const grant of inherited) {
    const person = localProfile(grant.granteeHandle);
    people.set(grant.granteeHandle, {
      handle: grant.granteeHandle,
      name: person?.name ?? grant.granteeHandle,
      ...(person?.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
      effectiveRole: grant.role,
      directGrant: null,
      inheritedGrant: {
        role: grant.role,
        notebookId: resource.notebookId!,
        notebookName: resource.notebookName ?? "Notebook",
        grantedByHandle: grant.grantedByHandle
      }
    });
  }
  for (const grant of direct) {
    const personProfile = localProfile(grant.granteeHandle);
    const person = people.get(grant.granteeHandle) ?? {
      handle: grant.granteeHandle,
      name: personProfile?.name ?? grant.granteeHandle,
      ...(personProfile?.avatarUrl ? { avatarUrl: personProfile.avatarUrl } : {}),
      effectiveRole: grant.role,
      directGrant: null,
      inheritedGrant: null
    };
    const canManage = resource.actorRole === "owner" || grant.grantedByHandle === actorHandle;
    person.directGrant = {
      id: grant.id,
      role: grant.role,
      revision: grant.revision,
      grantedByHandle: grant.grantedByHandle,
      grantedByName: localProfile(grant.grantedByHandle)?.name ?? grant.grantedByHandle,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      canManage,
      canRemove: canManage || grant.granteeHandle === actorHandle
    };
    if (workspaceAccessRoleRank[grant.role] > workspaceAccessRoleRank[person.effectiveRole]) person.effectiveRole = grant.role;
    people.set(grant.granteeHandle, person);
  }
  if (resource.kind && !workspaceDocumentSupportsCollaborativeEditing(resource.kind)) {
    for (const person of people.values()) {
      if (workspaceAccessRoleRank[person.effectiveRole] > workspaceAccessRoleRank.commenter) {
        person.effectiveRole = "commenter";
      }
    }
  }
  const owner = localProfile(resource.ownerHandle);
  const maxGrantRole = workspaceGrantCeiling(resource.actorRole, resource.kind);
  return {
    resource: {
      type: resource.type,
      id: resource.id,
      name: resource.name,
      ...(resource.kind ? { kind: resource.kind } : {}),
      ...(resource.type === "document"
        ? { notebookId: resource.notebookId ?? null, notebookName: resource.notebookName ?? null }
        : {})
    },
    owner: {
      handle: resource.ownerHandle,
      name: owner?.name ?? resource.ownerHandle,
      ...(owner?.avatarUrl ? { avatarUrl: owner.avatarUrl } : {})
    },
    actor: { role: resource.actorRole, canInvite: Boolean(maxGrantRole), maxGrantRole },
    collaborators: [...people.values()].sort((left, right) => left.name.localeCompare(right.name))
  };
};

const assertLocalGrantAllowed = (resource: LocalAccessResource, role: WorkspaceGrantRoleContract) => {
  if (!workspaceRoleWithinCeiling(role, workspaceGrantCeiling(resource.actorRole, resource.kind))) {
    throw new LocalWorkspaceStoreError("You cannot grant access above your current sharing role.", 403);
  }
};

export const getLocalWorkspaceAccess = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  actorHandle: string
) => withStoreLock(async () => {
  const store = await loadStore();
  const handle = cleanHandle(actorHandle);
  return localAccessOverview(localResourceFor(store, type, resourceId, handle), handle);
});

export const createLocalWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = createWorkspaceGrantInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const granteeHandle = cleanHandle(input.granteeHandle);
    const resource = localResourceFor(store, type, resourceId, handle);
    if (granteeHandle === handle || granteeHandle === resource.ownerHandle) {
      throw new LocalWorkspaceStoreError("Choose another Symposium participant.", 400);
    }
    if (!localProfile(granteeHandle)) throw new LocalWorkspaceStoreError("Profile not found.", 404);
    assertLocalGrantAllowed(resource, input.role);
    const grants = localGrantList(resource);
    if (grants.some((grant) => grant.granteeHandle === granteeHandle)) {
      throw new LocalWorkspaceStoreError("This participant already has direct access.", 409);
    }
    const now = new Date().toISOString();
    const grant: StoredGrant = {
      id: randomUUID(),
      granteeHandle,
      role: input.role,
      revision: 1,
      grantedByHandle: handle,
      createdAt: now,
      updatedAt: now
    };
    grants.push(grant);
    if (type === "document") resource.workspace.documentGrants[resource.id] = grants;
    else resource.workspace.notebookGrants[resource.id] = grants;
    await saveStore(store);
    return { grant, access: localAccessOverview(resource, handle) };
  });
};

export const updateLocalWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawGranteeHandle: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = updateWorkspaceGrantInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const granteeHandle = cleanHandle(rawGranteeHandle);
    const resource = localResourceFor(store, type, resourceId, handle);
    assertLocalGrantAllowed(resource, input.role);
    const grant = localGrantList(resource).find((candidate) => candidate.granteeHandle === granteeHandle);
    if (!grant) throw new LocalWorkspaceStoreError("Direct access grant not found.", 404);
    if (resource.actorRole !== "owner" && grant.grantedByHandle !== handle) {
      throw new LocalWorkspaceStoreError("Only the owner or grant creator can change this access.", 403);
    }
    if (grant.revision !== input.expectedRevision) throw new LocalWorkspaceStoreError("This access setting changed before your update.", 409);
    grant.role = input.role;
    grant.revision += 1;
    grant.updatedAt = new Date().toISOString();
    await saveStore(store);
    return { access: localAccessOverview(resource, handle) };
  });
};

export const deleteLocalWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawGranteeHandle: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = deleteWorkspaceGrantInputSchema.parse(rawInput);
  return withStoreLock(async () => {
    const store = await loadStore();
    const handle = cleanHandle(actorHandle);
    const granteeHandle = cleanHandle(rawGranteeHandle);
    const resource = localResourceFor(store, type, resourceId, handle);
    const grants = localGrantList(resource);
    const grant = grants.find((candidate) => candidate.granteeHandle === granteeHandle);
    if (!grant) throw new LocalWorkspaceStoreError("Direct access grant not found.", 404);
    if (resource.actorRole !== "owner" && grant.grantedByHandle !== handle && granteeHandle !== handle) {
      throw new LocalWorkspaceStoreError("Only the owner, grant creator, or recipient can remove this access.", 403);
    }
    if (grant.revision !== input.expectedRevision) throw new LocalWorkspaceStoreError("This access setting changed before removal.", 409);
    const next = grants.filter((candidate) => candidate !== grant);
    if (type === "document") resource.workspace.documentGrants[resource.id] = next;
    else resource.workspace.notebookGrants[resource.id] = next;
    let access = null;
    try {
      const remainingResource = localResourceFor(store, type, resourceId, handle);
      access = localAccessOverview(remainingResource, handle);
    } catch (error) {
      if (!(error instanceof LocalWorkspaceStoreError) || error.status !== 404) throw error;
    }
    await saveStore(store);
    return {
      removed: true,
      resourceId,
      granteeHandle,
      access
    };
  });
};

export const searchLocalWorkspaceCollaborators = async (rawInput: unknown, actorHandle: string) => {
  const input = workspaceCollaboratorSearchInputSchema.parse(rawInput);
  const handle = cleanHandle(actorHandle);
  const phrase = input.query.toLowerCase();
  return {
    query: input.query,
    people: Object.values(profilesByName)
      .filter((person, index, people) => people.findIndex((candidate) => candidate.handle === person.handle) === index)
      .filter((person) => person.handle !== handle)
      .filter((person) => `${person.name} ${person.handle}`.toLowerCase().includes(phrase))
      .slice(0, input.limit)
      .map(({ handle: personHandle, name, avatarUrl, role }) => ({ handle: personHandle, name, avatarUrl, role }))
  };
};
