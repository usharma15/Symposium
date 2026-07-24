import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actualCostMicros, conservativeInputTokenCeiling, reserveCostMicros, usdToMicros } from "@/apps/api/src/services/aiBudget";
import { assistantDailyLimitFor } from "@/apps/api/src/services/assistantQuota";
import { assistantQuotaAfterReservation } from "@/apps/api/src/services/assistantUsage";
import {
  assistantInstructions,
  assistantMaxOutputTokens,
  assistantPrompt,
  assistantProviderFailure,
  assistantRenderedInput,
  assistantTranslationInstructions,
  contentTranslationInstructions,
  contentTranslationMaxOutputTokens,
  contentTranslationResponseFormat,
  contentTranslationRenderedInput,
  documentTranslationInstructions,
  documentTranslationMaxOutputTokens,
  documentTranslationRequestContent,
  documentTranslationResponseFormat,
  documentTranslationRenderedInput,
  restoreTranslationSegmentOrder
} from "@/apps/api/src/services/openaiResponses";
import { contentTranslationFingerprint } from "@/apps/api/src/repository/contentTranslations";
import {
  documentTranslationFingerprint,
  supportedLanguageFromInstruction
} from "@/apps/api/src/repository/documentTranslations";
import {
  assistantContextUpdateInputSchema,
  assistantMessageInputSchema,
  assistantSourceUpdateInputSchema,
  assistantQuickNoteResultSchema,
  assistantResponseSchema,
  assistantTranslationDraftSchema,
  saveAssistantQuickNoteInputSchema,
  documentTranslationInputSchema,
  documentTranslationModelOutputSchema,
  documentTranslationPageSchema,
  documentTranslationResultSchema,
  contentTranslationInputSchema,
  contentTranslationModelOutputSchema,
  contentTranslationResultSchema
} from "@/packages/contracts/src";
import { buildTabletAttachmentContext, tabletAttachmentTextLimit } from "@/features/assistant/tabletAttachmentContext";
import {
  pdfPageNeedsVisualTranslationFallback,
  pdfTextItemsToPlainText,
  resolvePdfDocumentUrl
} from "@/features/attachments/pdfAttachmentClient";
import {
  pdfTranslationSegmentsFromTextContent,
  visionLayoutToPdfBlock
} from "@/features/attachments/AttachmentViews";
import {
  documentViewerSessionSnapshot,
  readDocumentReadingPosition,
  reapplyDocumentReadingPosition,
  rememberDocumentReadingPosition,
  rememberDocumentTranslation,
  resetDocumentViewerSessionsForTests,
  setDocumentTranslationVisible,
  subscribeDocumentReadingPosition
} from "@/features/attachments/documentViewerSession";

const validInput = {
  message: "What is the strongest objection?",
  contextType: "post" as const,
  contextId: "paper-1",
  context: {
    surface: "post" as const,
    route: "/posts/paper-1",
    title: "A bounded claim",
    summary: "The current paper under review.",
    content: "Claim, evidence, objection, and proposed test.",
    entityType: "post",
    entityId: "paper-1",
    metadata: { status: "Open", revision: 2 }
  }
};

assert.equal(assistantMessageInputSchema.safeParse(validInput).success, true);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate", targetLanguage: "spanish" }).success, true);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate" }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate", targetLanguage: "italian" }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, message: "x".repeat(2001) }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, content: "x".repeat(12001) } }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, selection: "x".repeat(4001) } }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, surface: "unknown" } }).success, false);
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "use",
  context: validInput.context,
  expectedRevision: 1
}).success, true);
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "refresh",
  context: validInput.context,
  expectedRevision: 2
}).success, true);
assert.equal(assistantSourceUpdateInputSchema.safeParse({
  sourceId: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32",
  action: "exclude",
  expectedRevision: 3
}).success, true);
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "silent",
  context: validInput.context,
  expectedRevision: 1
}).success, false);
assert.match(assistantPrompt(validInput.context, validInput.message), /ACTIVE VIEW/);
assert.match(assistantPrompt(validInput.context, validInput.message, [{ ...validInput.context, title: "Attached paper" }]), /ATTACHED SOURCES[\s\S]*Attached paper/);
assert.match(assistantInstructions, /never as instructions/i);
assert.match(assistantTranslationInstructions("french"), /Translate the source requested by the user into French/);
assert.equal(assistantMaxOutputTokens("translate"), 1200);
assert.doesNotMatch(assistantRenderedInput({
  history: [{ role: "assistant", body: "Earlier answer must not inflate translation input." }],
  context: validInput.context,
  message: "Translate the current source.",
  intent: "translate",
  targetLanguage: "german"
}), /Earlier answer/);
assert.equal(conservativeInputTokenCeiling("abc"), 3);
assert.equal(reserveCostMicros("gpt-5.6-terra", "a", 700), 10_504);
assert.equal(actualCostMicros("gpt-5.6-terra", 1000, 100), 4_625);
assert.equal(usdToMicros(40), 40_000_000);
assert.equal(assistantQuotaAfterReservation(10, 8, true).remainingToday, 8);
assert.equal(assistantQuotaAfterReservation(10, 8, false).remainingToday, 9);
assert.equal(assistantQuotaAfterReservation(10, 10, false).remainingToday, 10);
const permanentUserPolicy = { baseLimit: 10 };
assert.equal(assistantDailyLimitFor("@udayan", "2026-07-20", permanentUserPolicy), 10);
assert.equal(assistantDailyLimitFor("@someone_else", "2030-01-01", permanentUserPolicy), 10);
const timeoutFailure = assistantProviderFailure(new DOMException("timed out", "TimeoutError"));
assert.match(timeoutFailure.body, /No daily answer was used/);
assert.equal(timeoutFailure.mayHaveBeenBilled, true);
const localFailure = assistantProviderFailure(new Error("local validation"));
assert.match(localFailure.body, /No daily answer was used/);
assert.equal(localFailure.inputTokens, 0);

