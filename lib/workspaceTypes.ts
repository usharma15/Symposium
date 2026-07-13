import type { InquiryAttachment, InquiryItem, ResearchProfile } from "@/lib/mockData";
import type {
  VersionedDocumentContract,
  WorkspaceAccessRoleContract,
  WorkspaceDocumentKindContract,
  WorkspaceLifecycleContract,
  WorkspacePublicationTargetContract
} from "@/packages/contracts/src";

export type WorkspaceDocumentAccess = {
  role: WorkspaceAccessRoleContract;
  inheritedFromNotebook: boolean;
  canComment: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canShare: boolean;
  canDelete: boolean;
};

export type WorkspaceNotebook = {
  id: string;
  workspaceId: string;
  ownerHandle: string;
  name: string;
  revision: number;
  role: WorkspaceAccessRoleContract;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDocument = {
  id: string;
  workspaceId: string;
  notebookId: string | null;
  notebookName: string | null;
  ownerHandle: string;
  ownerName: string;
  kind: WorkspaceDocumentKindContract;
  publicationTarget: WorkspacePublicationTargetContract;
  targetId: string | null;
  title: string;
  body: string;
  document: VersionedDocumentContract;
  lifecycle: WorkspaceLifecycleContract;
  revision: number;
  publishedPostId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  attachments: InquiryAttachment[];
  access: WorkspaceDocumentAccess;
};

export type WorkspaceSnapshot = {
  workspace: { id: string; name: string; ownerHandle: string } | null;
  notebooks: WorkspaceNotebook[];
  documents: WorkspaceDocument[];
};

export type WorkspaceSearchResponse = {
  query: string;
  documents: WorkspaceDocument[];
  notebooks: Array<Pick<WorkspaceNotebook, "id" | "name" | "ownerHandle" | "updatedAt">>;
  collaborators: Array<Pick<ResearchProfile, "handle" | "name" | "avatarUrl">>;
};

export type WorkspacePublicationResponse = {
  item: InquiryItem;
  comment?: InquiryItem["comments"][number];
  publication: {
    noteId: string | null;
    revision?: number;
    checkpointId?: string;
    target?: "paper" | "thought" | "comment" | "reply";
    postId: string;
    commentId?: string | null;
    visibility: "public";
  };
};
