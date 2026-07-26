import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  createCommentInputSchema,
  createPostInputSchema,
  documentCitationMarkerText,
  versionedDocumentSchema,
  type DocumentNativeCitationContract,
  type VersionedDocumentContract
} from "@/packages/contracts/src";
import {
  documentCitationBibliographyEntry,
  documentCitationOrdinals,
  documentNativeCitations
} from "@/lib/documentCitations";
import {
  symposiumDocumentToTiptap,
  tiptapToSymposiumDocument
} from "@/features/content/SymposiumTiptapEditor";
import { resolveNativeDocumentCitations } from "@/apps/api/src/services/nativeCitations";

const sourceDocument: VersionedDocumentContract = {
  version: 1,
  nodes: [{
    id: "result-block",
    type: "paragraph",
    content: [{ text: "The intervention reduced the measured endpoint by 12 percent." }],
    align: "left",
    indent: 0
  }]
};

const citation = (overrides: Partial<DocumentNativeCitationContract> = {}): DocumentNativeCitationContract => ({
  id: "00000000-0000-4000-8000-000000000601",
  source: {
    kind: "post",
    sourceId: "paper-1",
    sourcePostId: "paper-1",
    sourceRevision: 99,
    author: "Forged Author",
    title: "Forged title",
    body: "Forged source snapshot",
    canonicalPath: "/posts/paper-1"
  },
  locator: {
    kind: "text",
    startBlockId: "result-block",
    endBlockId: "result-block",
    startOffset: 4,
    endOffset: 61
  },
  excerpt: "intervention reduced the measured endpoint by 12 percent",
  ...overrides
});

const nativeDocument = (
  first: DocumentNativeCitationContract,
  second: DocumentNativeCitationContract | null = null
): VersionedDocumentContract => ({
  version: 1,
  settings: { width: "standard", margin: "normal", citationStyle: "apa" },
  nodes: [{
    id: "draft",
    type: "paragraph",
    content: [
      { text: "The result is material " },
      { text: documentCitationMarkerText, citation: first },
      ...(second ? [{ text: " and replicable " }, { text: documentCitationMarkerText, citation: second }] : []),
      { text: "." }
    ],
    align: "left",
    indent: 0
  }]
});

const canonicalPostRow = {
  id: "paper-1",
  revision: 7,
  authorName: "Ada Researcher",
  authorHandle: "@ada",
  title: "Measured endpoint study",
  body: "The intervention reduced the measured endpoint by 12 percent.",
  document: sourceDocument,
  postId: "paper-1",
  commentId: null,
  postType: "paper",
  createdAt: "2026-07-20T12:00:00.000Z"
};

const canonicalCommentRow = {
  ...canonicalPostRow,
  id: "comment-1",
  revision: 4,
  authorName: "Grace Reviewer",
  authorHandle: "@grace",
  title: canonicalPostRow.title,
  body: "The independent review reproduced the primary endpoint.",
  document: {
    version: 1,
    nodes: [{
      id: "review-block",
      type: "paragraph",
      content: [{ text: "The independent review reproduced the primary endpoint." }],
      align: "left",
      indent: 0
    }]
  } satisfies VersionedDocumentContract,
  commentId: "comment-1",
  createdAt: "2026-07-21T09:30:00.000Z"
};

const attachmentCitation = (
  kind: "whole" | "image-region" | "pdf-text" | "spreadsheet-range" | "presentation-slide",
  overrides: Partial<DocumentNativeCitationContract> = {}
): DocumentNativeCitationContract => {
  const locator: DocumentNativeCitationContract["locator"] =
    kind === "image-region"
      ? { kind, x: 0.1, y: 0.15, width: 0.35, height: 0.4 }
      : kind === "pdf-text"
        ? { kind, page: 2, excerpt: "Confirmed attachment evidence" }
        : kind === "spreadsheet-range"
          ? { kind, sheet: "Results", range: "B2:D6" }
          : kind === "presentation-slide"
            ? { kind, slide: 3 }
            : { kind };
  return citation({
    id: `00000000-0000-4000-8000-0000000007${kind.length.toString().padStart(2, "0")}`,
    source: {
      kind: "attachment",
      sourceId: `attachment-${kind}`,
      sourcePostId: "paper-1",
      title: `${kind} source`,
      body: "Client attachment snapshot",
      canonicalPath: `/posts/paper-1?attachment=attachment-${kind}`
    },
    locator,
    excerpt: kind === "pdf-text" ? "Confirmed attachment evidence" : `${kind} evidence`,
    ...overrides
  });
};

