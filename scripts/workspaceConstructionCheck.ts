import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceDocumentInputSchema,
  updateWorkspaceDocumentInputSchema,
  workspaceSearchInputSchema
} from "@/packages/contracts/src";

const paragraph = {
  version: 1 as const,
  nodes: [{ id: "p1", type: "paragraph" as const, content: [{ text: "Research draft" }], align: "left" as const, indent: 0 }]
};
const heading = {
  version: 1 as const,
  nodes: [{ id: "h1", type: "heading" as const, level: 1, content: [{ text: "Paper heading" }], align: "left" as const }]
};

const main = async () => {
  assert.equal(createWorkspaceDocumentInputSchema.safeParse({
    title: "Generic note",
    body: "Research draft",
    document: heading,
    kind: "note"
  }).success, true);
  assert.equal(createWorkspaceDocumentInputSchema.safeParse({
    title: "Thought draft",
    body: "Research draft",
    document: heading,
    kind: "thought"
  }).success, false);
  assert.equal(createWorkspaceDocumentInputSchema.safeParse({
    title: "Quick note",
    body: "Reserved",
    document: paragraph,
    kind: "quick"
  }).success, false);
  assert.equal(updateWorkspaceDocumentInputSchema.safeParse({
    title: "Revision guarded",
    body: "Research draft",
    document: paragraph,
    kind: "paper",
    publicationTarget: "paper",
    expectedRevision: 4,
    checkpoint: true
  }).success, true);
  assert.equal(updateWorkspaceDocumentInputSchema.safeParse({
    title: "Missing revision",
    body: "Research draft",
    document: paragraph,
    kind: "paper"
  }).success, false);
  assert.equal(workspaceSearchInputSchema.parse({ query: "methods", limit: "12" }).limit, 12);

  const root = process.cwd();
  const [
    migration,
    repository,
    publishing,
    publicationState,
    attachmentRepository,
    attachmentOwnership,
    workspaceHook,
    workspaceView,
    workspaceRoute,
    postViews,
    symposiumView,
    workspaceStyles,
    composerDrafts
  ] = await Promise.all([
    readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/workspaceDocuments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/notePublishing.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/workspacePublicationState.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/attachments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/attachmentOwnership.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/useWorkspaceDocuments.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/WorkspaceView.tsx"), "utf8"),
    readFile(path.join(root, "app/api/workspace/route.ts"), "utf8"),
    readFile(path.join(root, "features/posts/PostViews.tsx"), "utf8"),
    readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
    readFile(path.join(root, "styles/88-workspace.css"), "utf8"),
    readFile(path.join(root, "features/workspace/savePostDraftToWorkspace.ts"), "utf8")
  ]);

  assert.match(migration, /0020_workspace_documents/);
  assert.match(migration, /CHECK \(visibility = 'private'\)/);
  assert.match(migration, /workspace_note_revisions/);
  assert.match(migration, /workspace_notebook_grants/);
  assert.match(migration, /workspace_note_grants/);
  assert.match(migration, /workspace_note_comments/);
  assert.match(migration, /note_publications_revision_unique_idx/);
  assert.match(repository, /note\.owner_handle = \$2 OR direct\.id IS NOT NULL OR inherited\.id IS NOT NULL/);
  assert.match(repository, /reason: input\.checkpoint \? "checkpoint" : "autosave"/);
  assert.match(repository, /note\.content_document::text ILIKE/);
  assert.match(repository, /attachment\.file_name ILIKE/);
  assert.match(repository, /pg_advisory_xact_lock\(hashtextextended\('symposium:workspace-note:'/);
  assert.match(publicationState, /revision_row\.revision = \$2/);
  assert.match(publicationState, /pg_advisory_lock\(hashtextextended\('symposium:workspace-note:'/);
  assert.match(publishing, /authorHandle: revision\.ownerHandle/);
  assert.match(publishing, /Private draft attachments remain protected/);
  assert.match(attachmentRepository, /input\.ownerType === "note" \? null : publicObjectUrl/);
  assert.match(attachmentOwnership, /row\.ownerId === null && row\.uploaderHandle !== input\.uploaderHandle/);
  assert.match(workspaceHook, /symposium-workspace-sync-v1/);
  assert.match(workspaceHook, /cache: "no-store"/);
  assert.match(workspaceView, /Search notes, authors, notebooks, content, comments, attachments/);
  assert.match(workspaceView, /Quick Notes have a place/);
  assert.match(workspaceRoute, /privateWorkspaceResponse/);
  assert.match(postViews, /onSaveDraft/);
  assert.match(postViews, /title\.trim\(\) \|\| `Untitled \$\{kind\}`/);
  assert.match(symposiumView, /workspace-document-create/);
  assert.match(symposiumView, /savePostDraftToWorkspace/);
  assert.match(composerDrafts, /Draft saved to Notes/);
  assert.match(composerDrafts, /symposium-workspace-sync-v1/);
  assert.match(workspaceStyles, /\.room-layout\.workspace-room-layout[\s\S]*width: min\(800px, calc\(100vw - 48px\)\)/);
  assert.match(workspaceStyles, /\.workspace-toolbar\.feed-toolbar[\s\S]*position: relative/);
  assert.match(workspaceStyles, /\.workspace-feed\.feed-stream[\s\S]*max-width: none/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "generic and destination-specific editor capability contracts",
      "reserved Quick Notes destination",
      "revision-required workspace saves",
      "private workspace root and collaboration-ready grants",
      "immutable draft revision checkpoints",
      "permission-safe workspace search projections",
      "exact-revision publication",
      "save/publish serialization and single-publication revisions",
      "owner-preserving collaborator publication",
      "protected private draft attachment delivery",
      "cross-tab convergence and no-store transport",
      "All, Notebooks, Quick Notes, and persistent search surfaces",
      "centered feed-width Notes composition",
      "New Post to private draft creation"
    ]
  }, null, 2));
};

void main();
