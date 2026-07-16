import type { UpdateWorkspaceDocumentInputContract } from "@/packages/contracts/src";
import type { WorkspaceDocument, WorkspaceSnapshot } from "@/lib/workspaceTypes";

export const sortWorkspaceDocuments = (documents: WorkspaceDocument[]) =>
  [...documents].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

export const workspaceDocumentsInNotebook = (documents: WorkspaceDocument[], notebookId: string) =>
  sortWorkspaceDocuments(documents.filter((document) => document.notebookId === notebookId));

export const normalizeWorkspaceSnapshot = (snapshot: WorkspaceSnapshot): WorkspaceSnapshot => {
  const documents = snapshot.documents.filter((document) => document.lifecycle === "draft");
  const documentCounts = new Map<string, number>();
  for (const document of documents) {
    if (document.notebookId) {
      documentCounts.set(document.notebookId, (documentCounts.get(document.notebookId) ?? 0) + 1);
    }
  }
  return {
    ...snapshot,
    notebooks: snapshot.notebooks
      .map((notebook) => ({ ...notebook, documentCount: documentCounts.get(notebook.id) ?? 0 }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    documents: sortWorkspaceDocuments(documents)
  };
};

export const workspaceDocumentMetadataUpdate = (
  document: WorkspaceDocument,
  changes: { title?: string; notebookId?: string | null }
): UpdateWorkspaceDocumentInputContract => ({
  title: changes.title ?? document.title,
  body: document.body,
  document: document.document,
  kind: document.kind,
  publicationTarget: document.publicationTarget,
  proposal: document.proposal,
  opportunity: document.opportunity,
  notebookId: changes.notebookId === undefined ? document.notebookId : changes.notebookId,
  targetId: document.targetId,
  attachmentIds: document.attachments.map((attachment) => attachment.id),
  expectedRevision: document.revision,
  checkpoint: true
});

export const runAfterWorkspaceSave = async (
  prepareCurrentDocument: () => Promise<boolean>,
  action: () => void | Promise<void>
) => {
  if (!await prepareCurrentDocument()) return false;
  await action();
  return true;
};
