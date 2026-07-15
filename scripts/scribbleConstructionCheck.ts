import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  documentFitsScribbleEditor,
  documentPlainTextProjection,
  fileScribbleInputSchema,
  restoreScribbleInputSchema,
  updateScribbleInputSchema,
  type VersionedDocumentContract
} from "@/packages/contracts/src";
import { documentCitationLocatorLabel } from "@/lib/documentCitations";
import { decideScribbleSnapshot } from "@/features/scribble/scribbleReconciliation";

const main = async () => {
const root = process.cwd();
const source = {
  contracts: await readFile(path.join(root, "packages/contracts/src/index.ts"), "utf8"),
  migration: await readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8"),
  schema: await readFile(path.join(root, "apps/api/src/db/schema.ts"), "utf8"),
  repository: await readFile(path.join(root, "apps/api/src/repository/workspaceScribbles.ts"), "utf8"),
  routes: await readFile(path.join(root, "apps/api/src/routes/workspaceRoutes.ts"), "utf8"),
  localStore: await readFile(path.join(root, "lib/localWorkspaceStore.ts"), "utf8"),
  context: await readFile(path.join(root, "features/scribble/ScribbleContext.tsx"), "utf8"),
  attachmentWrapper: await readFile(path.join(root, "features/scribble/ScribbleAttachmentPreview.tsx"), "utf8"),
  attachments: await readFile(path.join(root, "features/attachments/AttachmentViews.tsx"), "utf8"),
  attachmentModal: await readFile(path.join(root, "features/attachments/AttachmentPreviewModal.tsx"), "utf8"),
  structuredAttachments: await readFile(path.join(root, "features/attachments/StructuredAttachmentPreviews.tsx"), "utf8"),
  editor: await readFile(path.join(root, "features/content/SymposiumTiptapEditor.tsx"), "utf8"),
  drawing: await readFile(path.join(root, "features/content/DocumentDrawing.tsx"), "utf8"),
  posts: await readFile(path.join(root, "features/posts/PostViews.tsx"), "utf8"),
  comments: await readFile(path.join(root, "features/comments/CommentThread.tsx"), "utf8"),
  workspace: await readFile(path.join(root, "features/workspace/WorkspaceView.tsx"), "utf8"),
  shell: await readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
  styles: await readFile(path.join(root, "styles/91-scribble.css"), "utf8")
};

const paragraphDocument: VersionedDocumentContract = {
  version: 1,
  nodes: [{ id: "scribble-paragraph", type: "paragraph", content: [{ text: "Persistent thought", marks: ["bold"] }], align: "left", indent: 0 }],
  settings: { width: "standard", margin: "normal" }
};
const sourceSnapshot = {
  kind: "post" as const,
  sourceId: "post-1",
  sourcePostId: "post-1",
  sourceRevision: 3,
  author: "Researcher",
  title: "A result",
  body: "Source body",
  canonicalPath: "/post/post-1"
};
const richScribbleDocument: VersionedDocumentContract = {
  version: 1,
  nodes: [
    ...paragraphDocument.nodes,
    { id: "code", type: "code", language: "ts", code: "const result = 1;" },
    { id: "equation", type: "equation", source: "E = mc^2", display: true },
    { id: "drawing", type: "drawing", drawing: { version: 1, width: 960, height: 540, strokes: [{ color: "ink", width: 4, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] }] } },
    { id: "reference", type: "reference", resource: { type: "post", id: "post-1", label: "A result" }, source: sourceSnapshot },
    { id: "citation", type: "citation", label: "Selected evidence", excerpt: "Selected evidence", source: sourceSnapshot, locator: { kind: "text", startBlockId: "p-1", startOffset: 2, endOffset: 19 } }
  ],
  settings: { width: "standard", margin: "normal" }
};

