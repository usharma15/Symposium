import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceGrantInputSchema,
  deleteWorkspaceGrantInputSchema,
  updateWorkspaceGrantInputSchema,
  workspaceGrantCeiling,
  workspaceRoleWithinCeiling
} from "@/packages/contracts/src";
import { rewritePublishedAttachmentReferences } from "@/apps/api/src/services/workspaceAttachmentPublishing";

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), "utf8");

const main = async () => {
  assert.equal(workspaceGrantCeiling("owner", "paper"), "publisher");
  assert.equal(workspaceGrantCeiling("owner", "thought"), "commenter");
  assert.equal(workspaceGrantCeiling("editor", "note"), "editor");
  assert.equal(workspaceGrantCeiling("publisher"), "publisher");
  assert.equal(workspaceGrantCeiling("commenter", "paper"), null);
  assert.equal(workspaceRoleWithinCeiling("editor", "publisher"), true);
  assert.equal(workspaceRoleWithinCeiling("publisher", "editor"), false);
  assert.equal(createWorkspaceGrantInputSchema.safeParse({ granteeHandle: "@collaborator", role: "commenter" }).success, true);
  assert.equal(updateWorkspaceGrantInputSchema.safeParse({ role: "editor", expectedRevision: 3 }).success, true);
  assert.equal(updateWorkspaceGrantInputSchema.safeParse({ role: "editor" }).success, false);
  assert.equal(deleteWorkspaceGrantInputSchema.safeParse({ expectedRevision: 3 }).success, true);

  const rewritten = rewritePublishedAttachmentReferences({
    version: 1,
    nodes: [
      { id: "p1", type: "paragraph", content: [{ text: "Private source" }], align: "left", indent: 0 },
      { id: "a1", type: "attachment", attachmentId: "private-a", placement: "inline" },
      { id: "a2", type: "attachment", attachmentId: "private-b", placement: "inline" }
    ]
  }, new Map([["private-a", "public-a"], ["private-b", "public-b"]]));
  assert.equal(rewritten.nodes[1]?.type === "attachment" && rewritten.nodes[1].attachmentId, "public-a");
  assert.equal(rewritten.nodes[2]?.type === "attachment" && rewritten.nodes[2].attachmentId, "public-b");

  const [
    migration,
    schema,
    accessRepository,
    documentRepository,
    workspaceRoutes,
    localStore,
    localComments,
    accessHook,
    commentsHook,
    workspaceDocumentsHook,
    sharingDialog,
    workspaceView,
    navigatorDocument,
    documentDetail,
    documentCard,
    publication,
    attachmentPublishing,
    documentAccessRoute,
    notebookAccessRoute,
    collaboratorRoute,
    styles,
    architecture
  ] = await Promise.all([
    source("apps/api/src/db/migrate.ts"),
    source("apps/api/src/db/schema.ts"),
    source("apps/api/src/repository/workspaceAccess.ts"),
    source("apps/api/src/repository/workspaceDocuments.ts"),
    source("apps/api/src/routes/workspaceRoutes.ts"),
    source("lib/localWorkspaceStore.ts"),
    source("lib/localWorkspaceCommentStore.ts"),
    source("features/workspace/useWorkspaceAccess.ts"),
    source("features/workspace/useWorkspaceComments.ts"),
    source("features/workspace/useWorkspaceDocuments.ts"),
    source("features/workspace/WorkspaceSharingDialog.tsx"),
    source("features/workspace/WorkspaceView.tsx"),
    source("features/workspace/WorkspaceNavigatorDocument.tsx"),
    source("features/workspace/WorkspaceDocumentDetail.tsx"),
    source("features/workspace/WorkspaceDocumentCard.tsx"),
    source("apps/api/src/services/notePublishing.ts"),
    source("apps/api/src/services/workspaceAttachmentPublishing.ts"),
    source("app/api/workspace/documents/[noteId]/access/route.ts"),
    source("app/api/workspace/notebooks/[notebookId]/access/route.ts"),
    source("app/api/workspace/collaborators/route.ts"),
    source("styles/89-workspace-sharing.css"),
    source("docs/architecture.md")
  ]);

  assert.match(migration, /0022_workspace_collaboration/);
  assert.match(migration, /workspace_note_grants ADD COLUMN IF NOT EXISTS revision/);
  assert.match(migration, /workspace_notebook_grants_revision_check/);
  assert.match(schema, /workspace_note_grants_revision_check/);
  assert.match(schema, /workspace_notebook_grants_revision_check/);

  assert.match(accessRepository, /workspaceAccessRoleRank/);
  assert.match(accessRepository, /workspaceGrantCeiling/);
  assert.match(accessRepository, /workspaceRoleWithinCeiling/);
  assert.match(accessRepository, /directGrants/);
  assert.match(accessRepository, /inheritedGrants/);
  assert.match(accessRepository, /workspaceAccessRoleRank\[row\.role\] > workspaceAccessRoleRank\[person\.effectiveRole\]/);
  assert.match(accessRepository, /resource\.actorRole === "owner" \|\| grant\.grantedByHandle === handle \|\| granteeHandle === handle/);
  assert.match(accessRepository, /grant\.revision !== input\.expectedRevision/);
  assert.match(accessRepository, /workspace\.access\.grant/);
  assert.match(accessRepository, /workspace_access_granted/);
  assert.match(accessRepository, /note\.access\.\$\{action\}/);
  assert.match(accessRepository, /remainingResource = await loadResourceAccess/);
  assert.match(documentRepository, /Only the owner can move a draft between notebooks/);
  assert.match(documentRepository, /collaboratorCount/);
  assert.match(documentRepository, /commentCount/);
  assert.match(documentRepository, /projectedRole/);

  assert.match(workspaceRoutes, /workspace\.document\.access\.grant/);
  assert.match(workspaceRoutes, /workspace\.notebook\.access\.revoke/);
  assert.match(workspaceRoutes, /\/v1\/workspace\/collaborators/);
  for (const route of [documentAccessRoute, notebookAccessRoute]) {
    assert.match(route, /proxyLiveBackend/);
    assert.match(route, /idempotencyKey/);
    assert.match(route, /privateWorkspaceResponse/);
  }
  assert.match(collaboratorRoute, /searchLocalWorkspaceCollaborators/);

  assert.match(localStore, /notebookGrants/);
  assert.match(localStore, /documentGrants/);
  assert.match(localStore, /workspaceAccessRoleRank\[direct\] >= workspaceAccessRoleRank\[inherited\]/);
  assert.match(localStore, /remainingResource = localResourceFor/);
  assert.match(localStore, /existing\.ownerHandle !== handle/);
  assert.match(localStore, /getLocalWorkspaceCommentCount/);
  assert.match(localComments, /activeCommentCount/);

  assert.match(accessHook, /symposium-workspace-change/);
  assert.match(accessHook, /channelName: "symposium-workspace-sync-v1"/);
  assert.match(accessHook, /createClientMutationId\(`workspace-\$\{target\.type\}-access-grant`\)/);
  assert.match(commentsHook, /channelName: "symposium-workspace-sync-v1"/);
  assert.match(commentsHook, /window\.dispatchEvent\(new Event\("symposium-workspace-change"\)\)/);
  assert.match(workspaceDocumentsHook, /channelName: "symposium-workspace-sync-v1"/);
  assert.match(workspaceView, /workspace\.announceChange\(\)/);
  assert.match(sharingDialog, /Your Office remains private/);
  assert.match(sharingDialog, /Invite a Symposium participant/);
  assert.match(sharingDialog, /Direct and inherited access combine at the stronger level/);
  assert.match(sharingDialog, /Via \{inherited\.notebookName\}/);
  assert.match(sharingDialog, /isSelf \? "Leave" : "Remove"/);
  assert.match(workspaceView, /WorkspaceSharingDialog/);
  assert.match(workspaceView, /Moving this draft can change inherited access/);
  assert.match(navigatorDocument, /Sharing and access/);
  assert.match(documentDetail, /className="workspace-sharing-trigger"/);
  assert.match(documentDetail, /Only the owner can change notebook placement because it controls inherited access/);
  assert.match(documentCard, /collaboratorCount/);

  assert.match(publication, /prepareWorkspacePublicationAttachments/);
  assert.match(publication, /uploaderHandle: revision\.ownerHandle/);
  assert.match(publication, /attachmentIds: publishedContent\.attachmentIds/);
  assert.doesNotMatch(publication, /Publishing their public copies will be activated/);
  assert.match(attachmentPublishing, /owner_type = 'note'/);
  assert.match(attachmentPublishing, /workspace-publications/);
  assert.match(attachmentPublishing, /workspacePublication/);
  assert.match(attachmentPublishing, /promoteUploadedObject/);
  assert.match(attachmentPublishing, /queueAttachmentRowsForStorageDeletion/);
  assert.match(attachmentPublishing, /rewritePublishedAttachmentReferences/);

  assert.match(styles, /\.workspace-sharing-dialog/);
  assert.match(styles, /\.symposium-shell\.night \.workspace-sharing-dialog/);
  assert.match(architecture, /sharing-and-collaboration manager/);
  assert.match(architecture, /public copies/);

  console.log("Workspace collaboration contracts, permission boundaries, sharing UI, public attachment copying, and persistence checks passed.");
};

void main();
