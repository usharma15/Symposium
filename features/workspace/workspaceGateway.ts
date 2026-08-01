import {
  createClientMutationId,
  symposiumApi,
  type SymposiumApiRequestOptions
} from "@/features/api/symposiumApiClient";
import type { ViewActionOptions } from "@/features/actions/actionTypes";
import type { InquiryAttachment, InquiryComment } from "@/lib/mockData";
import type {
  WorkspaceAccessOverview,
  WorkspaceCollaboratorSearchResponse,
  WorkspaceDirectGrant,
  WorkspaceDocument,
  WorkspaceNotebook,
  WorkspacePublicationResponse,
  WorkspaceSearchResponse,
  WorkspaceSnapshot
} from "@/lib/workspaceTypes";
import type {
  CreateWorkspaceDocumentInputContract,
  UpdateWorkspaceDocumentInputContract,
  VersionedDocumentContract,
  WorkspaceAccessResourceContract,
  WorkspaceGrantRoleContract
} from "@/packages/contracts/src";

type Request = <T>(path: string, options?: SymposiumApiRequestOptions) => Promise<T>;
type MutationId = (scope: string) => string;

export type WorkspaceAccessTarget = {
  type: WorkspaceAccessResourceContract;
  id: string;
};

export type WorkspaceCommentResponse = {
  comments: InquiryComment[];
  comment?: InquiryComment;
  active?: boolean;
};

export type WorkspaceNotebookDeletionResponse = {
  notebookId: string;
  deletedDocumentIds: string[];
  cleanupPending?: boolean;
};

const accessPath = (target: WorkspaceAccessTarget) => target.type === "document"
  ? `/api/workspace/documents/${encodeURIComponent(target.id)}/access`
  : `/api/workspace/notebooks/${encodeURIComponent(target.id)}/access`;

/**
 * The single browser-side HTTP authority for Workspace documents, notebooks,
 * discussion, publication, search, and collaboration access. Hooks retain
 * optimistic state, request epochs, autosave, live/cross-tab reconciliation,
 * and presentation without constructing routes or request envelopes.
 */
