import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceCommentInputSchema,
  deleteWorkspaceCommentInputSchema,
  updateWorkspaceCommentInputSchema,
  workspaceCommentActionInputSchema
} from "@/packages/contracts/src";
import {
  appendCommentToTree,
  commentActionActive,
  commentMetricsFallback,
  findCommentInTree,
  mapCommentTree,
  mutateCommentForActor
} from "@/lib/symposiumCore";
import type { InquiryComment } from "@/lib/mockData";
import {
  deleteLocalOwnerAttachments,
  localAttachmentsForOwner,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import { getLocalWorkspace, LocalWorkspaceStoreError } from "@/lib/localWorkspaceStore";

type StoredComment = Omit<InquiryComment, "attachments" | "replies"> & { replies: StoredComment[] };
type LocalWorkspaceCommentStore = { version: 1; notes: Record<string, StoredComment[]> };

const storeRoot = path.join(process.cwd(), ".data", "workspace-comments");
const storePath = path.join(storeRoot, "index.json");
let storeQueue: Promise<void> = Promise.resolve();

const withStoreLock = async <T>(operation: () => Promise<T>) => {
  const run = storeQueue.then(operation, operation);
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
};

const loadStore = async (): Promise<LocalWorkspaceCommentStore> => {
  await mkdir(storeRoot, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<LocalWorkspaceCommentStore>;
    return { version: 1, notes: parsed.notes ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, notes: {} };
    throw error;
  }
};

const saveStore = async (store: LocalWorkspaceCommentStore) => {
  await mkdir(storeRoot, { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, storePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};

const assertDocumentAccess = async (noteId: string, actorHandle: string, comment = false) => {
  const workspace = await getLocalWorkspace(actorHandle);
  const document = workspace.documents.find((candidate) => candidate.id === noteId);
  if (!document) throw new LocalWorkspaceStoreError("Draft not found.", 404);
  if (comment && !document.access.canComment) {
    throw new LocalWorkspaceStoreError("This draft cannot be commented on with your current access.", 403);
  }
};

const hydrateComment = async (comment: StoredComment, actorHandle: string): Promise<InquiryComment> => ({
  ...comment,
  attachments: comment.id ? await localAttachmentsForOwner("note_comment", comment.id, actorHandle) : [],
  replies: await Promise.all(comment.replies.map((reply) => hydrateComment(reply, actorHandle)))
});

const hydrateComments = (comments: StoredComment[], actorHandle: string) =>
  Promise.all(comments.map((comment) => hydrateComment(comment, actorHandle)));

const activeCommentCount = (comments: StoredComment[]): number => comments.reduce(
  (total, comment) => total + (comment.deletedAt ? 0 : 1) + activeCommentCount(comment.replies),
  0
);

export const getLocalWorkspaceCommentCount = async (noteId: string) => withStoreLock(async () => {
  const store = await loadStore();
  return activeCommentCount(store.notes[noteId] ?? []);
});

export const getLocalWorkspaceComments = async (noteId: string, actorHandle: string) => {
  await assertDocumentAccess(noteId, actorHandle);
  return withStoreLock(async () => {
    const store = await loadStore();
    return { comments: await hydrateComments(store.notes[noteId] ?? [], actorHandle) };
  });
};

export const createLocalWorkspaceComment = async (noteId: string, rawInput: unknown, actorHandle: string) => {
  const input = createWorkspaceCommentInputSchema.parse(rawInput);
  await assertDocumentAccess(noteId, actorHandle, true);
  return withStoreLock(async () => {
    const store = await loadStore();
    const current = store.notes[noteId] ?? [];
    if (input.parentId && !findCommentInTree(current, input.parentId)) {
      throw new LocalWorkspaceStoreError("Reply target is no longer available.", 404);
    }
    const now = new Date().toISOString();
    const comment: StoredComment = {
      id: randomUUID(),
      parentId: input.parentId ?? null,
      author: actorHandle.replace(/^@/, ""),
      authorHandle: actorHandle,
      stance: input.stance,
      body: input.body,
      document: input.document,
      revision: 1,
      createdAt: now,
      metrics: { ...commentMetricsFallback },
      savedBy: [],
      signaledBy: [],
      forkedBy: [],
      replies: []
    };
    await replaceLocalOwnerAttachments({
      actorHandle,
      attachmentIds: input.attachmentIds,
      ownerId: comment.id!,
      ownerType: "note_comment"
    });
    const appended = appendCommentToTree(current, comment);
    if (!appended.inserted) throw new LocalWorkspaceStoreError("Reply target is no longer available.", 404);
    store.notes[noteId] = appended.comments;
    await saveStore(store);
    return {
      comments: await hydrateComments(store.notes[noteId], actorHandle),
      comment: await hydrateComment(comment, actorHandle)
    };
  });
};

export const updateLocalWorkspaceComment = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = updateWorkspaceCommentInputSchema.parse(rawInput);
  await assertDocumentAccess(noteId, actorHandle);
  return withStoreLock(async () => {
    const store = await loadStore();
    const current = store.notes[noteId] ?? [];
    const existing = findCommentInTree(current, commentId);
    if (!existing || existing.authorHandle !== actorHandle) throw new LocalWorkspaceStoreError("Comment not found.", 404);
    if ((existing.revision ?? 1) !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("This comment changed after it was opened. Refresh before overwriting it.", 409);
    }
    await replaceLocalOwnerAttachments({
      actorHandle,
      attachmentIds: input.attachmentIds,
      ownerId: commentId,
      ownerType: "note_comment"
    });
    const mapped = mapCommentTree(current, commentId, (comment) => ({
      ...comment,
      body: input.body,
      document: input.document,
      editedAt: new Date().toISOString(),
      revision: (comment.revision ?? 1) + 1
    }));
    store.notes[noteId] = mapped.comments;
    await saveStore(store);
    return { comments: await hydrateComments(mapped.comments, actorHandle), comment: mapped.updated ? await hydrateComment(mapped.updated, actorHandle) : undefined };
  });
};

export const deleteLocalWorkspaceComment = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = deleteWorkspaceCommentInputSchema.parse(rawInput);
  await assertDocumentAccess(noteId, actorHandle);
  return withStoreLock(async () => {
    const store = await loadStore();
    const current = store.notes[noteId] ?? [];
    const existing = findCommentInTree(current, commentId);
    if (!existing || existing.authorHandle !== actorHandle || (existing.revision ?? 1) !== input.expectedRevision) {
      throw new LocalWorkspaceStoreError("This comment changed or is no longer available.", 409);
    }
    const mapped = mapCommentTree(current, commentId, (comment) => ({
      ...comment,
      deletedAt: new Date().toISOString(),
      revision: (comment.revision ?? 1) + 1
    }));
    await deleteLocalOwnerAttachments("note_comment", commentId);
    store.notes[noteId] = mapped.comments;
    await saveStore(store);
    return { comments: await hydrateComments(mapped.comments, actorHandle), comment: mapped.updated ? await hydrateComment(mapped.updated, actorHandle) : undefined };
  });
};

export const applyLocalWorkspaceCommentAction = async (
  noteId: string,
  commentId: string,
  rawInput: unknown,
  actorHandle: string
) => {
  const input = workspaceCommentActionInputSchema.parse(rawInput);
  await assertDocumentAccess(noteId, actorHandle);
  return withStoreLock(async () => {
    const store = await loadStore();
    const current = store.notes[noteId] ?? [];
    const existing = findCommentInTree(current, commentId);
    if (!existing || existing.deletedAt) throw new LocalWorkspaceStoreError("Comment not found.", 404);
    const desiredActive = input.action === "read" ? undefined : input.active ?? !commentActionActive(existing, input.action, actorHandle);
    const mapped = mapCommentTree(current, commentId, (comment) => ({
      ...mutateCommentForActor(comment, input.action, actorHandle, desiredActive),
      revision: (comment.revision ?? 1) + 1
    }));
    store.notes[noteId] = mapped.comments;
    await saveStore(store);
    return { comments: await hydrateComments(mapped.comments, actorHandle), comment: mapped.updated ? await hydrateComment(mapped.updated, actorHandle) : undefined, active: desiredActive };
  });
};

export const deleteLocalWorkspaceCommentsForDocument = async (noteId: string) =>
  withStoreLock(async () => {
    const store = await loadStore();
    const comments = store.notes[noteId] ?? [];
    const removeAttachments = async (nodes: StoredComment[]) => {
      for (const comment of nodes) {
        if (comment.id) await deleteLocalOwnerAttachments("note_comment", comment.id);
        await removeAttachments(comment.replies);
      }
    };
    await removeAttachments(comments);
    delete store.notes[noteId];
    await saveStore(store);
  });
