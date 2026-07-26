import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  createCommentInputSchema,
  createPostInputSchema,
  documentCitationMarkerText,
  documentFitsScribbleEditor,
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
import { translatedDocumentForSource } from "@/lib/documentModel";
import { nativeSourceForAssistantCitation } from "@/features/assistant/nativeCitationSource";
import { resolveNativeDocumentCitations } from "@/apps/api/src/services/nativeCitations";
import {
  contentTranslatedDocument,
  contentTranslationSourceSegments
} from "@/apps/api/src/repository/contentTranslations";

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
    endOffset: 60
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
  room: "library",
  contentKind: "paper",
  communityId: null,
  communityVisibility: null,
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
          ? { kind, sheet: "Results", range: "B2:B2" }
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

const clientForAudience = (
  sourceRows: unknown[],
  destinationVisibility: "public" | "private"
) => {
  let calls = 0;
  const client = {
    query: async (sql: string) => {
      calls += 1;
      const rows = sql.includes("SELECT visibility FROM communities")
        ? [{ visibility: destinationVisibility }]
        : sourceRows;
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
assert.equal(
  contentTranslationSourceSegments(markerDocument).some((segment) => segment.text === documentCitationMarkerText),
  false,
  "native markers must never be offered to the translation provider as prose"
);
const translatedMarkerDocument = contentTranslatedDocument(markerDocument, [
  { id: "n0:r0", text: "Le résultat est important" },
  { id: "n0:r1", text: "malicious marker replacement" }
]);
const translatedMarker = documentNativeCitations(translatedMarkerDocument)[0]!;
assert.equal(translatedMarkerDocument.nodes[0]?.type === "paragraph"
  ? translatedMarkerDocument.nodes[0].content[1]?.text
  : null, documentCitationMarkerText);
assert.deepEqual(translatedMarker, citation(), "translation reconstruction must preserve the complete native citation record");
assert.equal(versionedDocumentSchema.safeParse(translatedMarkerDocument).success, true);
const markerParagraph = markerDocument.nodes[0]!;
assert.equal(markerParagraph.type, "paragraph");
if (markerParagraph.type !== "paragraph") {
  throw new Error("marker translation fixture must remain a paragraph");
}
const clientMergedTranslation = translatedDocumentForSource({
  sourceDocument: markerDocument,
  sourceBody: "",
  translatedDocument: {
    ...markerDocument,
    nodes: [{
      ...markerParagraph,
      content: [
        { text: "Translated result" },
        { text: "provider tried to replace the citation" },
        { text: "." }
      ]
    }]
  },
  translatedBody: ""
});
assert.deepEqual(
  documentNativeCitations(clientMergedTranslation)[0],
  citation(),
  "client translation merging must preserve source-owned citation records"
);
assert.equal(clientMergedTranslation.nodes[0]?.type === "paragraph"
  ? clientMergedTranslation.nodes[0].content[1]?.text
  : null, documentCitationMarkerText);
assert.equal(
  documentFitsScribbleEditor(markerDocument),
  false,
  "the Scribble-only document API must reject injected native inline citation records"
);
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

assert.deepEqual(nativeSourceForAssistantCitation({
  title: "Post evidence",
  excerpt: "A selected post passage",
  route: "/posts/paper-1",
  kind: "selection",
  entityType: "post",
  entityId: "paper-1"
}), {
  kind: "post",
  sourceId: "paper-1",
  sourcePostId: "paper-1",
  title: "Post evidence",
  body: "A selected post passage",
  canonicalPath: "/posts/paper-1"
});
assert.deepEqual(nativeSourceForAssistantCitation({
  title: "Embedded comment evidence",
  excerpt: "A comment inside the post context",
  route: "/posts/paper-1?comment=comment-1",
  kind: "comment",
  entityType: "post",
  entityId: "paper-1"
}), {
  kind: "comment",
  sourceId: "comment-1",
  sourcePostId: "paper-1",
  sourceCommentId: "comment-1",
  title: "Embedded comment evidence",
  body: "A comment inside the post context",
  canonicalPath: "/posts/paper-1?comment=comment-1"
});
assert.equal(nativeSourceForAssistantCitation({
  title: "Broken comment evidence",
  excerpt: "Missing its parent route",
  route: "/messages",
  kind: "selection",
  entityType: "comment",
  entityId: "comment-1"
}), null);
assert.deepEqual(nativeSourceForAssistantCitation({
  title: "Selected comment evidence",
  excerpt: "A selected comment passage",
  route: "/posts/paper-1?comment=comment-1",
  kind: "selection",
  entityType: "comment",
  entityId: "comment-1"
}), {
  kind: "comment",
  sourceId: "comment-1",
  sourcePostId: "paper-1",
  sourceCommentId: "comment-1",
  title: "Selected comment evidence",
  body: "A selected comment passage",
  canonicalPath: "/posts/paper-1?comment=comment-1"
});
assert.deepEqual(nativeSourceForAssistantCitation({
  title: "Attachment evidence",
  excerpt: "A selected PDF passage",
  route: "/posts/paper-1?attachment=attachment-1",
  kind: "page",
  entityType: "attachment",
  entityId: "attachment-1"
}), {
  kind: "attachment",
  sourceId: "attachment-1",
  sourcePostId: "paper-1",
  title: "Attachment evidence",
  body: "A selected PDF passage",
  canonicalPath: "/posts/paper-1?attachment=attachment-1"
});
assert.equal(nativeSourceForAssistantCitation({
  title: "Private conversation",
  excerpt: "Private message evidence",
  route: "/messages",
  kind: "message",
  entityType: "conversation",
  entityId: "conversation-1"
}), null, "unsupported private Evidence Map sources must not expose native authoring");
assert.equal(nativeSourceForAssistantCitation({
  title: "AI upload",
  excerpt: "Private upload evidence",
  route: "/assistant",
  kind: "attachment",
  entityType: "assistant_attachment",
  entityId: "attachment-1"
}), null, "private AI uploads must not be misclassified as public post citations");

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
      endOffset: 54
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
        metadata: { previewText: "[PDF page 1]\nOther evidence.\n\n[PDF page 2]\nConfirmed attachment evidence." }
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
            type: "spreadsheet",
            sheets: [{ name: "Results", rows: [["Heading"], ["Label", "spreadsheet-range evidence"]] }]
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
            type: "presentation",
            slides: [
              { title: "Slide one", lines: [] },
              { title: "Slide two", lines: [] },
              { title: "presentation-slide evidence", lines: [] }
            ]
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
    if (testCase.record.locator.kind === "whole") {
      assert.equal(canonicalAttachment.excerpt, testCase.row.fileName);
    }
    if (testCase.record.locator.kind === "image-region") {
      assert.equal(canonicalAttachment.excerpt, `Image region from ${testCase.row.fileName}`);
    }
  }
  const forgedWholeAttachment = attachmentCitation("whole", {
    excerpt: "Invented finding attributed to the file"
  });
  const canonicalWholeAttachment = documentNativeCitations((await resolveNativeDocumentCitations(
    clientReturning([attachmentCases[0].row]).client,
    nativeDocument(forgedWholeAttachment),
    "@author"
  )).document)[0]!;
  assert.equal(
    canonicalWholeAttachment.excerpt,
    attachmentCases[0].row.fileName,
    "whole-file display text must be server-derived rather than client-authored"
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([attachmentCases[2].row]).client,
      nativeDocument(attachmentCitation("pdf-text", { excerpt: "Fabricated PDF result" })),
      "@author"
    ),
    /unavailable/
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([{
        ...attachmentCases[2].row,
        metadata: {
          previewText: "[PDF page 1]\nConfirmed attachment evidence.\n\n[PDF page 2]\nDifferent page evidence."
        }
      }]).client,
      nativeDocument(attachmentCitation("pdf-text")),
      "@author"
    ),
    /unavailable/,
    "an excerpt on another PDF page cannot validate the requested locator"
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([{
        ...attachmentCases[3].row,
        metadata: {
          structuredPreview: {
            type: "spreadsheet",
            sheets: [{ name: "Results", rows: [["spreadsheet-range evidence"], ["Label", "different cell"]] }]
          }
        }
      }]).client,
      nativeDocument(attachmentCitation("spreadsheet-range")),
      "@author"
    ),
    /unavailable/,
    "spreadsheet evidence outside the selected range cannot validate the locator"
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([attachmentCases[3].row]).client,
      nativeDocument(attachmentCitation("spreadsheet-range", {
        locator: { kind: "spreadsheet-range", sheet: "Results", range: "B2:B99" },
        excerpt: "Results B2:B99"
      })),
      "@author"
    ),
    /unavailable/,
    "spreadsheet ranges outside the bounded server preview cannot be represented as verified empty ranges"
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([{
        ...attachmentCases[4].row,
        metadata: {
          structuredPreview: {
            type: "presentation",
            slides: [
              { title: "presentation-slide evidence", lines: [] },
              { title: "Slide two", lines: [] },
              { title: "Different slide evidence", lines: [] }
            ]
          }
        }
      }]).client,
      nativeDocument(attachmentCitation("presentation-slide")),
      "@author"
    ),
    /unavailable/,
    "presentation evidence on another slide cannot validate the locator"
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
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([canonicalPostRow]).client,
      nativeDocument(citation({
        locator: {
          kind: "text",
          startBlockId: "result-block",
          endBlockId: "result-block",
          startOffset: 0,
          endOffset: sourceDocument.nodes[0]?.type === "paragraph"
            ? sourceDocument.nodes[0].content[0]?.text.length
            : 0
        },
        excerpt: "intervention reduced"
      })),
      "@author"
    ),
    /no longer matches/,
    "a precise structured locator cannot point at a broader passage than its excerpt"
  );
  await resolveNativeDocumentCitations(
    clientReturning([canonicalPostRow]).client,
    nativeDocument(citation({
      locator: { kind: "text" }
    })),
    "@author"
  );

  const privateSourceRow = {
    ...canonicalPostRow,
    postType: "thought",
    communityId: "private-community",
    communityVisibility: "private" as const
  };
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([privateSourceRow]).client,
      markerDocument,
      "@author",
      null,
      { communityId: null, postType: "paper" }
    ),
    /narrower audience/
  );
  const samePrivateCommunity = clientForAudience([privateSourceRow], "private");
  await resolveNativeDocumentCitations(
    samePrivateCommunity.client,
    markerDocument,
    "@author",
    null,
    { communityId: "private-community", postType: "thought" }
  );
  assert.equal(samePrivateCommunity.calls(), 2, "one destination audience lookup and one source lookup are sufficient");
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientForAudience([privateSourceRow], "private").client,
      markerDocument,
      "@author",
      null,
      { communityId: "different-private-community", postType: "thought" }
    ),
    /narrower audience/
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientForAudience([privateSourceRow], "public").client,
      markerDocument,
      "@author",
      null,
      { communityId: "private-community", postType: "thought" }
    ),
    /narrower audience/
  );
  await resolveNativeDocumentCitations(
    clientForAudience([canonicalPostRow], "private").client,
    markerDocument,
    "@author",
    null,
    { communityId: "private-community", postType: "thought" }
  );
  await resolveNativeDocumentCitations(
    clientReturning([{
      ...privateSourceRow,
      postType: "paper"
    }]).client,
    markerDocument,
    "@author",
    null,
    { communityId: null, postType: "paper" }
  );
  const privateDraftSourceRow = {
    ...canonicalPostRow,
    postType: "thought",
    room: "office",
    contentKind: "draft"
  };
  await resolveNativeDocumentCitations(
    clientReturning([privateDraftSourceRow]).client,
    markerDocument,
    "@author"
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientReturning([privateDraftSourceRow]).client,
      markerDocument,
      "@author",
      null,
      { communityId: null, postType: "thought" }
    ),
    /narrower audience/
  );
  await assert.rejects(
    resolveNativeDocumentCitations(
      clientForAudience([privateDraftSourceRow], "private").client,
      markerDocument,
      "@author",
      null,
      { communityId: "private-community", postType: "thought" }
    ),
    /narrower audience/
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
    assistantSource: readFileSync("features/assistant/nativeCitationSource.ts", "utf8"),
    posts: readFileSync("apps/api/src/repository/posts.ts", "utf8"),
    comments: readFileSync("apps/api/src/repository/comments.ts", "utf8"),
    workspace: readFileSync("apps/api/src/repository/workspaceDocuments.ts", "utf8"),
    workspaceComments: readFileSync("apps/api/src/repository/workspaceComments.ts", "utf8"),
    workspacePublication: readFileSync("apps/api/src/services/workspacePublicationState.ts", "utf8"),
    server: readFileSync("apps/api/src/services/nativeCitations.ts", "utf8"),
    shell: readFileSync("components/SymposiumV0.tsx", "utf8"),
    styles: readFileSync("styles/94-native-citations.css", "utf8")
  };

  assert.match(source.contracts, /documentNativeCitationSchema/);
  assert.match(source.contracts, /at most 100 native citation markers/);
  assert.match(source.editor, /symposiumInlineCitation/);
  assert.match(source.editor, /Bibliography style/);
  assert.match(source.renderer, /document-inline-citation-preview/);
  assert.match(source.renderer, /aria-describedby/);
  assert.match(source.renderer, /documentCitationBibliographyEntry/);
  assert.match(source.capture, /pendingCitation/);
  assert.match(source.capture, /aria-live="polite"/);
  assert.match(source.scribble, /Cite in draft/);
  assert.match(source.attachments, /onNativeCapture/);
  assert.match(source.assistant, /Stage this evidence as a native citation/);
  assert.match(source.assistantSource, /entityType === "attachment"/);
  assert.match(source.assistantSource, /citation\.kind === "comment"/);
  assert.match(source.posts, /resolveNativeDocumentCitations/);
  assert.match(source.comments, /resolveNativeDocumentCitations/);
  assert.match(source.workspace, /resolveNativeDocumentCitations/);
  assert.match(source.workspaceComments, /resolveNativeDocumentCitations/);
  assert.match(source.workspaceComments, /newCitationCount/);
  assert.match(source.workspacePublication, /publishedDiscussionCitationCount/);
  assert.match(source.workspacePublication, /resolveNativeDocumentCitations/);
  assert.match(source.server, /saved citation snapshot cannot be silently changed/i);
  assert.match(source.server, /community_memberships/);
  assert.match(source.server, /narrower audience than this destination/i);
  assert.match(source.posts, /communityId: item\.communityId/);
  assert.match(source.comments, /communityId: lockedItem\.communityId/);
  assert.match(source.shell, /NativeCitationProvider/);
  assert.match(source.styles, /\.document-bibliography/);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "strict native marker and duplicate-ID contracts",
      "hard 100-marker document ceiling",
      "TipTap round-trip and deterministic ordinal ordering",
      "translation-provider exclusion and byte-stable native marker reconstruction",
      "APA, MLA, and Chicago bibliography rendering",
      "server-authorized source canonicalization",
      "public and same-community audience containment",
      "exact selected-passage validation and forged-snapshot replacement",
      "post, comment, whole-file, image, PDF, spreadsheet, and presentation source resolution",
      "immutable saved citations after source changes or revocation",
      "mutation rejection, source access failure, and deduplicated validation",
      "post, comment, Office document, Office discussion, attachment, Scribble, and Evidence Map integration",
      "Evidence Map post, embedded-comment, selected-comment, attachment, and private-source classification",
      "hover previews, editor citation tray, bibliography style control, and responsive UI"
    ]
  }, null, 2));
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
