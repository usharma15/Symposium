import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createWorkspaceCommentInputSchema,
  createWorkspaceDocumentInputSchema,
  updateWorkspaceCommentInputSchema,
  updateWorkspaceDocumentInputSchema,
  workspaceCommentActionInputSchema,
  workspaceSearchInputSchema
} from "@/packages/contracts/src";
import {
  normalizeWorkspaceSnapshot,
  runAfterWorkspaceSave,
  workspaceDocumentMetadataUpdate,
  workspaceDocumentsInNotebook
} from "@/features/workspace/workspaceNavigator";
import type { WorkspaceDocument } from "@/lib/workspaceTypes";
import { reconcileWorkspaceComments } from "@/features/workspace/workspaceCommentState";

const paragraph = {
  version: 1 as const,
  nodes: [{ id: "p1", type: "paragraph" as const, content: [{ text: "Research draft" }], align: "left" as const, indent: 0 }]
};
const heading = {
  version: 1 as const,
  nodes: [{ id: "h1", type: "heading" as const, level: 1, content: [{ text: "Paper heading" }], align: "left" as const }]
};

const workspaceDocument = (input: Partial<WorkspaceDocument> & Pick<WorkspaceDocument, "id" | "updatedAt">): WorkspaceDocument => {
  const { id, updatedAt, ...overrides } = input;
  return {
    id,
    workspaceId: "workspace-1",
    notebookId: null,
    notebookName: null,
    ownerHandle: "@owner",
    ownerName: "Owner",
    kind: "note",
    publicationTarget: "undecided",
    targetId: null,
    title: "Research note",
    body: "Research draft",
    document: paragraph,
    lifecycle: "draft",
    revision: 4,
    publishedPostId: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt,
    publishedAt: null,
    attachments: [],
    collaboratorCount: 0,
    commentCount: 0,
    access: {
      role: "owner",
      inheritedFromNotebook: false,
      canComment: true,
      canEdit: true,
      canPublish: true,
      canShare: true,
      canDelete: true
    },
    ...overrides,
    proposal: overrides.proposal ?? null,
    opportunity: overrides.opportunity ?? null
  };
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
  assert.equal(createWorkspaceCommentInputSchema.safeParse({
    body: "Private review",
    document: paragraph,
    attachmentIds: []
  }).success, true);
  assert.equal(createWorkspaceCommentInputSchema.safeParse({
    body: "Unsupported heading",
    document: heading,
    attachmentIds: []
  }).success, false);
  assert.equal(updateWorkspaceCommentInputSchema.safeParse({
    body: "Revision guarded review",
    document: paragraph,
    expectedRevision: 3,
    attachmentIds: []
  }).success, true);
  assert.equal(updateWorkspaceCommentInputSchema.safeParse({
    body: "Missing revision",
    document: paragraph,
    attachmentIds: []
  }).success, false);
  assert.equal(workspaceCommentActionInputSchema.safeParse({ action: "fork" }).success, false);
  assert.equal(workspaceCommentActionInputSchema.safeParse({ action: "signal", active: true }).success, true);
  const reconciledComments = reconcileWorkspaceComments(
    [{ id: "comment-1", author: "Owner", body: "newer", stance: "Comment", revision: 3, replies: [] }],
    [{ id: "comment-1", author: "Owner", body: "stale", stance: "Comment", revision: 2, replies: [] },
      { id: "comment-2", parentId: "comment-1", author: "Owner", body: "reply", stance: "Comment", revision: 1, replies: [] }]
  );
  assert.equal(reconciledComments[0]?.body, "newer");
  assert.equal(reconciledComments[0]?.replies?.[0]?.id, "comment-2");

  const olderDocument = workspaceDocument({ id: "older", notebookId: "notebook-1", notebookName: "Methods", updatedAt: "2026-07-14T00:00:00.000Z" });
  const newerDocument = workspaceDocument({ id: "newer", notebookId: "notebook-1", notebookName: "Methods", updatedAt: "2026-07-14T01:00:00.000Z" });
  assert.deepEqual(workspaceDocumentsInNotebook([olderDocument, newerDocument], "notebook-1").map((document) => document.id), ["newer", "older"]);
  const normalized = normalizeWorkspaceSnapshot({
    workspace: { id: "workspace-1", name: "Notes", ownerHandle: "@owner" },
    notebooks: [{
      id: "notebook-1",
      workspaceId: "workspace-1",
      ownerHandle: "@owner",
      name: "Methods",
      revision: 1,
      role: "owner",
      documentCount: 0,
      collaboratorCount: 0,
      canShare: true,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z"
    }],
    documents: [olderDocument, newerDocument]
  });
  assert.equal(normalized.notebooks[0]?.documentCount, 2);
  const metadataUpdate = workspaceDocumentMetadataUpdate(newerDocument, { title: "Renamed", notebookId: null });
  assert.equal(metadataUpdate.title, "Renamed");
  assert.equal(metadataUpdate.notebookId, null);
  assert.equal(metadataUpdate.body, newerDocument.body);
  assert.equal(metadataUpdate.document, newerDocument.document);
  assert.equal(metadataUpdate.expectedRevision, newerDocument.revision);
  assert.equal(metadataUpdate.checkpoint, true);
  let navigationRuns = 0;
  assert.equal(await runAfterWorkspaceSave(async () => false, () => { navigationRuns += 1; }), false);
  assert.equal(navigationRuns, 0);
  assert.equal(await runAfterWorkspaceSave(async () => true, () => { navigationRuns += 1; }), true);
  assert.equal(navigationRuns, 1);

  const root = process.cwd();
  const [
    migration,
    repository,
    publishing,
    publicationState,
    discussionPublishing,
    attachmentRepository,
    attachmentOwnership,
    workspaceHook,
    workspaceView,
    workspaceRoute,
    postViews,
    symposiumView,
    workspaceStyles,
    composerDrafts,
    workspaceNavigator,
    workspaceNavigatorDocument,
    workspaceDetail,
    workspaceCard,
    workspaceComments,
    workspaceCommentsHook,
    commentThread,
    attachmentAccessRoute,
    localPublicationRoute,
    localAttachmentStore
  ] = await Promise.all([
    readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/workspaceDocuments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/notePublishing.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/workspacePublicationState.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/workspaceDiscussionPublishing.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/attachments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/attachmentOwnership.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/useWorkspaceDocuments.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/WorkspaceView.tsx"), "utf8"),
    readFile(path.join(root, "app/api/workspace/route.ts"), "utf8"),
    readFile(path.join(root, "features/posts/PostViews.tsx"), "utf8"),
    readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
    readFile(path.join(root, "styles/88-workspace.css"), "utf8"),
    readFile(path.join(root, "features/workspace/savePostDraftToWorkspace.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/workspaceNavigator.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/WorkspaceNavigatorDocument.tsx"), "utf8"),
    readFile(path.join(root, "features/workspace/WorkspaceDocumentDetail.tsx"), "utf8"),
    readFile(path.join(root, "features/workspace/WorkspaceDocumentCard.tsx"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/workspaceComments.ts"), "utf8"),
    readFile(path.join(root, "features/workspace/useWorkspaceComments.ts"), "utf8"),
    readFile(path.join(root, "features/comments/CommentThread.tsx"), "utf8"),
    readFile(path.join(root, "app/api/workspace/attachments/[attachmentId]/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/workspace/documents/[noteId]/publish/route.ts"), "utf8"),
    readFile(path.join(root, "lib/localAttachmentStore.ts"), "utf8")
  ]);

  assert.match(migration, /0020_workspace_documents/);
  assert.match(migration, /CHECK \(visibility = 'private'\)/);
  assert.match(migration, /workspace_note_revisions/);
  assert.match(migration, /workspace_notebook_grants/);
  assert.match(migration, /workspace_note_grants/);
  assert.match(migration, /workspace_note_comments/);
  assert.match(migration, /0021_workspace_draft_discussion/);
  assert.match(migration, /workspace_note_comment_actions/);
  assert.match(migration, /note_comment/);
  assert.match(migration, /note_publications_revision_unique_idx/);
  assert.match(migration, /0023_workspace_publication_promotion/);
  assert.match(migration, /WHERE lifecycle = 'published' AND deleted_at IS NULL/);
  assert.match(repository, /note\.owner_handle = \$2 OR direct\.id IS NOT NULL OR inherited\.id IS NOT NULL/);
  assert.match(repository, /reason: input\.checkpoint \? "checkpoint" : "autosave"/);
  assert.match(repository, /note\.content_document::text ILIKE/);
  assert.match(repository, /attachment\.file_name ILIKE/);
  assert.match(repository, /pg_advisory_xact_lock\(hashtextextended\('symposium:workspace-note:'/);
  assert.match(publicationState, /revision_row\.revision = \$2/);
  assert.match(publicationState, /pg_advisory_lock\(hashtextextended\('symposium:workspace-note:'/);
  assert.match(publicationState, /deleted_at = now\(\)/);
  assert.match(publicationState, /publishPreparedWorkspaceDiscussion/);
  assert.match(publicationState, /workspace_note_published/);
  assert.match(publishing, /authorHandle: revision\.ownerHandle/);
  assert.match(publishing, /prepareWorkspacePublicationAttachments/);
  assert.match(publishing, /prepareWorkspaceDiscussionPublication/);
  assert.match(discussionPublishing, /FROM workspace_note_comments/);
  assert.match(discussionPublishing, /sourceOwnerType: "note_comment"/);
  assert.match(discussionPublishing, /INSERT INTO comments/);
  assert.match(discussionPublishing, /INSERT INTO comment_actions/);
  assert.match(discussionPublishing, /SELECT 'comment', \$2, actor_handle, bucket_start/);
  assert.match(localPublicationRoute, /promoteLocalWorkspaceDocumentAttachments/);
  assert.match(localPublicationRoute, /updatePost/);
  assert.match(localPublicationRoute, /updateComment/);
  assert.doesNotMatch(localPublicationRoute, /Private draft attachments remain protected/);
  assert.match(localAttachmentStore, /ownerType: publicOwnerType/);
  assert.match(attachmentRepository, /input\.ownerType === "note" \|\| input\.ownerType === "note_comment" \|\| input\.ownerType === "opportunity_application" \? null : publicObjectUrl/);
  assert.match(attachmentOwnership, /row\.ownerId === null && row\.uploaderHandle !== input\.uploaderHandle/);
  assert.match(workspaceHook, /symposium-workspace-sync-v1/);
  assert.match(workspaceHook, /cache: "no-store"/);
  assert.match(workspaceHook, /normalizeWorkspaceSnapshot/);
  assert.match(workspaceHook, /updateDocumentMetadata/);
  assert.match(workspaceView, /Search notes, authors, notebooks, content, comments, attachments/);
  assert.match(workspaceView, /candidates\.filter\(\(document\) => document\.kind === "quick"\)/);
  assert.match(workspaceView, /No filed Scribbles yet/);
  assert.match(workspaceView, /workspace-sidebar-scroll/);
  assert.match(workspaceView, /const creationKinds: WorkspaceDocument\["kind"\]\[\] = \["note", "thought", "paper"\]/);
  assert.match(workspaceNavigatorDocument, /toLocaleDateString\(undefined, \{ day: "2-digit", month: "2-digit", year: "2-digit" \}\)/);
  assert.match(workspaceNavigatorDocument, /workspace-sidebar-preview/);
  assert.match(workspaceNavigatorDocument, /workspace-sidebar-meta/);
  assert.match(workspaceNavigatorDocument, /Move to notebook/);
  assert.match(workspaceNavigatorDocument, /onRename/);
  assert.match(workspaceNavigatorDocument, /onDelete/);
  assert.match(workspaceView, /workspace-notebook-create[\s\S]*workspace\.snapshot\.notebooks\.map/);
  assert.match(workspaceView, /aria-expanded=\{expanded\}/);
  assert.match(workspaceView, /WorkspaceNavigatorDocument/);
  assert.match(workspaceView, /prepareForNavigation/);
  assert.match(workspaceDetail, /savePromiseRef/);
  assert.match(workspaceDetail, /prepareForNavigation/);
  assert.match(workspaceDetail, /document\.revision <= savedDocumentRef\.current\.revision/);
  assert.match(workspaceDetail, /<CommentComposer/);
  assert.match(workspaceDetail, /<CommentThread/);
  assert.match(workspaceDetail, /workspace-kind-\$\{document\.kind\}/);
  assert.match(workspaceDetail, /allowQuotes: false/);
  assert.match(workspaceDetail, /allowReshares: false/);
  assert.match(workspaceComments, /roleRank\[access\.role\] < roleRank\.commenter/);
  assert.match(workspaceComments, /visibility: "private"/);
  assert.match(workspaceComments, /recordContentView\(client, "note_comment"/);
  assert.match(workspaceComments, /ownerType: "note_comment"/);
  assert.match(workspaceCommentsHook, /symposium-workspace-discussion-sync-v1/);
  assert.match(workspaceCommentsHook, /cache: "no-store"/);
  assert.match(workspaceCommentsHook, /createClientMutationId\("workspace-comment-update"\)/);
  assert.match(commentThread, /allowReplies\?: boolean/);
  assert.match(commentThread, /allowReshares !== false/);
  assert.match(commentThread, /allowQuotes !== false/);
  assert.match(attachmentAccessRoute, /\["note", "note_comment"\]/);
  assert.match(repository, /queueAttachmentsForOwnerStorageDeletion\([\s\S]*"note_comment"/);
  assert.match(workspaceNavigator, /workspaceDocumentMetadataUpdate/);
  assert.match(workspaceNavigator, /runAfterWorkspaceSave/);
  assert.match(workspaceDetail, /Created \{localDateTimeLabel\(document\.createdAt\)\}/);
  assert.match(workspaceCard, /Created \{localDateTimeLabel\(document\.createdAt\)\}/);
  assert.doesNotMatch(workspaceView, /workspaceDateGroup/);
  assert.doesNotMatch(workspaceView, /Draft, organise, revise, and publish research without leaving your office/);
  assert.doesNotMatch(workspaceView, /Workspace current/);
  assert.doesNotMatch(workspaceView, /All notebooks/);
  assert.doesNotMatch(workspaceView, /Choose a notebook or create one to give a line of research its own working space/);
  assert.match(workspaceRoute, /privateWorkspaceResponse/);
  assert.match(postViews, /onSaveDraft/);
  assert.match(postViews, /title\.trim\(\) \|\| `Untitled \$\{kind\}`/);
  assert.match(symposiumView, /workspace-document-create/);
  assert.match(symposiumView, /savePostDraftToWorkspace/);
  assert.match(composerDrafts, /Draft saved to Notes/);
  assert.match(composerDrafts, /symposium-workspace-sync-v1/);
  assert.match(workspaceStyles, /\.room-layout\.workspace-room-layout[\s\S]*width: calc\(100vw - 48px\)/);
  assert.match(workspaceStyles, /\.workspace-toolbar\.feed-toolbar[\s\S]*position: fixed[\s\S]*inset: 104px auto 144px 24px/);
  assert.match(workspaceStyles, /\.workspace-toolbar\.feed-toolbar\s*\{[^}]*justify-content: stretch[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(workspaceStyles, /\.workspace-sidebar-scroll[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain/);
  assert.match(workspaceStyles, /\.workspace-sidebar-document[\s\S]*height: 64px/);
  assert.match(workspaceStyles, /\.workspace-notebook-create\s*\{[^}]*position: sticky[^}]*top: 0/);
  assert.match(workspaceStyles, /\.workspace-notebook-documents\s*\{[^}]*display: grid/);
  assert.match(workspaceStyles, /\.workspace-document-card\s*\{[^}]*background: color-mix\(in srgb, var\(--panel-strong\) 90%, transparent\)/);
  assert.match(workspaceStyles, /\.workspace-document-card \.document-collapsible-content\.collapsed\.is-collapsible::after\s*\{[^}]*content: none/);
  assert.match(workspaceStyles, /\.workspace-sidebar-document-menu\s*\{[^}]*display: grid/);
  assert.match(workspaceStyles, /\.workspace-main-column[\s\S]*width: min\(var\(--symposium-feed-width\), calc\(100vw - 48px\)\)/);
  assert.match(workspaceStyles, /\.workspace-feed\.feed-stream[\s\S]*max-width: var\(--symposium-feed-width\)/);
  assert.match(workspaceStyles, /\.workspace-detail-nav[\s\S]*position: relative[\s\S]*top: auto/);
  assert.match(workspaceStyles, /\.workspace-detail-nav\s*\{[^}]*background: var\(--document-surface-solid\)[^}]*color: var\(--ink\)/);
  assert.match(workspaceStyles, /\.workspace-search\s*\{[^}]*background: var\(--document-control-solid\)[^}]*color: var\(--ink\)/);
  assert.match(workspaceStyles, /\.workspace-search input\s*\{[^}]*background: transparent[^}]*color: inherit/);
  assert.match(workspaceStyles, /\.symposium-shell\.night \.workspace-search input\s*\{[^}]*background: transparent[^}]*color: var\(--ink\)/);
  assert.match(workspaceStyles, /\.symposium-shell\.night \.workspace-search input::placeholder\s*\{[^}]*color: rgba\(229, 219, 199, 0\.64\)[^}]*opacity: 1/);
  assert.match(workspaceStyles, /\.workspace-detail-nav button\.danger\s*\{[^}]*color: color-mix\(in srgb, #b42f2f 60%, var\(--ink\)\)/);
  assert.match(workspaceStyles, /\.workspace-editor-footer\s*\{[^}]*position: sticky;[^}]*bottom: 0/);
  assert.match(workspaceStyles, /\.workspace-editor \.document-editor-toolbar\s*\{[^}]*z-index: 8/);
  assert.doesNotMatch(workspaceStyles, /\.workspace-editor \.document-editor-toolbar\s*\{[^}]*top:/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "generic and destination-specific editor capability contracts",
    "filed Scribbles in the Quick Notes destination",
      "revision-required workspace saves",
      "private workspace root and collaboration-ready grants",
      "immutable draft revision checkpoints",
      "permission-safe workspace search projections",
      "exact-revision promotion out of the workspace",
      "draft discussion, action, view, and attachment promotion",
      "save/publish serialization and single-publication revisions",
      "owner-preserving collaborator publication",
      "protected private draft attachment delivery and public promotion parity",
      "private access-gated draft comments and replies",
      "revision-guarded draft comment edits and tombstones",
      "private comment likes, saves, and deduplicated views without reshares or quotes",
      "private draft comment attachments and deletion cleanup",
      "authoritative live and cross-tab draft discussion convergence",
      "revision-aware protection against out-of-order draft comment responses",
      "cross-tab convergence and no-store transport",
      "All, Notebooks, Quick Notes, and persistent search surfaces",
      "constant full-width Notes controls across every workspace section",
      "fixed independently scrolling five-draft Notes navigator",
      "flat local-date draft metadata and expandable notebook navigation",
      "pinned notebook creation and inline note actions",
      "serialized save-before-navigation with guarded metadata mutations",
      "clean-editor convergence to newer cross-tab revisions",
      "immediate notebook document-count reconciliation",
      "theme-tokened detail navigation and artifact-free night search",
      "Note, Thought, and Paper-only draft creation",
      "canonical centered feed-width Notes composition",
      "New Post to private draft creation"
    ]
  }, null, 2));
};

void main();