const attachmentRow = ({
  id,
  fileName,
  contentType,
  metadata
}: {
  id: string;
  fileName: string;
  contentType: string;
  metadata?: Record<string, unknown>;
}) => ({
  ...canonicalPostRow,
  id,
  fileName,
  contentType,
  byteSize: 2048,
  metadata: metadata ?? { previewText: `${fileName} whole evidence` }
});

const clientReturning = (rows: unknown[]) => {
  let calls = 0;
  const client = {
    query: async () => {
      calls += 1;
      return { rows, rowCount: rows.length };
    }
  } as unknown as PoolClient;
  return { client, calls: () => calls };
};

const markerDocument = nativeDocument(citation());
assert.equal(versionedDocumentSchema.safeParse(markerDocument).success, true);
assert.equal(versionedDocumentSchema.safeParse(nativeDocument(citation(), {
  ...citation(),
  id: citation().id,
  excerpt: "A different source snapshot"
})).success, false, "one citation ID cannot identify two different snapshots");
assert.equal(versionedDocumentSchema.safeParse({
  ...markerDocument,
  nodes: [{
    id: "broken",
    type: "paragraph",
    content: [{ text: "[1]", citation: citation() }],
    align: "left",
    indent: 0
  }]
}).success, false, "a client cannot forge the visible marker text");
assert.equal(versionedDocumentSchema.safeParse({
  ...markerDocument,
  nodes: [{
    id: "citation-limit",
    type: "paragraph",
    content: Array.from({ length: 101 }, (_, index) => ({
      text: documentCitationMarkerText,
      citation: citation({
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
      })
    })),
    align: "left",
    indent: 0
  }]
}).success, false, "documents must reject more than 100 native citation markers");

assert.deepEqual(
  tiptapToSymposiumDocument(
    symposiumDocumentToTiptap(markerDocument),
    markerDocument.settings
  ),
  markerDocument,
  "native citation markers must survive the canonical TipTap round trip"
);
assert.equal(documentNativeCitations(markerDocument).length, 1);
assert.equal(documentCitationOrdinals(markerDocument).get(citation().id), 1);
assert.match(documentCitationBibliographyEntry(citation({
  source: {
    ...citation().source,
    author: "Ada Researcher",
    title: "Measured endpoint study",
    createdAt: "2026-07-20T12:00:00.000Z"
  }
}), "apa"), /Ada Researcher\. \(2026\)\. Measured endpoint study\./);
assert.match(documentCitationBibliographyEntry(citation(), "mla"), /“Forged title\.” Symposium/);
assert.match(documentCitationBibliographyEntry(citation(), "chicago"), /Symposium\. n\.d\./);

assert.equal(createPostInputSchema.safeParse({
  title: "Cited paper",
  body: "The result is material [citation].",
  document: markerDocument,
  kind: "paper",
  postType: "paper",
  room: "library",
  attachmentIds: []
}).success, true);
assert.equal(createCommentInputSchema.safeParse({
  body: "The result is material [citation].",
  document: markerDocument,
  stance: "Evidence"
}).success, true);