export const createWorkspaceGateway = (
  request: Request,
  mutationId: MutationId = createClientMutationId
) => ({
  getSnapshot: (actorHandle: string) => request<WorkspaceSnapshot>(
    `/api/workspace?actorHandle=${encodeURIComponent(actorHandle)}`,
    { cache: "no-store" }
  ),

  createDocument: (
    actorHandle: string,
    input: CreateWorkspaceDocumentInputContract,
    idempotencyKey = mutationId("workspace-document-create")
  ) => request<{ document: WorkspaceDocument }>("/api/workspace/documents", {
    method: "POST",
    idempotencyKey,
    body: { ...input, actorHandle }
  }),

  updateDocument: (
    actorHandle: string,
    noteId: string,
    input: UpdateWorkspaceDocumentInputContract
  ) => request<{ document: WorkspaceDocument }>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}`,
    {
      method: "PATCH",
      idempotencyKey: mutationId(input.checkpoint
        ? "workspace-document-checkpoint"
        : "workspace-document-autosave"),
      body: { ...input, actorHandle }
    }
  ),

  deleteDocument: (actorHandle: string, document: Pick<WorkspaceDocument, "id" | "revision">) =>
    request<void>(`/api/workspace/documents/${encodeURIComponent(document.id)}`, {
      method: "DELETE",
      idempotencyKey: mutationId("workspace-document-delete"),
      body: { actorHandle, expectedRevision: document.revision }
    }),

  createNotebook: (actorHandle: string, name: string) => request<{ notebook: WorkspaceNotebook }>(
    "/api/workspace/notebooks",
    {
      method: "POST",
      idempotencyKey: mutationId("workspace-notebook-create"),
      body: { actorHandle, name }
    }
  ),

  renameNotebook: (actorHandle: string, notebook: WorkspaceNotebook, name: string) =>
    request<{ notebook: WorkspaceNotebook }>(
      `/api/workspace/notebooks/${encodeURIComponent(notebook.id)}`,
      {
        method: "PATCH",
        idempotencyKey: mutationId("workspace-notebook-update"),
        body: { actorHandle, name, expectedRevision: notebook.revision }
      }
    ),

  deleteNotebookWithContents: (actorHandle: string, notebook: WorkspaceNotebook) =>
    request<WorkspaceNotebookDeletionResponse>(
      `/api/workspace/notebooks/${encodeURIComponent(notebook.id)}/with-contents`,
      {
        method: "DELETE",
        idempotencyKey: mutationId("workspace-notebook-delete-with-contents"),
        body: { actorHandle, expectedRevision: notebook.revision }
      }
    ),

  search: (
    actorHandle: string,
    query: string,
    options?: { kind?: string; notebookId?: string | null }
  ) => {
    const parameters = new URLSearchParams({ query, actorHandle, limit: "24" });
    if (options?.kind) parameters.set("kind", options.kind);
    if (options?.notebookId) parameters.set("notebookId", options.notebookId);
    return request<WorkspaceSearchResponse>(
      `/api/workspace/search?${parameters.toString()}`,
      { cache: "no-store" }
    );
  },

  publishDocument: (
    actorHandle: string,
    document: Pick<WorkspaceDocument, "id" | "revision">,
    publicationTarget?: "paper" | "thought" | "proposal" | "opportunity"
  ) => request<WorkspacePublicationResponse>(
    `/api/workspace/documents/${encodeURIComponent(document.id)}/publish`,
    {
      method: "POST",
      idempotencyKey: mutationId("workspace-document-publish"),
      body: { actorHandle, expectedRevision: document.revision, publicationTarget }
    }
  ),

  listComments: (actorHandle: string, noteId: string) => request<WorkspaceCommentResponse>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}/comments?actorHandle=${encodeURIComponent(actorHandle)}`,
    { cache: "no-store" }
  ),

  addComment: (
    actorHandle: string,
    noteId: string,
    input: {
      body: string;
      document: VersionedDocumentContract;
      stance: string;
      parentId: string | null;
      attachments: InquiryAttachment[];
    }
  ) => request<WorkspaceCommentResponse>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}/comments`,
    {
      method: "POST",
      idempotencyKey: mutationId(input.parentId
        ? "workspace-comment-reply"
        : "workspace-comment-create"),
      body: {
        actorHandle,
        body: input.body,
        document: input.document,
        stance: input.stance,
        parentId: input.parentId,
        attachmentIds: input.attachments.map((attachment) => attachment.id)
      }
    }
  ),

  updateComment: (
    actorHandle: string,
    noteId: string,
    comment: InquiryComment & { id: string },
    body: string,
    document: VersionedDocumentContract,
    attachments: InquiryAttachment[]
  ) => request<WorkspaceCommentResponse>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(comment.id)}`,
    {
      method: "PATCH",
      idempotencyKey: mutationId("workspace-comment-update"),
      body: {
        actorHandle,
        body,
        document,
        expectedRevision: comment.revision ?? 1,
        attachmentIds: attachments.map((attachment) => attachment.id)
      }
    }
  ),

  deleteComment: (
    actorHandle: string,
    noteId: string,
    comment: Pick<InquiryComment, "revision"> & { id: string }
  ) => request<WorkspaceCommentResponse>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(comment.id)}`,
    {
      method: "DELETE",
      idempotencyKey: mutationId("workspace-comment-delete"),
      body: { actorHandle, expectedRevision: comment.revision ?? 1 }
    }
  ),

  applyCommentAction: (
    actorHandle: string,
    noteId: string,
    commentId: string,
    action: "signal" | "save" | "read",
    active: boolean | undefined,
    options?: ViewActionOptions
  ) => request<WorkspaceCommentResponse>(
    `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(commentId)}/actions`,
    {
      method: "POST",
      idempotencyKey: mutationId(`workspace-comment-${action}`),
      body: { actorHandle, action, active, trigger: options?.trigger, surface: "workspace" }
    }
  ),

  getAccess: (actorHandle: string, target: WorkspaceAccessTarget) =>
    request<WorkspaceAccessOverview>(
      `${accessPath(target)}?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    ),

  grantAccess: (
    actorHandle: string,
    target: WorkspaceAccessTarget,
    granteeHandle: string,
    role: WorkspaceGrantRoleContract
  ) => request<{ access: WorkspaceAccessOverview }>(accessPath(target), {
    method: "POST",
    idempotencyKey: mutationId(`workspace-${target.type}-access-grant`),
    body: { actorHandle, granteeHandle, role }
  }),

  updateAccess: (
    actorHandle: string,
    target: WorkspaceAccessTarget,
    granteeHandle: string,
    grant: WorkspaceDirectGrant,
    role: WorkspaceGrantRoleContract
  ) => request<{ access: WorkspaceAccessOverview }>(
    `${accessPath(target)}/${encodeURIComponent(granteeHandle)}`,
    {
      method: "PATCH",
      idempotencyKey: mutationId(`workspace-${target.type}-access-update`),
      body: { actorHandle, role, expectedRevision: grant.revision }
    }
  ),

  revokeAccess: (
    actorHandle: string,
    target: WorkspaceAccessTarget,
    granteeHandle: string,
    grant: WorkspaceDirectGrant
  ) => request<{ access: WorkspaceAccessOverview | null }>(
    `${accessPath(target)}/${encodeURIComponent(granteeHandle)}`,
    {
      method: "DELETE",
      idempotencyKey: mutationId(`workspace-${target.type}-access-revoke`),
      body: { actorHandle, expectedRevision: grant.revision }
    }
  ),

  searchCollaborators: (actorHandle: string, query: string) => {
    const parameters = new URLSearchParams({ query, actorHandle, limit: "12" });
    return request<WorkspaceCollaboratorSearchResponse>(
      `/api/workspace/collaborators?${parameters.toString()}`,
      { cache: "no-store" }
    );
  }
});

export const workspaceGateway = createWorkspaceGateway(symposiumApi.request);
