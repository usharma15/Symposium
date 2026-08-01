import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SymposiumApiRequestOptions } from "@/features/api/symposiumApiClient";
import {
  createWorkspaceGateway,
  type WorkspaceAccessTarget
} from "@/features/workspace/workspaceGateway";
import {
  readWorkspaceSnapshot,
  workspaceSnapshotStorageKey,
  writeWorkspaceSnapshot
} from "@/features/workspace/workspaceSnapshotStorage";
import type { InquiryAttachment, InquiryComment } from "@/lib/mockData";
import type {
  WorkspaceDirectGrant,
  WorkspaceDocument,
  WorkspaceNotebook,
  WorkspaceSnapshot
} from "@/lib/workspaceTypes";
import type {
  CreateWorkspaceDocumentInputContract,
  UpdateWorkspaceDocumentInputContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import { reportCheck } from "@/scripts/checkReport";

type RecordedRequest = { path: string; options: SymposiumApiRequestOptions };

const documentValue: VersionedDocumentContract = {
  version: 1,
  nodes: [{ id: "p1", type: "paragraph", content: [{ text: "Workspace body" }], align: "left", indent: 0 }]
};
const createInput: CreateWorkspaceDocumentInputContract = {
  title: "Gateway draft",
  body: "Workspace body",
  document: documentValue,
  kind: "paper",
  publicationTarget: "paper",
  notebookId: null,
  targetId: null,
  proposal: null,
  opportunity: null,
  attachmentIds: []
};
const updateInput = (checkpoint: boolean): UpdateWorkspaceDocumentInputContract => ({
  ...createInput,
  checkpoint,
  expectedRevision: 7
});
const workspaceDocument = {
  id: "note /+?&= Δ",
  revision: 7
} as WorkspaceDocument;
const workspaceNotebook = {
  id: "notebook /+?&= Δ",
  revision: 5
} as WorkspaceNotebook;
const attachment = { id: "attachment-one" } as InquiryAttachment;
const comment = { id: "comment /+?&= Δ", revision: 3 } as InquiryComment & { id: string };
const grant = { revision: 11 } as WorkspaceDirectGrant;
const documentTarget: WorkspaceAccessTarget = { type: "document", id: "document /+?&= Δ" };
const notebookTarget: WorkspaceAccessTarget = { type: "notebook", id: "notebook /+?&= Δ" };

const main = async () => {
  const calls: RecordedRequest[] = [];
  const mutationScopes: string[] = [];
  const request = async <T>(path: string, options: SymposiumApiRequestOptions = {}) => {
    calls.push({ path, options });
    return {} as T;
  };
  const gateway = createWorkspaceGateway(request, (scope) => {
    mutationScopes.push(scope);
    return `test:${scope}:${mutationScopes.length}`;
  });
  const actorHandle = "@Ada Lovelace/Δ";

  await gateway.getSnapshot(actorHandle);
  await gateway.createDocument(actorHandle, createInput);
  await gateway.createDocument(actorHandle, createInput, "retry-stable-id");
  await gateway.updateDocument(actorHandle, workspaceDocument.id, updateInput(false));
  await gateway.updateDocument(actorHandle, workspaceDocument.id, updateInput(true));
  await gateway.deleteDocument(actorHandle, workspaceDocument);
  await gateway.createNotebook(actorHandle, "Research / Δ");
  await gateway.renameNotebook(actorHandle, workspaceNotebook, "Renamed / Δ");
  await gateway.deleteNotebookWithContents(actorHandle, workspaceNotebook);
  await gateway.search(actorHandle, "query /+?&= Δ");
  await gateway.search(actorHandle, "query /+?&= Δ", { kind: "paper", notebookId: workspaceNotebook.id });
  await gateway.publishDocument(actorHandle, workspaceDocument);
  await gateway.publishDocument(actorHandle, workspaceDocument, "thought");
  await gateway.listComments(actorHandle, workspaceDocument.id);
  await gateway.addComment(actorHandle, workspaceDocument.id, {
    body: "Root comment",
    document: documentValue,
    stance: "Comment",
    parentId: null,
    attachments: [attachment]
  });
  await gateway.addComment(actorHandle, workspaceDocument.id, {
    body: "Reply",
    document: documentValue,
    stance: "Question",
    parentId: comment.id,
    attachments: []
  });
  await gateway.updateComment(actorHandle, workspaceDocument.id, comment, "Edited", documentValue, [attachment]);
  await gateway.deleteComment(actorHandle, workspaceDocument.id, comment);
  await gateway.applyCommentAction(actorHandle, workspaceDocument.id, comment.id, "signal", true, { trigger: "click" });
  await gateway.applyCommentAction(actorHandle, workspaceDocument.id, comment.id, "read", undefined, { trigger: "visibility" });
  await gateway.getAccess(actorHandle, documentTarget);
  await gateway.getAccess(actorHandle, notebookTarget);
  await gateway.grantAccess(actorHandle, documentTarget, "@Grace Hopper/Δ", "editor");
  await gateway.grantAccess(actorHandle, notebookTarget, "@Grace Hopper/Δ", "commenter");
  await gateway.updateAccess(actorHandle, documentTarget, "@Grace Hopper/Δ", grant, "publisher");
  await gateway.revokeAccess(actorHandle, notebookTarget, "@Grace Hopper/Δ", grant);
  await gateway.searchCollaborators(actorHandle, "Grace / Δ");

  assert.equal(calls.length, 27);
  assert.deepEqual(calls.map(({ path, options }) => [path, options.method ?? "GET"]), [
    ["/api/workspace?actorHandle=%40Ada%20Lovelace%2F%CE%94", "GET"],
    ["/api/workspace/documents", "POST"],
    ["/api/workspace/documents", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94", "PATCH"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94", "PATCH"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94", "DELETE"],
    ["/api/workspace/notebooks", "POST"],
    ["/api/workspace/notebooks/notebook%20%2F%2B%3F%26%3D%20%CE%94", "PATCH"],
    ["/api/workspace/notebooks/notebook%20%2F%2B%3F%26%3D%20%CE%94/with-contents", "DELETE"],
    ["/api/workspace/search?query=query+%2F%2B%3F%26%3D+%CE%94&actorHandle=%40Ada+Lovelace%2F%CE%94&limit=24", "GET"],
    ["/api/workspace/search?query=query+%2F%2B%3F%26%3D+%CE%94&actorHandle=%40Ada+Lovelace%2F%CE%94&limit=24&kind=paper&notebookId=notebook+%2F%2B%3F%26%3D+%CE%94", "GET"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/publish", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/publish", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments?actorHandle=%40Ada%20Lovelace%2F%CE%94", "GET"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments/comment%20%2F%2B%3F%26%3D%20%CE%94", "PATCH"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments/comment%20%2F%2B%3F%26%3D%20%CE%94", "DELETE"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments/comment%20%2F%2B%3F%26%3D%20%CE%94/actions", "POST"],
    ["/api/workspace/documents/note%20%2F%2B%3F%26%3D%20%CE%94/comments/comment%20%2F%2B%3F%26%3D%20%CE%94/actions", "POST"],
    ["/api/workspace/documents/document%20%2F%2B%3F%26%3D%20%CE%94/access?actorHandle=%40Ada%20Lovelace%2F%CE%94", "GET"],
    ["/api/workspace/notebooks/notebook%20%2F%2B%3F%26%3D%20%CE%94/access?actorHandle=%40Ada%20Lovelace%2F%CE%94", "GET"],
    ["/api/workspace/documents/document%20%2F%2B%3F%26%3D%20%CE%94/access", "POST"],
    ["/api/workspace/notebooks/notebook%20%2F%2B%3F%26%3D%20%CE%94/access", "POST"],
    ["/api/workspace/documents/document%20%2F%2B%3F%26%3D%20%CE%94/access/%40Grace%20Hopper%2F%CE%94", "PATCH"],
    ["/api/workspace/notebooks/notebook%20%2F%2B%3F%26%3D%20%CE%94/access/%40Grace%20Hopper%2F%CE%94", "DELETE"],
    ["/api/workspace/collaborators?query=Grace+%2F+%CE%94&actorHandle=%40Ada+Lovelace%2F%CE%94&limit=12", "GET"]
  ]);

  for (const index of [0, 9, 10, 13, 20, 21, 26]) {
    assert.deepEqual(calls[index]?.options, { cache: "no-store" });
  }
  assert.deepEqual(calls[1]?.options, {
    method: "POST",
    idempotencyKey: "test:workspace-document-create:1",
    body: { ...createInput, actorHandle }
  });
  assert.equal(calls[2]?.options.idempotencyKey, "retry-stable-id");
  assert.equal(mutationScopes.includes("workspace-document-create"), true);
  assert.equal(mutationScopes.filter((scope) => scope === "workspace-document-create").length, 1);
  assert.equal(calls[3]?.options.idempotencyKey, "test:workspace-document-autosave:2");
  assert.equal(calls[4]?.options.idempotencyKey, "test:workspace-document-checkpoint:3");
  assert.deepEqual(calls[5]?.options.body, { actorHandle, expectedRevision: 7 });
  assert.deepEqual(calls[7]?.options.body, { actorHandle, name: "Renamed / Δ", expectedRevision: 5 });
  assert.deepEqual(calls[8]?.options.body, { actorHandle, expectedRevision: 5 });
  assert.deepEqual(calls[11]?.options.body, { actorHandle, expectedRevision: 7, publicationTarget: undefined });
  assert.deepEqual(calls[12]?.options.body, { actorHandle, expectedRevision: 7, publicationTarget: "thought" });
  assert.deepEqual(calls[14]?.options.body, {
    actorHandle,
    body: "Root comment",
    document: documentValue,
    stance: "Comment",
    parentId: null,
    attachmentIds: ["attachment-one"]
  });
  assert.equal(calls[14]?.options.idempotencyKey?.includes("workspace-comment-create"), true);
  assert.equal(calls[15]?.options.idempotencyKey?.includes("workspace-comment-reply"), true);
  assert.deepEqual(calls[16]?.options.body, {
    actorHandle,
    body: "Edited",
    document: documentValue,
    expectedRevision: 3,
    attachmentIds: ["attachment-one"]
  });
  assert.deepEqual(calls[18]?.options.body, {
    actorHandle,
    action: "signal",
    active: true,
    trigger: "click",
    surface: "workspace"
  });
  assert.deepEqual(calls[19]?.options.body, {
    actorHandle,
    action: "read",
    active: undefined,
    trigger: "visibility",
    surface: "workspace"
  });
  assert.deepEqual(calls[22]?.options.body, { actorHandle, granteeHandle: "@Grace Hopper/Δ", role: "editor" });
  assert.deepEqual(calls[24]?.options.body, { actorHandle, role: "publisher", expectedRevision: 11 });
  assert.deepEqual(calls[25]?.options.body, { actorHandle, expectedRevision: 11 });

  const responseIdentity = { workspace: null, notebooks: [], documents: [] };
  const passthrough = createWorkspaceGateway(async <T>() => responseIdentity as T);
  assert.strictEqual(await passthrough.getSnapshot(actorHandle), responseIdentity);
  for (const operation of [
    (failed: ReturnType<typeof createWorkspaceGateway>) => failed.getSnapshot(actorHandle),
    (failed: ReturnType<typeof createWorkspaceGateway>) => failed.createDocument(actorHandle, createInput),
    (failed: ReturnType<typeof createWorkspaceGateway>) => failed.addComment(actorHandle, workspaceDocument.id, {
      body: "failure",
      document: documentValue,
      stance: "Comment",
      parentId: null,
      attachments: []
    }),
    (failed: ReturnType<typeof createWorkspaceGateway>) => failed.revokeAccess(actorHandle, notebookTarget, "@grace", grant)
  ]) {
    const failure = new Error("exact gateway failure");
    const failed = createWorkspaceGateway(async () => { throw failure; });
    await assert.rejects(operation(failed), (error) => error === failure);
  }

  const snapshot: WorkspaceSnapshot = {
    workspace: { id: "workspace-one", name: "Private Office", ownerHandle: actorHandle },
    notebooks: [],
    documents: []
  };
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); }
  };
  assert.equal(workspaceSnapshotStorageKey(actorHandle), "symposium-workspace-v1:@Ada Lovelace/Δ");
  assert.equal(writeWorkspaceSnapshot(actorHandle, snapshot, storage), true);
  assert.deepEqual(readWorkspaceSnapshot(actorHandle, storage), snapshot);
  assert.equal(readWorkspaceSnapshot("@other", storage), null, "private caches must remain actor-scoped");
  stored.set(workspaceSnapshotStorageKey(actorHandle), "not-json");
  assert.equal(readWorkspaceSnapshot(actorHandle, storage), null);
  stored.set(workspaceSnapshotStorageKey(actorHandle), JSON.stringify({ documents: {}, notebooks: [] }));
  assert.equal(readWorkspaceSnapshot(actorHandle, storage), null);
  assert.equal(readWorkspaceSnapshot(actorHandle, { getItem: () => { throw new Error("denied"); } }), null);
  assert.equal(writeWorkspaceSnapshot(actorHandle, snapshot, { setItem: () => { throw new Error("full"); } }), false);

  const root = process.cwd();
  const [documentsHook, commentsHook, accessHook, composerDraft, gatewaySource, storageSource] = await Promise.all([
    readFile(path.join(root, "features/workspace/useWorkspaceDocuments.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/useWorkspaceComments.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/useWorkspaceAccess.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/savePostDraftToWorkspace.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/workspaceGateway.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/workspaceSnapshotStorage.ts"), "utf8")
  ]);
  for (const source of [documentsHook, commentsHook, accessHook, composerDraft]) {
    assert.doesNotMatch(source, /symposiumApi\s*[,}]/);
    assert.doesNotMatch(source, /["`]\/api\/workspace/);
  }
  assert.match(gatewaySource, /createWorkspaceGateway/);
  assert.match(documentsHook, /workspaceGateway/);
  assert.match(commentsHook, /workspaceGateway/);
  assert.match(accessHook, /workspaceGateway/);
  assert.match(composerDraft, /workspaceGateway\.createDocument/);
  assert.doesNotMatch(documentsHook, /localStorage/);
  assert.match(storageSource, /symposium-workspace-v1:/);

  reportCheck([
    "nineteen-operation Workspace browser HTTP authority",
    "twenty-seven exact document, notebook, publication, discussion, access, and search request shapes",
    "actor, resource, revision, attachment, cursor-free search, and publication-target preservation",
    "autosave, checkpoint, retry-stable composer, comment, and collaboration idempotency scopes",
    "resolved-value identity and exact transport-error propagation",
    "actor-scoped snapshot cache with malformed, unavailable, and quota-failure behavior",
    "permanent guards against raw Workspace routes, API calls, and cache access in consumers"
  ]);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