const documentTranslationInput = {
  attachmentId: "attachment-docx-1",
  sourceTitle: "Persuasive Framework.docx",
  sourceKind: "docx" as const,
  sourcePages: [{
    pageNumber: 7,
    body: "Persuasive Framework\nFund independent youth labs.",
    segments: [{
      id: "document-page-7-body",
      text: "Persuasive Framework\nFund independent youth labs."
    }]
  }],
  sourceComplete: true,
  languageInstruction: "Please put this into Spanish"
};
assert.equal(documentTranslationInputSchema.safeParse(documentTranslationInput).success, true);
assert.equal(documentTranslationInputSchema.safeParse({
  ...documentTranslationInput,
  sourceKind: "document"
}).success, true);
assert.equal(documentTranslationInputSchema.safeParse({
  ...documentTranslationInput,
  sourcePages: [
    ...documentTranslationInput.sourcePages,
    {
      pageNumber: 8,
      body: "Evidence and objections.",
      segments: [{ id: "document-page-8-body", text: "Evidence and objections." }]
    }
  ]
}).success, false);
assert.equal(documentTranslationInputSchema.safeParse({
  ...documentTranslationInput,
  sourcePages: [{
    pageNumber: 1,
    body: "x".repeat(12_001),
    segments: [{ id: "document-page-1-body", text: "x".repeat(12_001) }]
  }]
}).success, false);
const scannedPdfTranslationInput = {
  ...documentTranslationInput,
  attachmentId: "attachment-pdf-scan-1",
  sourceKind: "pdf" as const,
  sourcePages: [{
    pageNumber: 1,
    body: "",
    segments: [{ id: "document-page-1-visual", text: "" }],
    imageDataUrl: "data:image/jpeg;base64,YWJj"
  }]
};
assert.equal(documentTranslationInputSchema.safeParse(scannedPdfTranslationInput).success, true);
assert.equal(documentTranslationInputSchema.safeParse({
  ...scannedPdfTranslationInput,
  sourcePages: [{ pageNumber: 1, body: "", segments: [] }]
}).success, false);
assert.equal(documentTranslationInputSchema.safeParse({
  ...scannedPdfTranslationInput,
  sourcePages: [{
    pageNumber: 1,
    body: "",
    segments: [{ id: "document-page-1-visual", text: "" }],
    imageDataUrl: "data:text/html;base64,YWJj"
  }]
}).success, false);
assert.equal(supportedLanguageFromInstruction("English"), "english");
assert.equal(supportedLanguageFromInstruction("en français, s’il vous plaît"), "french");
assert.equal(supportedLanguageFromInstruction("auf Deutsch"), "german");
assert.equal(supportedLanguageFromInstruction("en español"), "spanish");
assert.equal(supportedLanguageFromInstruction("Italian"), null);
assert.equal(supportedLanguageFromInstruction("French or Spanish"), null);
assert.match(documentTranslationInstructions, /one supplied source page/i);
assert.match(documentTranslationInstructions, /source language may be any language/i);
assert.match(documentTranslationRenderedInput(documentTranslationInput), /LANGUAGE INSTRUCTION/);
assert.doesNotMatch(documentTranslationRenderedInput(scannedPdfTranslationInput), /data:image/);
assert.ok(documentTranslationRenderedInput(scannedPdfTranslationInput).length > 12_000);
assert.deepEqual(documentTranslationRequestContent(documentTranslationInput).map((item) => item.type), ["input_text"]);
assert.deepEqual(documentTranslationRequestContent(scannedPdfTranslationInput).map((item) => item.type), ["input_text", "input_image"]);
assert.doesNotMatch(
  JSON.stringify(documentTranslationResponseFormat()),
  /minItems|maxItems|minimum|maximum/
);
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) >= 800);
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) <= 7000);
assert.equal(documentTranslationMaxOutputTokens(scannedPdfTranslationInput), 7000);
assert.equal(pdfPageNeedsVisualTranslationFallback("Short title"), true);
assert.equal(pdfPageNeedsVisualTranslationFallback("x".repeat(200)), false);
assert.deepEqual(
  pdfTranslationSegmentsFromTextContent(2, {
    items: [
      { str: "The vital assumption", hasEOL: false },
      { str: "is locality.", hasEOL: true },
      { str: "E(a,b) = -a · b", hasEOL: true },
      { str: "III. Illustration", hasEOL: true }
    ]
  }),
  [
    { id: "pdf-2-line-0", text: "The vital assumption is locality." },
    { id: "pdf-2-line-1", text: "III. Illustration" }
  ]
);
assert.deepEqual(
  restoreTranslationSegmentOrder(
    [{ id: "a", text: "First" }, { id: "b", text: "Second" }],
    [{ id: "b", text: "Deuxième" }, { id: "a", text: "Premier" }]
  ),
  [{ id: "a", text: "Premier" }, { id: "b", text: "Deuxième" }]
);
assert.equal(
  restoreTranslationSegmentOrder(
    [{ id: "a", text: "First" }, { id: "b", text: "Second" }],
    [{ id: "a", text: "Premier" }, { id: "a", text: "Encore" }]
  ),
  null
);
assert.equal(
  restoreTranslationSegmentOrder(
    [{ id: "a", text: "First" }, { id: "b", text: "Second" }],
    [{ id: "a", text: "Premier" }]
  ),
  null
);
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Marco persuasivo",
  pages: [{
    pageNumber: 7,
    segments: [{ id: "document-page-7-body", text: "Marco persuasivo\nFinanciar laboratorios juveniles independientes." }],
    layoutBlocks: [{
      id: "visual-7-heading",
      role: "heading",
      text: "Marco persuasivo",
      x: 120,
      y: 90,
      width: 760,
      height: 80,
      fontScale: "lg",
      align: "center"
    }],
    preservedArtifacts: []
  }],
  message: "Spanish translation ready."
}).success, true);
const outOfBoundsModelTranslation = documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Fuera de página",
  pages: [{
    pageNumber: 7,
    segments: [{ id: "document-page-7-body", text: "Fuera de página" }],
    layoutBlocks: [{
      id: "visual-7-invalid",
      role: "paragraph",
      text: "Fuera de página",
      x: 900,
      y: 100,
      width: 200,
      height: 100,
      fontScale: "md",
      align: "left"
    }],
    preservedArtifacts: []
  }],
  message: "Spanish translation ready."
});
assert.equal(outOfBoundsModelTranslation.success, true);
if (!outOfBoundsModelTranslation.success) throw new Error("Expected model geometry to normalize.");
assert.equal(outOfBoundsModelTranslation.data.pages[0]?.layoutBlocks[0]?.x, 900);
assert.equal(outOfBoundsModelTranslation.data.pages[0]?.layoutBlocks[0]?.width, 100);
assert.equal(outOfBoundsModelTranslation.data.pages[0]?.layoutBlocks[0]?.id, "page-7-layout-0");
assert.equal(documentTranslationPageSchema.safeParse({
  pageNumber: 7,
  body: "Fuera de página",
  segments: [{ id: "document-page-7-body", text: "Fuera de página" }],
  layoutBlocks: [{
    id: "visual-7-invalid",
    role: "paragraph",
    text: "Fuera de página",
    x: 900,
    y: 100,
    width: 200,
    height: 100,
    fontScale: "md",
    align: "left"
  }],
  preservedArtifacts: []
}).success, false);
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Bloques superpuestos",
  pages: [{
    pageNumber: 7,
    segments: [{ id: "document-page-7-body", text: "Bloques superpuestos" }],
    layoutBlocks: [
      {
        id: "visual-7-paragraph-1",
        role: "paragraph",
        text: "Primer bloque",
        x: 100,
        y: 100,
        width: 500,
        height: 250,
        fontScale: "md",
        align: "left"
      },
      {
        id: "visual-7-paragraph-2",
        role: "paragraph",
        text: "Segundo bloque",
        x: 120,
        y: 120,
        width: 450,
        height: 200,
        fontScale: "md",
        align: "left"
      }
    ],
    preservedArtifacts: []
  }],
  message: "Spanish translation ready."
}).success, true);
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Artefacto superpuesto",
  pages: [{
    pageNumber: 7,
    segments: [{ id: "document-page-7-body", text: "Artefacto superpuesto" }],
    layoutBlocks: [{
      id: "visual-7-paragraph",
      role: "paragraph",
      text: "Texto traducido",
      x: 100,
      y: 100,
      width: 500,
      height: 250,
      fontScale: "md",
      align: "left"
    }],
    preservedArtifacts: [{
      id: "visual-7-equation",
      role: "equation",
      x: 120,
      y: 120,
      width: 400,
      height: 180
    }]
  }],
  message: "Spanish translation ready."
}).success, true);
const reconstructedPdfBlock = visionLayoutToPdfBlock({
  id: "visual-10-paragraph-1",
  role: "paragraph",
  text: "Translated paragraph",
  x: 100,
  y: 200,
  width: 800,
  height: 250,
  fontScale: "md",
  align: "justify"
}, 600, 900);
assert.equal(reconstructedPdfBlock.left, 60);
assert.equal(reconstructedPdfBlock.top, 180);
assert.equal(reconstructedPdfBlock.width, 480);
assert.equal(reconstructedPdfBlock.height, 225);
assert.ok(Math.abs(reconstructedPdfBlock.fontSize - 10.8) < 0.0001);
assert.equal(reconstructedPdfBlock.align, "justify");
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "unsupported",
  targetLanguageLabel: "",
  translatedTitle: "",
  pages: [{ pageNumber: 1, segments: [{ id: "document-page-1-body", text: "Not allowed" }] }],
  message: "Use a supported language."
}).success, false);
const sourceFingerprint = documentTranslationFingerprint(documentTranslationInput);
assert.match(sourceFingerprint, /^[a-f0-9]{64}$/);
assert.equal(sourceFingerprint, documentTranslationFingerprint(documentTranslationInput));
assert.notEqual(sourceFingerprint, documentTranslationFingerprint({ ...documentTranslationInput, sourceComplete: false }));
assert.notEqual(sourceFingerprint, documentTranslationFingerprint({
  ...documentTranslationInput,
  sourcePages: documentTranslationInput.sourcePages.map((page) => ({
    ...page,
    imageDataUrl: "data:image/png;base64,AA=="
  }))
}));
const validDocumentTranslationResult = documentTranslationResultSchema.parse({
  status: "translated",
  attachmentId: documentTranslationInput.attachmentId,
  sourceFingerprint,
  sourceComplete: true,
  cached: false,
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Marco persuasivo",
  pages: [{ pageNumber: 7, body: "Marco persuasivo", segments: [{ id: "document-page-7-body", text: "Marco persuasivo" }] }],
  message: "Spanish translation ready.",
  model: "gpt-5.6-terra",
  createdAt: new Date().toISOString(),
  quota: { dailyLimit: 10, remainingToday: 9, monthlyBudgetUsd: 40, extremelyLimited: true }
});
resetDocumentViewerSessionsForTests();
rememberDocumentTranslation(documentTranslationInput.attachmentId, validDocumentTranslationResult);
assert.equal(
  documentViewerSessionSnapshot(documentTranslationInput.attachmentId).resultsByPage[7],
  validDocumentTranslationResult
);
assert.equal(
  documentViewerSessionSnapshot(documentTranslationInput.attachmentId).translatedVisiblePages.has(7),
  true
);
setDocumentTranslationVisible(documentTranslationInput.attachmentId, 7, false);
assert.equal(
  documentViewerSessionSnapshot(documentTranslationInput.attachmentId).translatedVisiblePages.has(7),
  false
);
let observedPositionPage = 0;
let observedPositionCount = 0;
const unsubscribePosition = subscribeDocumentReadingPosition(
  documentTranslationInput.attachmentId,
  (position) => {
    observedPositionPage = position.pageNumber;
    observedPositionCount += 1;
  }
);
rememberDocumentReadingPosition(documentTranslationInput.attachmentId, {
  pageNumber: 3,
  pageProgress: 0.42
}, "assistant-boundary-check");
assert.equal(observedPositionPage, 3);
assert.deepEqual(readDocumentReadingPosition(documentTranslationInput.attachmentId), {
  pageNumber: 3,
  pageProgress: 0.42
});
reapplyDocumentReadingPosition(documentTranslationInput.attachmentId, {
  pageNumber: 3,
  pageProgress: 0.42
}, "assistant-boundary-reapply");
assert.equal(observedPositionCount, 2);
unsubscribePosition();
resetDocumentViewerSessionsForTests();