const main = async () => {
  const verified = clientReturning([canonicalPostRow]);
  const resolved = await resolveNativeDocumentCitations(
    verified.client,
    nativeDocument(citation(), citation()),
    "@author"
  );
  assert.equal(verified.calls(), 1, "duplicate markers for one citation record should revalidate the source once");
  assert.equal(resolved.citationCount, 1);
  assert.equal(resolved.newCitationCount, 1);
  const canonical = documentNativeCitations(resolved.document)[0]!;
  assert.equal(canonical.source.author, "Ada Researcher");
  assert.equal(canonical.source.title, "Measured endpoint study");
  assert.equal(canonical.source.sourceRevision, 7);
  assert.equal(canonical.source.body, canonicalPostRow.body);
  assert.ok(canonical.capturedAt);

  const commentRecord = citation({
    id: "00000000-0000-4000-8000-000000000602",
    source: {
      kind: "comment",
      sourceId: "comment-1",
      sourcePostId: "paper-1",
      sourceCommentId: "comment-1",
      title: "Forged comment title",
      body: "Forged comment body",
      canonicalPath: "/posts/paper-1?comment=comment-1"
    },
    locator: {
      kind: "text",
      startBlockId: "review-block",
      endBlockId: "review-block",
      startOffset: 4,
      endOffset: 55
    },
    excerpt: "independent review reproduced the primary endpoint"
  });
  const commentResolved = await resolveNativeDocumentCitations(
    clientReturning([canonicalCommentRow]).client,
    nativeDocument(commentRecord),
    "@author"
  );
  const canonicalComment = documentNativeCitations(commentResolved.document)[0]!;
  assert.equal(canonicalComment.source.kind, "comment");
  assert.equal(canonicalComment.source.author, "Grace Reviewer");
  assert.equal(canonicalComment.source.sourceRevision, 4);
  assert.equal(canonicalComment.source.canonicalPath, "/posts/paper-1?comment=comment-1");

  const attachmentCases = [
    {
      record: attachmentCitation("whole"),
      row: attachmentRow({
        id: "attachment-whole",
        fileName: "methods.txt",
        contentType: "text/plain"
      }),
      expectedKind: "text"
    },
    {
      record: attachmentCitation("image-region"),
      row: attachmentRow({
        id: "attachment-image-region",
        fileName: "figure.png",
        contentType: "image/png"
      }),
      expectedKind: "image"
    },
    {
      record: attachmentCitation("pdf-text"),
      row: attachmentRow({
        id: "attachment-pdf-text",
        fileName: "paper.pdf",
        contentType: "application/pdf",
        metadata: { previewText: "Page 2: Confirmed attachment evidence." }
      }),
      expectedKind: "pdf"
    },
    {
      record: attachmentCitation("spreadsheet-range"),
      row: attachmentRow({
        id: "attachment-spreadsheet-range",
        fileName: "results.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        metadata: {
          structuredPreview: {
            sheets: [{ name: "Results", rows: [["spreadsheet-range evidence"]] }]
          }
        }
      }),
      expectedKind: "spreadsheet"
    },
    {
      record: attachmentCitation("presentation-slide"),
      row: attachmentRow({
        id: "attachment-presentation-slide",
        fileName: "review.pptx",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        metadata: {
          structuredPreview: {
            slides: [{ slide: 3, text: "presentation-slide evidence" }]
          }
        }
      }),
      expectedKind: "presentation"
    }
  ] as const;
  for (const testCase of attachmentCases) {
    const attachmentResolved = await resolveNativeDocumentCitations(
      clientReturning([testCase.row]).client,
      nativeDocument(testCase.record),
      "@author"
    );
    const canonicalAttachment = documentNativeCitations(attachmentResolved.document)[0]!;
    assert.equal(canonicalAttachment.source.kind, "attachment");
    assert.equal(canonicalAttachment.source.attachment?.kind, testCase.expectedKind);
    assert.equal(canonicalAttachment.source.title, testCase.row.fileName);
    assert.match(canonicalAttachment.source.canonicalPath, new RegExp(`attachment=${testCase.row.id}$`));
  }
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([attachmentCases[2].row]).client,
      nativeDocument(attachmentCitation("pdf-text", { excerpt: "Fabricated PDF result" })),
      "@author"
    ),
    /unavailable/
  );

  const tampered = clientReturning([canonicalPostRow]);
  await assert.rejects(
    resolveNativeDocumentCitations(
      tampered.client,
      nativeDocument(citation({ excerpt: "A result that does not occur in the source." })),
      "@author"
    ),
    /no longer matches/
  );

  const inaccessible = clientReturning([]);
  await assert.rejects(
    resolveNativeDocumentCitations(inaccessible.client, markerDocument, "@author"),
    /unavailable or no longer accessible/
  );

  const noQueries = clientReturning([]);
  const persisted = nativeDocument(canonical);
  const preserved = await resolveNativeDocumentCitations(
    noQueries.client,
    persisted,
    "@author",
    persisted
  );
  assert.equal(noQueries.calls(), 0, "saved immutable snapshots must remain editable after later source revocation");
  assert.deepEqual(preserved.document, persisted);
  assert.equal(preserved.newCitationCount, 0);

  const mutationAttempt = nativeDocument({
    ...canonical,
    excerpt: "Silently changed snapshot"
  });
  await assert.rejects(
    resolveNativeDocumentCitations(
      noQueries.client,
      mutationAttempt,
      "@author",
      persisted
    ),
    /cannot be silently changed/
  );

  const source = {
    contracts: readFileSync("packages/contracts/src/index.ts", "utf8"),
    editor: readFileSync("features/content/SymposiumTiptapEditor.tsx", "utf8"),
    renderer: readFileSync("features/content/SymposiumDocument.tsx", "utf8"),
    capture: readFileSync("features/citations/NativeCitationContext.tsx", "utf8"),
    scribble: readFileSync("features/scribble/ScribbleContext.tsx", "utf8"),
    attachments: readFileSync("features/attachments/AttachmentPreviewModal.tsx", "utf8"),
    assistant: readFileSync("features/assistant/AssistantExperience.tsx", "utf8"),
    posts: readFileSync("apps/api/src/repository/posts.ts", "utf8"),
    comments: readFileSync("apps/api/src/repository/comments.ts", "utf8"),
    workspace: readFileSync("apps/api/src/repository/workspaceDocuments.ts", "utf8"),
    server: readFileSync("apps/api/src/services/nativeCitations.ts", "utf8"),
    shell: readFileSync("components/SymposiumV0.tsx", "utf8"),
    styles: readFileSync("styles/94-native-citations.css", "utf8")
  };

  assert.match(source.contracts, /documentNativeCitationSchema/);
  assert.match(source.contracts, /at most 100 native citation markers/);
  assert.match(source.editor, /symposiumInlineCitation/);
  assert.match(source.editor, /Bibliography style/);
  assert.match(source.renderer, /document-inline-citation-preview/);
  assert.match(source.renderer, /documentCitationBibliographyEntry/);
  assert.match(source.capture, /pendingCitation/);
  assert.match(source.scribble, /Cite in draft/);
  assert.match(source.attachments, /onNativeCapture/);
  assert.match(source.assistant, /Stage this evidence as a native citation/);
  assert.match(source.posts, /resolveNativeDocumentCitations/);
  assert.match(source.comments, /resolveNativeDocumentCitations/);
  assert.match(source.workspace, /resolveNativeDocumentCitations/);
  assert.match(source.server, /saved citation snapshot cannot be silently changed/i);
  assert.match(source.server, /community_memberships/);
  assert.match(source.shell, /NativeCitationProvider/);
  assert.match(source.styles, /\.document-bibliography/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "strict native marker and duplicate-ID contracts",
      "hard 100-marker document ceiling",
      "TipTap round-trip and deterministic ordinal ordering",
      "APA, MLA, and Chicago bibliography rendering",
      "server-authorized source canonicalization",
      "exact selected-passage validation and forged-snapshot replacement",
      "post, comment, whole-file, image, PDF, spreadsheet, and presentation source resolution",
      "immutable saved citations after source changes or revocation",
      "mutation rejection, source access failure, and deduplicated validation",
      "post, comment, Office, attachment, Scribble, and Evidence Map integration",
      "hover previews, editor citation tray, bibliography style control, and responsive UI"
    ]
  }, null, 2));
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