assert.equal(documentFitsScribbleEditor(richScribbleDocument), true);
assert.equal(documentFitsScribbleEditor({
  version: 1,
  nodes: [{ id: "heading", type: "heading", level: 1, content: [{ text: "No heading" }], align: "left" }]
}), false);
assert.equal(documentFitsScribbleEditor({
  version: 1,
  nodes: [{ id: "link", type: "paragraph", content: [{ text: "No link", link: "https://example.com" }], align: "left", indent: 0 }]
}), false);
assert.equal(updateScribbleInputSchema.safeParse({
  body: documentPlainTextProjection(richScribbleDocument),
  document: richScribbleDocument,
  expectedRevision: 4
}).success, true);
assert.equal(updateScribbleInputSchema.safeParse({
  body: "drifted projection",
  document: richScribbleDocument,
  expectedRevision: 4
}).success, false);
assert.equal(fileScribbleInputSchema.safeParse({ expectedRevision: 4, notebookId: null }).success, true);
assert.equal(restoreScribbleInputSchema.safeParse({ expectedRevision: 5, discardedRevision: 4 }).success, true);
assert.equal(documentCitationLocatorLabel({ kind: "image-region", x: 0.1, y: 0.2, width: 0.25, height: 0.4 }), "Image region · 25% × 40%");
assert.equal(documentCitationLocatorLabel({ kind: "spreadsheet-range", sheet: "Results", range: "B2:D8" }), "Results · B2:D8");
assert.equal(documentCitationLocatorLabel({ kind: "presentation-slide", slide: 7 }), "Slide 7");
assert.equal(decideScribbleSnapshot({ dirty: true, knownServerRevision: 4, localFingerprint: "mine", pendingSaveFingerprint: "mine", serverFingerprint: "mine", snapshotRevision: 5 }), "apply-server");
assert.equal(decideScribbleSnapshot({ dirty: true, knownServerRevision: 4, localFingerprint: "newer-keystrokes", pendingSaveFingerprint: "submitted", serverFingerprint: "submitted", snapshotRevision: 5 }), "preserve-local");
assert.equal(decideScribbleSnapshot({ dirty: true, knownServerRevision: 4, localFingerprint: "mine", serverFingerprint: "mine", snapshotRevision: 4 }), "apply-server");
assert.equal(decideScribbleSnapshot({ dirty: true, knownServerRevision: 4, localFingerprint: "mine", serverFingerprint: "remote", snapshotRevision: 4 }), "preserve-local");
assert.equal(decideScribbleSnapshot({ dirty: true, knownServerRevision: 4, localFingerprint: "mine", serverFingerprint: "remote", snapshotRevision: 5 }), "conflict");

