import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createCommentInputSchema,
  createPostInputSchema,
  versionedDocumentSchema,
  type InquiryAttachmentContract,
  type VersionedDocumentContract
} from "../packages/contracts/src";
import {
  documentPlainText,
  feedPreviewAttachments,
  normalizeDocumentAttachments,
  plainTextDocument
} from "../lib/documentModel";
import {
  normalizeImportedParagraphLayout,
  symposiumDocumentToTiptap,
  tiptapToSymposiumDocument
} from "../features/content/SymposiumTiptapEditor";

const attachment = (id: string, kind: InquiryAttachmentContract["kind"] = "image"): InquiryAttachmentContract => ({
  id,
  fileName: `${id}.png`,
  contentType: "image/png",
  byteSize: 100,
  status: "uploaded",
  kind,
  url: `https://assets.example/${id}.png`
});

const document: VersionedDocumentContract = {
  version: 1,
  nodes: [
    { id: "intro", type: "paragraph", content: [{ text: "Evidence before assertion.", marks: ["bold"] }], align: "left", indent: 0 },
    { id: "asset-a", type: "attachment", attachmentId: "inline-a", placement: "inline" },
    { id: "equation", type: "equation", source: "E = mc^2", display: true },
    { id: "asset-b", type: "attachment", attachmentId: "inline-b", placement: "inline" },
    { id: "ending", type: "paragraph", content: [{ text: "Conclusion." }], align: "left", indent: 0 }
  ]
};

const editorSource = readFileSync("features/content/SymposiumTiptapEditor.tsx", "utf8");
assert.match(editorSource, /const initialTextStyle = initialFormatting\.textStyle \?\? defaultPreferredTextStyle/);
assert.match(editorSource, /if \(capability === "paper"\) initialFormatting\.textStyle = initialTextStyle/);

assert.equal(versionedDocumentSchema.parse(document).version, 1);
assert.equal(documentPlainText(document), "Evidence before assertion.\n\nE = mc^2\n\nConclusion.");

const formattedDocument: VersionedDocumentContract = {
  version: 1,
  settings: { width: "wide", margin: "generous" },
  nodes: [
    {
      id: "formatted",
      type: "paragraph",
      content: [{ text: "A linked claim", marks: ["bold", "italic", "underline"], font: "serif", size: "large", color: "blue", link: "https://example.com/claim" }],
      align: "center",
      indent: 2
    },
    { id: "list", type: "list", style: "lower-alpha", depth: 1, items: [[{ text: "First" }], [{ text: "Second" }]] },
    { id: "inline", type: "attachment", attachmentId: "inline-a", placement: "inline", caption: "Evidence" },
    { id: "math", type: "equation", source: "\\int_0^1 x^2 dx", display: true, label: "Eq. 1" }
  ]
};

assert.deepEqual(
  tiptapToSymposiumDocument(symposiumDocumentToTiptap(formattedDocument), formattedDocument.settings),
  formattedDocument,
  "the continuous editor must round-trip canonical formatting, page settings, equations, and inline attachments"
);

const importedGoogleDocsParagraph = normalizeImportedParagraphLayout([
  { text: "\t", marks: ["bold"] },
  { text: "\tA pasted Google Docs line", marks: ["italic"], font: "serif" }
], 1);
assert.equal(importedGoogleDocsParagraph.indent, 3);
assert.deepEqual(importedGoogleDocsParagraph.content, [
  { text: "A pasted Google Docs line", marks: ["italic"], font: "serif" }
]);
assert.deepEqual(
  normalizeImportedParagraphLayout([{ text: "\tA reduced-editor paste" }], 0, "reduced"),
  { content: [{ text: "\tA reduced-editor paste" }], indent: 0 },
  "reduced editors must retain imported layout characters that they cannot represent as paragraph indentation"
);
const importedGoogleDocsDocument = tiptapToSymposiumDocument({
  type: "doc",
  content: [{
    type: "paragraph",
    attrs: { blockId: "google-docs", textAlign: "center", indent: 0 },
    content: [
      { type: "text", text: "\t", marks: [{ type: "bold" }] },
      { type: "text", text: "\tImported and styled", marks: [{ type: "italic" }] }
    ]
  }]
});
assert.deepEqual(importedGoogleDocsDocument.nodes[0], {
  id: "google-docs",
  type: "paragraph",
  content: [{ text: "Imported and styled", marks: ["italic"] }],
  align: "center",
  indent: 2
});

const reducedProjection = tiptapToSymposiumDocument(symposiumDocumentToTiptap(formattedDocument), formattedDocument.settings, "reduced");
assert.equal(reducedProjection.nodes.some((node) => node.type === "list" || node.type === "heading" || node.type === "code"), false);
const reducedTextRuns = reducedProjection.nodes.flatMap((node) => node.type === "paragraph" || node.type === "quote" ? node.content : []);
assert.equal(reducedTextRuns.some((run) => run.font || run.size || run.color || run.marks?.includes("code") || run.marks?.includes("strikethrough")), false);

const legacyBody = "First paragraph.\nStill first.\n\nSecond paragraph.";
assert.equal(documentPlainText(plainTextDocument(legacyBody)), legacyBody);

const attachments = [attachment("inline-b"), attachment("appended-a"), attachment("inline-a"), attachment("appended-b")];
assert.deepEqual(
  feedPreviewAttachments(document, attachments).map((item) => item.id),
  ["appended-a", "appended-b", "inline-a", "inline-b"]
);

const missingInline = normalizeDocumentAttachments(document, attachments.filter((item) => item.id !== "inline-a"));
assert.equal(missingInline.nodes.some((node) => node.type === "attachment" && node.attachmentId === "inline-a"), false);

assert.equal(createPostInputSchema.safeParse({
  title: "Paper",
  body: "A paper",
  document: { ...document, nodes: [{ id: "heading", type: "heading", level: 1, content: [{ text: "Section" }], align: "left" }] },
  kind: "paper",
  postType: "paper",
  room: "library",
  attachments: []
}).success, true);

assert.equal(createPostInputSchema.safeParse({
  title: "Thought",
  body: "A thought",
  document: { ...document, nodes: [{ id: "heading", type: "heading", level: 1, content: [{ text: "Not reduced" }], align: "left" }] },
  kind: "thought",
  postType: "thought",
  room: "symposium",
  attachments: []
}).success, false);

assert.equal(createCommentInputSchema.safeParse({
  body: "A comment",
  document: { version: 1, nodes: [{ id: "p", type: "paragraph", content: [{ text: "Bold", marks: ["bold", "underline"] }], align: "left", indent: 0 }] },
  stance: "Comment"
}).success, true);

assert.equal(createCommentInputSchema.safeParse({
  body: "A comment",
  document: { version: 1, nodes: [{ id: "p", type: "paragraph", content: [{ text: "Too styled", color: "blue" }], align: "left", indent: 0 }] },
  stance: "Comment"
}).success, false);

assert.equal(createPostInputSchema.safeParse({
  title: "Broken inline reference",
  body: "Missing asset ownership",
  document,
  kind: "paper",
  postType: "paper",
  room: "library",
  attachmentIds: [],
  attachments: []
}).success, false);

console.log("document editor contract checks passed");