const contentTranslationModelInput = {
  sourceType: "post" as const,
  sourceId: "paper-1",
  sourceRevision: 2,
  sourceTitle: "A bounded claim",
  sourceBody: "Claim, evidence, objection, and proposed test.",
  sourceDocument: {
    version: 1 as const,
    nodes: [{ id: "claim", type: "paragraph" as const, content: [{ text: "Claim, evidence, objection, and proposed test." }], align: "left" as const, indent: 0 }],
    settings: { width: "standard" as const, margin: "normal" as const }
  },
  sourceSegments: [{ id: "n0:r0", text: "Claim, evidence, objection, and proposed test." }],
  languageInstruction: "French"
};
assert.equal(contentTranslationInputSchema.safeParse({
  sourceType: "post",
  sourceId: "paper-1",
  languageInstruction: "French"
}).success, true);
assert.match(contentTranslationInstructions, /complete Symposium post or comment/i);
assert.match(contentTranslationRenderedInput(contentTranslationModelInput), /SOURCE CONTENT/);
assert.doesNotMatch(
  JSON.stringify(contentTranslationResponseFormat),
  /minItems|maxItems|minimum|maximum/
);
assert.ok(contentTranslationMaxOutputTokens(contentTranslationModelInput) >= 600);
assert.ok(contentTranslationMaxOutputTokens(contentTranslationModelInput) <= 6000);
assert.equal(contentTranslationModelOutputSchema.safeParse({
  targetLanguage: "french",
  targetLanguageLabel: "French",
  translatedTitle: "Une affirmation circonscrite",
  translatedSegments: [{ id: "n0:r0", text: "Affirmation, preuve, objection et test proposé." }],
  message: "French translation ready."
}).success, true);
assert.equal(contentTranslationModelOutputSchema.safeParse({
  targetLanguage: "unsupported",
  targetLanguageLabel: "",
  translatedTitle: "Not allowed",
  translatedSegments: [],
  message: "Use a supported language."
}).success, false);
const contentFingerprint = contentTranslationFingerprint(contentTranslationModelInput);
assert.match(contentFingerprint, /^[a-f0-9]{64}$/);
assert.notEqual(contentFingerprint, contentTranslationFingerprint({ ...contentTranslationModelInput, sourceRevision: 3 }));
assert.equal(contentTranslationResultSchema.safeParse({
  status: "translated",
  sourceType: "post",
  sourceId: "paper-1",
  sourceRevision: 2,
  sourceFingerprint: contentFingerprint,
  cached: false,
  targetLanguage: "french",
  targetLanguageLabel: "French",
  translatedTitle: "Une affirmation circonscrite",
  translatedBody: "Affirmation, preuve, objection et test proposé.",
  translatedDocument: {
    version: 1,
    nodes: [{ id: "claim", type: "paragraph", content: [{ text: "Affirmation, preuve, objection et test proposé." }], align: "left", indent: 0 }],
    settings: { width: "standard", margin: "normal" }
  },
  message: "French translation ready.",
  model: "gpt-5.6-terra",
  createdAt: new Date().toISOString(),
  quota: { dailyLimit: 10, remainingToday: 9, monthlyBudgetUsd: 40, extremelyLimited: true }
}).success, true);