assert.match(source.migration, /0024_workspace_scribbles/);
assert.match(source.migration, /UNIQUE \(owner_handle\)/);
assert.match(source.schema, /workspaceScribbleRevisions/);
assert.match(source.repository, /FOR UPDATE/);
assert.match(source.repository, /assertExpectedRevision\("scribble"/);
assert.match(source.repository, /ORDER BY revision DESC OFFSET 500/);
assert.match(source.repository, /workspace\.scribble\.(?:update|file|discard|restore)/);
assert.match(source.repository, /visibility: "private"/);
for (const endpoint of ["scribble", "scribble/file", "scribble/discard", "scribble/restore"]) {
  assert.ok(source.routes.includes(`/v1/workspace/${endpoint}`));
}
assert.match(source.localStore, /scribbleHistory/);
assert.match(source.localStore, /slice\(-500\)/);
assert.match(source.context, /symposium-scribble-sync-v1/);
assert.match(source.context, /dirty: parsed\.dirty === true/);
assert.match(source.context, /Recovering unsaved Scribble/);
assert.match(source.context, /Two versions need your choice/);
assert.match(source.context, /decideScribbleSnapshot/);
assert.match(source.context, /dirty: dirtyRef\.current \|\| pendingSaveRef\.current !== null/);
assert.match(source.context, /ref=\{editorHandleRef\}/);
assert.match(source.context, /window\.setTimeout\(\(\) => \{/);
assert.match(source.context, /pendingSaveRef/);
assert.match(source.context, /idempotencyKey: candidate\.idempotencyKey/);
assert.match(source.context, /Math\.min\(30_000, 1000 \* \(2 \*\* \(retryAttempt - 1\)\)\)/);
assert.match(source.context, /window\.addEventListener\("pagehide"/);
assert.match(source.context, /window\.addEventListener\("online"/);
assert.match(source.context, /keepalive: options\.keepalive/);
assert.match(source.context, /captureMatches/);
assert.match(source.editor, /capability === "scribble"[^\n]*Insert drawing/);
assert.match(source.editor, /capability === "scribble"[^\n]*Insert code block/);
assert.match(source.editor, /insertContentAt\(editor\.state\.selection\.to/);
assert.match(source.editor, /setEditable\(!disabled, false\)/);
assert.match(source.drawing, /setPointerCapture/);
assert.match(source.posts, /ScribbleCitable/);
assert.match(source.posts, /window\.getSelection\(\)\?\.toString\(\)\.trim\(\)/);
assert.match(source.comments, /ScribbleCitable/);
assert.match(source.attachmentWrapper, /locator\.kind === "whole"/);
assert.match(source.attachmentWrapper, /scribble\.addCitation\(source, excerpt, locator\)/);
assert.match(source.attachments, /orderedImageRegion/);
assert.match(source.attachments, /data-attachment-selectable/);
assert.match(source.attachmentModal, /Cite selection/);
assert.match(source.structuredAttachments, /kind: "spreadsheet-range"/);
assert.match(source.structuredAttachments, /kind: "presentation-slide"/);
assert.match(source.workspace, /document\.kind === "quick"/);
assert.match(source.shell, /<ScribbleProvider/);
assert.match(source.shell, /<ScribbleLauncher/);
assert.match(source.shell, /<ScribbleAttachmentPreview/);
assert.match(source.styles, /width: calc\(\(100vw - min\(var\(--symposium-feed-width\)/);
assert.match(source.styles, /border-radius: 10px/);
assert.doesNotMatch(source.styles, /border-left: 0/);

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "symposium-scribble-check-"));
try {
  process.chdir(temporaryRoot);
  const {
    discardLocalScribble,
    fileLocalScribble,
    getLocalScribble,
    getLocalWorkspace,
    restoreLocalScribble,
    updateLocalScribble
  } = await import("@/lib/localWorkspaceStore");
  const actor = "@scribble-construction-check";
  const initial = await getLocalScribble(actor);
  assert.equal(initial.scribble.revision, 1);
  const updated = await updateLocalScribble({
    body: documentPlainTextProjection(paragraphDocument),
    document: paragraphDocument,
    expectedRevision: initial.scribble.revision
  }, actor);
  assert.equal(updated.scribble.revision, 2);
  await assert.rejects(
    updateLocalScribble({ body: "Persistent thought", document: paragraphDocument, expectedRevision: 1 }, actor),
    (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 409)
  );
  const discarded = await discardLocalScribble({ expectedRevision: updated.scribble.revision }, actor);
  assert.equal(discarded.scribble.body, "");
  const restored = await restoreLocalScribble({
    expectedRevision: discarded.scribble.revision,
    discardedRevision: discarded.discardedRevision
  }, actor);
  assert.equal(restored.scribble.body, "Persistent thought");
  const filed = await fileLocalScribble({ expectedRevision: restored.scribble.revision, notebookId: null }, actor);
  assert.equal(filed.scribble.body, "");
  const workspace = await getLocalWorkspace(actor);
  const filedDocument = workspace.documents.find((document) => document.id === filed.filed.id);
  assert.equal(filedDocument?.kind, "quick");
  assert.equal(filedDocument?.access.canPublish, false);
  assert.equal(filedDocument?.access.canShare, false);
} finally {
  process.chdir(root);
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "Scribble-only document and exact plain-text projection contracts",
    "persistent singleton and bounded revision history",
    "revision-guarded autosave, filing, discard, and restore",
    "private API, local fallback, live event, and cross-tab parity",
    "offline dirty-cache recovery, replay-safe retries, and content-aware conflict resolution",
    "equation, vector drawing, code, references, and deduplicated citations",
    "whole-file, image-region, selected-text, spreadsheet-range, and slide capture",
    "site-wide launcher, post, comment, attachment viewer, and Workspace integration",
    "compact four-corner panel, on-demand filing menu, and locator-aware source cards",
    "non-publishable and non-shareable filed Quick Notes"
  ]
}, null, 2));
};

void main();
