import type { InquiryAttachment, InquiryItem, ResearchProfile } from "@/lib/mockData";
import type {
  VersionedDocumentContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  WorkspaceAccessRoleContract,
  WorkspaceAccessResourceContract,
  WorkspaceDocumentKindContract,
  WorkspaceGrantRoleContract,
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
  collaboratorCount: number;
  canShare: boolean;
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
  proposal: PatronageProposalInputContract | null;
  opportunity: OpportunityPostInputContract | null;
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
  collaboratorCount: number;
  commentCount: number;
  access: WorkspaceDocumentAccess;
};

export type WorkspaceDirectGrant = {
  id: string;
  role: WorkspaceGrantRoleContract;
  revision: number;
  grantedByHandle: string;
  grantedByName: string;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canRemove: boolean;
};

export type WorkspaceInheritedGrant = {
  role: WorkspaceGrantRoleContract;
  notebookId: string;
  notebookName: string;
  grantedByHandle: string;
};

export type WorkspaceAccessCollaborator = {
  handle: string;
  name: string;
  avatarUrl?: string;
  effectiveRole: WorkspaceGrantRoleContract;
  directGrant: WorkspaceDirectGrant | null;
  inheritedGrant: WorkspaceInheritedGrant | null;
};

export type WorkspaceAccessOverview = {
  resource: {
    type: WorkspaceAccessResourceContract;
    id: string;
    name: string;
    kind?: WorkspaceDocumentKindContract;
    notebookId?: string | null;
    notebookName?: string | null;
  };
  owner: Pick<ResearchProfile, "handle" | "name" | "avatarUrl">;
  actor: {
    role: WorkspaceAccessRoleContract;
    canInvite: boolean;
    maxGrantRole: WorkspaceGrantRoleContract | null;
  };
  collaborators: WorkspaceAccessCollaborator[];
};

export type WorkspaceCollaboratorSearchResponse = {
  query: string;
  people: Array<Pick<ResearchProfile, "handle" | "name" | "avatarUrl" | "role">>;
};

export type WorkspaceSnapshot = {
  workspace: { id: string; name: string; ownerHandle: string } | null;
  notebooks: WorkspaceNotebook[];
  documents: WorkspaceDocument[];
};

export type WorkspaceScribble = {
  id: string;
  workspaceId: string;
  ownerHandle: string;
  body: string;
  document: VersionedDocumentContract;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ScribbleNotebook = Pick<
  WorkspaceNotebook,
  "id" | "name" | "revision" | "collaboratorCount" | "createdAt" | "updatedAt"
>;

export type ScribbleSnapshot = {
  scribble: WorkspaceScribble;
  notebooks: ScribbleNotebook[];
};

export type FiledScribble = {
  id: string;
  title: string;
  revision: number;
  notebookId: string | null;
  notebookName: string | null;
  createdAt: string;
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
    target?: "paper" | "thought" | "proposal" | "comment" | "reply";
    postId: string;
    commentId?: string | null;
    visibility: "public";
  };
};