const docxContext = buildTabletAttachmentContext({
  id: "attachment-1",
  fileName: "Persuasive Framework.docx",
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byteSize: 19_207,
  status: "uploaded",
  kind: "document",
  metadata: { pageCount: 1, previewText: "Persuasive Framework Template\nFund independent youth labs." }
});
assert.match(docxContext, /Extracted attachment text:\nPersuasive Framework Template/);
assert.match(docxContext, /Pages or preview segments: 1/);
assert.ok(docxContext.length < tabletAttachmentTextLimit + 500);

const pdfContext = buildTabletAttachmentContext({
  id: "attachment-2",
  fileName: "paper.pdf",
  contentType: "application/pdf",
  byteSize: 61_907,
  status: "uploaded",
  kind: "pdf",
  metadata: { pageCount: 13 }
});
assert.match(pdfContext, /contents are not extracted/i);

const activePdfContext = buildTabletAttachmentContext({
  id: "attachment-2",
  fileName: "paper.pdf",
  contentType: "application/pdf",
  byteSize: 61_907,
  status: "uploaded",
  kind: "pdf",
  metadata: { pageCount: 13 }
}, {
  attachmentId: "attachment-2",
  fileName: "paper.pdf",
  page: 7,
  pageCount: 13,
  currentPageText: "The active page establishes the primary result.",
  previousPageText: "The method begins on page six.",
  nextPageText: "The limitations continue on page eight.",
  selectedText: "primary result",
  status: "ready"
});
assert.match(activePdfContext, /Currently viewing PDF page 7 of 13/);
assert.match(activePdfContext, /Current page 7 text:\nThe active page establishes the primary result/);
assert.match(activePdfContext, /Previous page 6 context/);
assert.match(activePdfContext, /Next page 8 context/);
assert.ok(activePdfContext.length <= tabletAttachmentTextLimit);
assert.equal(pdfTextItemsToPlainText([
  { str: "Grounded", hasEOL: false },
  { str: "PDF context.", hasEOL: true },
  { str: "Second line", hasEOL: true }
]), "Grounded PDF context.\nSecond line");
const previousPublicAttachmentBaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = "https://public-files.example";
assert.equal(
  resolvePdfDocumentUrl("https://public-files.example/post/paper.pdf", "https://www.symposiumsci.com/posts/paper"),
  "https://www.symposiumsci.com/attachment-assets/post/paper.pdf"
);
assert.equal(
  resolvePdfDocumentUrl("https://other-files.example/paper.pdf", "https://www.symposiumsci.com/posts/paper"),
  "https://other-files.example/paper.pdf"
);
if (previousPublicAttachmentBaseUrl === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
else process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = previousPublicAttachmentBaseUrl;

assert.equal(assistantResponseSchema.safeParse({
  conversationId: "conversation",
  providerConfigured: true,
  status: "answered",
  model: "gpt-5.6-terra",
  quota: { dailyLimit: 3, remainingToday: 2, monthlyBudgetUsd: 40, extremelyLimited: true },
  message: { id: "message", conversationId: "conversation", role: "assistant", body: "Answer" }
}).success, true);
const quickNote = {
  title: "Strategy 2032 argument",
  body: "The visible page argues for independent youth labs and a metascience group.",
  source: { surface: "attachment" as const, route: "/posts/paper-1?attachment=attachment-1", title: "Strategy 2032.pdf", entityType: "attachment", entityId: "attachment-1" }
};
assert.equal(assistantResponseSchema.safeParse({
  conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
  providerConfigured: true,
  status: "answered",
  message: { id: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32", conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b", role: "assistant", body: "Quick Note ready." },
  quickNote
}).success, true);
const translation = {
  translatedTitle: "Un argumento acotado",
  translatedBody: "Afirmación, evidencia, objeción y prueba propuesta.",
  quickNoteTitle: "Nota sobre un argumento acotado",
  quickNoteBody: "La fuente separa la afirmación de la objeción.",
  targetLanguage: "spanish" as const,
  source: { surface: "post" as const, route: "/posts/paper-1", title: "A bounded claim", entityType: "post", entityId: "paper-1" }
};
assert.equal(assistantTranslationDraftSchema.safeParse(translation).success, true);
assert.equal(assistantResponseSchema.safeParse({
  conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
  providerConfigured: true,
  status: "answered",
  model: "gpt-5.6-terra",
  quota: { dailyLimit: 3, remainingToday: 2, monthlyBudgetUsd: 40, extremelyLimited: true },
  message: { id: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32", conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b", role: "assistant", body: "Spanish translation ready." },
  translation
}).success, true);
assert.equal(saveAssistantQuickNoteInputSchema.safeParse({
  assistantMessageId: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32",
  conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
  title: translation.quickNoteTitle,
  body: translation.quickNoteBody,
  targetLanguage: translation.targetLanguage,
  source: translation.source
}).success, true);
assert.equal(assistantQuickNoteResultSchema.safeParse({
  id: "df44a21f-e540-48ea-9f40-7e6b4c3bd753",
  title: translation.quickNoteTitle,
  revision: 1,
  createdAt: new Date().toISOString(),
  notebookId: null,
  notebookName: null,
  href: "/workspace?view=notes&note=df44a21f-e540-48ea-9f40-7e6b4c3bd753"
}).success, true);

const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
const usageService = readFileSync("apps/api/src/services/assistantUsage.ts", "utf8");
const documentRepository = readFileSync("apps/api/src/repository/documentTranslations.ts", "utf8");
const contentRepository = readFileSync("apps/api/src/repository/contentTranslations.ts", "utf8");
const scribbles = readFileSync("apps/api/src/repository/workspaceScribbles.ts", "utf8");
const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const route = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const tablet = readFileSync("features/workspace/WorkspacePanels.tsx", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const attachmentContext = readFileSync("features/assistant/tabletAttachmentContext.ts", "utf8");
const attachmentViews = readFileSync("features/attachments/AttachmentViews.tsx", "utf8");
const documentTranslationControl = readFileSync("features/attachments/DocumentTranslationControl.tsx", "utf8");
const documentViewerSession = readFileSync("features/attachments/documentViewerSession.ts", "utf8");
const contentTranslationControl = readFileSync("features/translation/ContentTranslationControl.tsx", "utf8");
const tabletStyles = readFileSync("styles/92-ai-tablet.css", "utf8");
const postViews = readFileSync("features/posts/PostViews.tsx", "utf8");
const commentThread = readFileSync("features/comments/CommentThread.tsx", "utf8");
const attachmentModal = readFileSync("features/attachments/AttachmentPreviewModal.tsx", "utf8");
const pdfClient = readFileSync("features/attachments/pdfAttachmentClient.ts", "utf8");
const attachmentStyles = readFileSync("styles/20-legacy-content.css", "utf8");
const packageManifest = readFileSync("package.json", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const renderBlueprint = readFileSync("render.yaml", "utf8");
const env = readFileSync("apps/api/src/config/env.ts", "utf8");
const restoreViewStart = shell.indexOf("const restoreView");
const navigateViewStart = shell.indexOf("const navigateView", restoreViewStart);
const restoreViewBlock = shell.slice(restoreViewStart, navigateViewStart);
const navigateViewBlock = shell.slice(navigateViewStart, shell.indexOf("const enterRoom", navigateViewStart));

assert.match(provider, /store: false/);
assert.match(provider, /service_tier: "default"/);
assert.match(provider, /max_output_tokens: assistantMaxOutputTokens\(input\.intent\)/);
assert.match(provider, /type: "json_schema"/);
assert.match(provider, /strict: true/);
assert.match(provider, /symposium-translation-v1/);
assert.match(provider, /prompt_cache_key: translating \? "symposium-translation-v1" : "symposium-contextual-tablet-v3"/);
assert.match(provider, /reasoning: \{ effort: "none" \}/);
assert.match(provider, /symposium-document-page-translation-v6/);
assert.match(provider, /symposium-content-translation-v3/);
assert.match(provider, /documentTranslationRequestContent\(input\.request\)/);
assert.match(provider, /insufficient_quota/);
assert.match(repository, /providerErrorCode/);
assert.match(usageService, /pg_advisory_xact_lock\(hashtextextended\('symposium:ai-budget'/);
assert.doesNotMatch(usageService, /userMinute|two attempts per minute/);
assert.match(usageService, /current\.inFlight >= 1/);
assert.match(usageService, /status IN \('reserved', 'completed'\)/);
assert.match(repository, /getAssistantQuota/);
assert.match(repository, /SYMPOSIUM_AI_USER_DAILY_LIMIT/);
assert.match(repository, /assistantQuotaAfterReservation\(prepared\.dailyLimit, prepared\.remainingToday, !providerError\)/);
assert.doesNotMatch(repository, /failed beta attempt still uses one daily answer/);
assert.match(usageService, /SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT/);
assert.match(usageService, /SYMPOSIUM_AI_DAILY_BUDGET_USD/);
assert.match(usageService, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD/);
assert.match(usageService, /created_at >= quota_reset\.reset_at/);
assert.match(usageService, /monthlyCostMicros/);
assert.match(usageService, /CASE WHEN status = 'reserved' THEN reserved_cost_micros ELSE actual_cost_micros END/);
assert.match(migration, /0037_ai_usage_budget_ledger/);
assert.match(migration, /reserved_cost_micros BIGINT NOT NULL/);
assert.match(migration, /0038_document_translation_cache/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS document_translations/);
assert.match(migration, /0040_owner_daily_ai_quota_reset/);
assert.match(migration, /INSERT INTO ai_daily_quota_resets[\s\S]*SELECT 'udayan', current_date, now\(\)/);
assert.match(migration, /0049_assistant_research_threads/);
assert.match(migration, /context_sources JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
assert.match(migration, /0050_assistant_context_dock_translation/);
assert.match(migration, /0051_translation_layout_fidelity/);
assert.match(migration, /0052_document_view_continuity/);
assert.match(migration, /0053_failed_ai_usage_accounting/);
assert.match(migration, /actual_cost_micros = 0[\s\S]*error_code IN/);
assert.match(migration, /kind TEXT NOT NULL DEFAULT 'research_thread'/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS content_translations/);
assert.match(repository, /listAssistantConversations/);
assert.match(repository, /getAssistantConversation/);
assert.match(repository, /updateAssistantConversationContext/);
assert.match(repository, /updateAssistantConversationSource/);
assert.match(repository, /assistant\.context\.updated/);
assert.match(repository, /kind = 'research_thread'/);
assert.match(repository, /origin_source_id/);
assert.match(repository, /evidenceForSources/);
assert.match(repository, /attachedContexts/);
assert.match(route, /shared: true, scope: "assistant", limit: 10/);
assert.match(route, /\/v1\/assistant\/conversations\/:id\/context/);
assert.match(route, /\/v1\/assistant\/conversations\/:id\/sources/);
assert.match(route, /\/v1\/assistant\/document-translations/);
assert.match(route, /\/v1\/assistant\/content-translations/);
assert.match(route, /\/v1\/assistant\/quick-notes/);
assert.match(route, /scope: "assistant-action", limit: 30/);
assert.match(scribbles, /conversation\.owner_handle = \$3/);
assert.match(scribbles, /assistant\.quick_note\.create/);
assert.match(scribbles, /assistant_quick_note/);
assert.match(tablet, /Extremely limited beta/);
assert.match(tablet, /Loading today’s tiny AI allowance/);
assert.match(tablet, /Send · uses 1/);
assert.match(tablet, /Ask about this view/);
assert.match(tablet, /Confirm & save Quick Note/);
assert.match(tablet, /Office destination/);
assert.match(tablet, /All · Quick Notes/);
assert.match(tablet, /Create & select/);
assert.match(tablet, /New research thread/);
assert.match(tablet, /Context Dock/);
assert.match(tablet, /Live view/);
assert.match(tablet, /Capture update/);
assert.match(tablet, /Use live view/);
assert.match(tablet, /Add source/);
assert.match(tablet, /Used \{message\.evidence\.length\} source/);
assert.match(provider, /shouldOfferQuickNote/);
assert.doesNotMatch(tablet, /Opening and browsing cost nothing/);
assert.doesNotMatch(tablet, /tablet-context-card/);
assert.doesNotMatch(tablet, /tablet-translation-controls/);
assert.doesNotMatch(tablet, /tablet-prompts/);
assert.match(provider, /If the user asks for a translation/);
assert.match(shell, /surface: "messages"/);
assert.match(shell, /surface: "workspace"/);
assert.match(shell, /surface: "attachment"/);
assert.match(shell, /const toggleTablet = \(\) => \{[\s\S]*?if \(tabletOpen\)[\s\S]*?setTabletOpen\(false\)[\s\S]*?setTabletOpen\(true\)/);
assert.doesNotMatch(restoreViewBlock, /setTabletOpen\(false\)/);
assert.doesNotMatch(navigateViewBlock, /setTabletOpen\(false\)/);
assert.match(shell, /title=\{tabletOpen \? "Close AI tablet" : "Open AI tablet"\}/);
assert.match(shell, /aria-expanded=\{tabletOpen\}/);
assert.match(shell, /Visible discussion/);
assert.match(shell, /Visible post results/);
assert.match(shell, /Visible feed items/);
assert.match(attachmentContext, /Extracted structured attachment preview/);
assert.match(attachmentContext, /Currently viewing PDF page/);
assert.match(shell, /buildTabletAttachmentContext\(activeAttachment, activePdfView\)/);
assert.match(shell, /selection: activePdfView\?\.selectedText/);
assert.match(shell, /postAttachmentViewContext/);
assert.match(shell, /attachmentPreviewViewContext/);
assert.doesNotMatch(shell, /const \[attachmentViewContext,/);
assert.match(attachmentViews, /new pdfjs\.TextLayer/);
assert.match(attachmentViews, /readPdfPageText\(document, boundedPage\)/);
assert.match(attachmentViews, /renderPdfPageTranslationImage\(document, boundedPage\)/);
assert.match(attachmentViews, /DocumentTranslationControl state=\{translation\}/);
assert.match(documentTranslationControl, /\["English", "French", "German", "Spanish"\]/);
assert.match(documentTranslationControl, /This translates the current page/);
assert.doesNotMatch(documentTranslationControl, /limited usage restriction|TriangleAlert/);
assert.match(documentTranslationControl, /Original/);
assert.match(documentTranslationControl, /Translation/);
assert.match(documentTranslationControl, /Translate · 1 answer/);
assert.match(documentRepository, /findCachedTranslation/);
assert.match(documentRepository, /No AI answer was consumed/);
assert.match(documentRepository, /reserveAssistantUsage/);
assert.match(documentRepository, /kind, title, context_type/);
assert.match(contentRepository, /kind, title, context_type/);
assert.match(contentRepository, /'content_translation'/);
assert.match(contentRepository, /findCachedTranslation/);
assert.match(contentRepository, /No AI answer was consumed/);
assert.match(contentRepository, /reserveAssistantUsage/);
assert.match(contentRepository, /Only five sources|Choose English, French, German, or Spanish/);
assert.match(contentTranslationControl, /Translate entire \{sourceLabel\}/);
assert.match(contentTranslationControl, /Only a completed translation uses 1 answer/);
assert.match(contentTranslationControl, /Translate · 1 answer/);
assert.match(contentTranslationControl, /Original/);
assert.match(contentTranslationControl, /translation-language-options/);
assert.match(attachmentViews, /attachment-pdf-stage-continuous/);
assert.match(attachmentViews, /data-docx-page-shell/);
assert.match(attachmentViews, /translatedPageFor/);
assert.match(attachmentViews, /PdfParallelTextBlock/);
assert.match(attachmentViews, /sourceLineHeight \* 0\.82/);
assert.match(attachmentViews, /sampledCanvasBackground/);
assert.match(attachmentViews, /translatedLayoutBlocks/);
assert.match(attachmentViews, /pdfTranslationFitted/);
assert.match(attachmentViews, /visionTranslationBlocks\.forEach/);
assert.match(attachmentViews, /data-docx-page-variant/);
assert.match(attachmentViews, /sourceKind: "document"/);
assert.match(attachmentViews, /`document-\$\{boundedPage\}-body`/);
assert.match(attachmentViews, /translatedPage\?\.segments\.map\(\(segment\) => segment\.text\)\.join\(""\)/);
assert.match(attachmentViews, /applyDocxTranslationSegment/);
assert.match(documentTranslationControl, /useSyncExternalStore/);
assert.match(documentTranslationControl, /rememberDocumentTranslation/);
assert.match(documentViewerSession, /rememberDocumentReadingPosition/);
assert.match(documentViewerSession, /subscribeDocumentReadingPosition/);
assert.match(attachmentStyles, /min-height: var\(--docx-original-page-height/);
assert.match(attachmentStyles, /\.attachment-pdf-parallel-canvas/);
assert.match(attachmentStyles, /\.attachment-pdf-parallel-text-layer/);
assert.match(attachmentStyles, /\.attachment-text-parallel-page/);
assert.match(provider, /layoutBlocks for each natural-language region/);
assert.match(provider, /symposium-document-page-translation-v6/);
assert.match(documentRepository, /policy: input\.sourcePages\.some\(\(page\) => page\.imageDataUrl\) \? 3 : 2/);
assert.match(contentRepository, /translated_document/);
assert.match(tabletStyles, /\.room-layout > \.feed-stream > \.feed-post:first-child \.content-translation-post[\s\S]*?margin-left: max\(0px, calc\(708px - 50vw\)\)/);
assert.match(postViews, /ContentTranslationControl state=\{translation\} sourceLabel="post"/);
assert.match(commentThread, /ContentTranslationControl state=\{translation\} sourceLabel="comment"/);
assert.doesNotMatch(attachmentViews, /<iframe[^>]+title=\{attachment\.fileName\}/);
assert.match(attachmentModal, /kind: "pdf-text", page, excerpt/);
assert.match(attachmentModal, /suppressModalEscapeUntilRef/);
assert.match(attachmentModal, /Date\.now\(\) \+ 400/);
assert.match(pdfClient, /maxPdfMetadataPages = 40/);
assert.match(pdfClient, /pdfTextStatus: previewText \? "extracted" : "none"/);
assert.match(packageManifest, /"pdfjs-dist": "6\.1\.200"/);
assert.match(nextConfig, /source: "\/attachment-assets\/:path\*"/);
assert.match(nextConfig, /destination: `\$\{publicAttachmentBaseUrl\}\/\:path\*`/);
assert.match(env, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD:[\s\S]*max\(40\)\.default\(40\)/);
assert.match(env, /SYMPOSIUM_AI_USER_DAILY_LIMIT:[\s\S]*min\(10\)\.max\(10\)\.default\(10\)/);
assert.doesNotMatch(env, /SYMPOSIUM_AI_OWNER_DAILY_LIMIT/);
assert.match(renderBlueprint, /SYMPOSIUM_AI_USER_DAILY_LIMIT[\s\S]*value: "10"/);
assert.doesNotMatch(renderBlueprint, /SYMPOSIUM_AI_OWNER_DAILY_LIMIT/);

console.log("AI Tablet cost and context boundary checks passed.");
