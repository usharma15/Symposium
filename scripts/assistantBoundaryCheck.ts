import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actualCostMicros, conservativeInputTokenCeiling, reserveCostMicros, usdToMicros } from "@/apps/api/src/services/aiBudget";
import { assistantDailyLimitFor } from "@/apps/api/src/services/assistantQuota";
import { assistantQuotaAfterReservation } from "@/apps/api/src/services/assistantUsage";
import { assistantThreadSources } from "@/apps/api/src/repository/assistant";
import {
  assistantGeneralInstructions,
  assistantGeneralPrompt,
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
  documentTranslationModeForPage,
  documentTranslationRequestContent,
  documentTranslationResponseFormat,
  documentTranslationRenderedInput,
  restoreTranslationSegmentOrder
} from "@/apps/api/src/services/openaiResponses";
import {
  contentTranslatedDocument,
  contentTranslationFingerprint,
  contentTranslationSourceBody,
  contentTranslationSourceSegments
} from "@/apps/api/src/repository/contentTranslations";
import {
  documentTranslationFingerprint,
  supportedLanguageFromInstruction
} from "@/apps/api/src/repository/documentTranslations";
import {
  assistantContextUpdateInputSchema,
  assistantConversationListQuerySchema,
  assistantProjectDeleteResultSchema,
  assistantMessageInputSchema,
  assistantSourceUpdateInputSchema,
  assistantThreadDeleteInputSchema,
  assistantThreadUpdateInputSchema,
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
import {
  assistantTranslationLanguageLabels,
  assistantTranslationLanguageOptions,
  assistantTranslationLanguages
} from "@/packages/contracts/src/translationLanguages";
import { buildTabletAttachmentContext, tabletAttachmentTextLimit } from "@/features/assistant/tabletAttachmentContext";
import { assistantRequestIntentFor } from "@/features/assistant/assistantRequestIntent";
import {
  orderAssistantThreadsByLatestMessage,
  reconcileAssistantThreadSummary
} from "@/features/assistant/assistantThreadOrdering";
import { initialAssistantMessageFor } from "@/features/assistant/useAssistantController";
import {
  assistantAttachmentProcessingLabel,
  assistantAttachmentUrl
} from "@/features/assistant/assistantPresentation";
import {
  assistantContextKey,
  assistantContextTypeForSurface
} from "@/lib/assistantContext";
import {
  DELETE as deleteAssistantConversationRoute,
  PATCH as updateAssistantConversationRoute
} from "@/app/api/assistant/conversations/[...segments]/route";
import {
  pdfTextItemsToPlainText,
  resolvePdfDocumentUrl
} from "@/features/attachments/pdfAttachmentClient";
import {
  pdfTranslationSegmentsFromTextContent,
  visionLayoutToPdfBlock
} from "@/features/attachments/AttachmentViews";
import {
  applyDocumentViewerSessionStorageUpdate,
  documentViewerSessionStorageKey,
  documentViewerSessionSnapshot,
  maxDocumentViewerSessionEntries,
  readDocumentReadingPosition,
  reapplyDocumentReadingPosition,
  rememberDocumentReadingPosition,
  rememberDocumentTranslation,
  resetDocumentViewerSessionsForTests,
  setDocumentTranslationVisible,
  subscribeDocumentReadingPosition
} from "@/features/attachments/documentViewerSession";
import {
  filterTranslationLanguageOptions,
  translationLanguageSelectionPattern
} from "@/features/translation/TranslationLanguagePicker";
import {
  contentTranslationSessionStorageKey,
  maxContentTranslationSessionEntries,
  peekContentTranslationSession,
  readContentTranslationSession,
  readContentTranslationSessionStorageUpdate,
  rememberContentTranslationSession,
  resetContentTranslationSessionsForTests
} from "@/features/translation/contentTranslationSession";
import { translatedDocumentForSource } from "@/lib/documentModel";

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
assert.equal(assistantMessageInputSchema.safeParse({
  message: "What makes a scientific question useful?",
  context: null
}).success, true);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate", targetLanguage: "spanish" }).success, true);
assistantTranslationLanguages.forEach((targetLanguage) => {
  assert.equal(
    assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate", targetLanguage }).success,
    true
  );
});
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate" }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({
  message: "Translate the current view into Spanish.",
  intent: "translate",
  targetLanguage: "spanish",
  context: null
}).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, intent: "translate", targetLanguage: "italian" }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, message: "x".repeat(2001) }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({
  ...validInput,
  attachmentIds: Array.from({ length: 5 }, (_unused, index) => `00000000-0000-4000-8000-00000000000${index + 1}`)
}).success, true);
assert.equal(assistantMessageInputSchema.safeParse({
  ...validInput,
  attachmentIds: Array.from({ length: 6 }, (_unused, index) => `00000000-0000-4000-8000-00000000000${index + 1}`)
}).success, false);
assert.equal(assistantMessageInputSchema.safeParse({
  ...validInput,
  attachmentIds: [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001"
  ]
}).success, false);
const projectIdFixture = "41b805db-3ed3-4a2a-a20d-6b75b52166db";
assert.equal(assistantMessageInputSchema.safeParse({
  ...validInput,
  projectId: projectIdFixture
}).success, true);
assert.equal(assistantMessageInputSchema.safeParse({
  ...validInput,
  conversationId: "bec08981-7b08-41c8-a045-0b671d8b1320",
  projectId: projectIdFixture
}).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, content: "x".repeat(12001) } }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, selection: "x".repeat(4001) } }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, surface: "unknown" } }).success, false);
assert.deepEqual(
  assistantRequestIntentFor("Translate the current view summary into Spanish."),
  { translationRequested: true, intent: "translate", targetLanguage: "spanish" }
);
assert.deepEqual(
  assistantRequestIntentFor("Translate this French passage to English."),
  { translationRequested: true, intent: "translate", targetLanguage: "english" }
);
assert.deepEqual(
  assistantRequestIntentFor("Translate to Spanish from French."),
  { translationRequested: true, intent: "translate", targetLanguage: "spanish" }
);
assert.deepEqual(
  assistantRequestIntentFor("Please translate this into Chinese."),
  { translationRequested: true, intent: "translate", targetLanguage: "simplified_chinese" }
);
assistantTranslationLanguageOptions.forEach(({ label, value }) => {
  assert.equal(
    assistantRequestIntentFor(`Translate this view into ${label}.`).targetLanguage,
    value
  );
});
assert.deepEqual(
  assistantRequestIntentFor("Explain the current view in one sentence."),
  { translationRequested: false, intent: "answer" }
);
assert.deepEqual(
  assistantRequestIntentFor("Translate the current view."),
  { translationRequested: true, intent: "answer" }
);
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
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "clear",
  expectedRevision: 2
}).success, true);
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "use",
  expectedRevision: 2
}).success, false);
assert.equal(assistantSourceUpdateInputSchema.safeParse({
  sourceId: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32",
  action: "exclude",
  expectedRevision: 3
}).success, true);
assert.deepEqual(
  assistantConversationListQuerySchema.parse({}),
  { limit: 20, status: "active" }
);
assert.equal(assistantConversationListQuerySchema.safeParse({
  search: "methodological break",
  status: "archived",
  projectId: projectIdFixture,
  limit: 50
}).success, true);
assert.equal(assistantConversationListQuerySchema.safeParse({ search: "x".repeat(161) }).success, false);
assert.equal(assistantConversationListQuerySchema.safeParse({ status: "deleted" }).success, false);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  title: "Heisenberg methodology",
  expectedRevision: 2
}).success, true);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  pinned: true,
  expectedRevision: 2
}).success, true);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  archived: true,
  expectedRevision: 2
}).success, true);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  projectId: projectIdFixture,
  expectedRevision: 2
}).success, true);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  projectId: null,
  expectedRevision: 2
}).success, true);
assert.equal(assistantThreadUpdateInputSchema.safeParse({
  pinned: true,
  archived: true,
  expectedRevision: 2
}).success, false);
assert.equal(assistantThreadUpdateInputSchema.safeParse({ expectedRevision: 2 }).success, false);
assert.equal(assistantThreadUpdateInputSchema.safeParse({ title: " ", expectedRevision: 2 }).success, false);
assert.equal(assistantThreadDeleteInputSchema.safeParse({ expectedRevision: 2 }).success, true);
assert.equal(assistantThreadDeleteInputSchema.safeParse({ expectedRevision: 0 }).success, false);
assert.equal(assistantProjectDeleteResultSchema.safeParse({
  projectId: projectIdFixture,
  deleted: true,
  unfiledConversationCount: 10001
}).success, true);
assert.equal(assistantContextUpdateInputSchema.safeParse({
  mode: "silent",
  context: validInput.context,
  expectedRevision: 1
}).success, false);
const historicalSourceId = "bec08981-7b08-41c8-a045-0b671d8b1320";
const historicalSources = assistantThreadSources([
  { id: "not-a-valid-source" },
  {
    id: historicalSourceId,
    key: "attachment:heisenberg-page-1",
    revision: 1,
    included: true,
    context: {
      surface: "attachment",
      route: "/posts/paper-bell-epr",
      title: "Heisenberg.pdf · page 1",
      summary: "The exact visible page at answer time.",
      content: "Relations among quantities observable in principle.",
      entityType: "attachment",
      entityId: "heisenberg-pdf",
      metadata: { page: 1 }
    },
    attachedAt: "2026-07-20T20:00:00+00:00",
    supersedesSourceId: null,
    provenance: "recovered"
  }
]);
assert.equal(historicalSources.length, 1);
assert.equal(historicalSources[0]?.attachedAt, "2026-07-20T20:00:00.000Z");
assert.equal(historicalSources[0]?.provenance, "recovered");
const threadSummaryFixture = {
  kind: "research_thread" as const,
  title: "Thread",
  pinned: false,
  archivedAt: null,
  projectId: null,
  metadataRevision: 1,
  contextType: "post",
  contextId: "paper-1",
  activeContextKey: "post:paper-1",
  activeSourceId: historicalSourceId,
  originSourceId: historicalSourceId,
  contextRevision: 1,
  sourceCount: 1,
  sourceRevisionCount: 1,
  createdAt: "2026-07-20T19:00:00.000Z",
  updatedAt: "2026-07-25T20:00:00.000Z"
};
assert.deepEqual(
  orderAssistantThreadsByLatestMessage([
    { ...threadSummaryFixture, id: "169b5a8d-cdea-43b9-b871-3afce65eca46", lastMessageAt: "2026-07-21T20:00:00.000Z" },
    { ...threadSummaryFixture, id: historicalSourceId, lastMessageAt: "2026-07-20T20:00:00.000Z" }
  ]).map((thread) => thread.id),
  ["169b5a8d-cdea-43b9-b871-3afce65eca46", historicalSourceId]
);
assert.deepEqual(
  orderAssistantThreadsByLatestMessage([
    { ...threadSummaryFixture, id: historicalSourceId, pinned: true, lastMessageAt: "2026-07-20T20:00:00.000Z" },
    { ...threadSummaryFixture, id: "169b5a8d-cdea-43b9-b871-3afce65eca46", lastMessageAt: "2026-07-21T20:00:00.000Z" }
  ]).map((thread) => thread.id),
  [historicalSourceId, "169b5a8d-cdea-43b9-b871-3afce65eca46"]
);
const activeThreadFixture = {
  ...threadSummaryFixture,
  id: historicalSourceId,
  lastMessageAt: "2026-07-20T20:00:00.000Z"
};
const archivedThreadFixture = {
  ...activeThreadFixture,
  archivedAt: "2026-07-25T22:00:00.000Z"
};
assert.deepEqual(
  reconcileAssistantThreadSummary([archivedThreadFixture], activeThreadFixture, {
    view: "archived",
    projectId: null,
    hasSearch: false
  }),
  []
);
assert.deepEqual(
  reconcileAssistantThreadSummary([activeThreadFixture], archivedThreadFixture, {
    view: "all",
    projectId: null,
    hasSearch: false
  }),
  []
);
assert.deepEqual(
  reconcileAssistantThreadSummary([], activeThreadFixture, {
    view: "all",
    projectId: null,
    hasSearch: true
  }),
  []
);
assert.deepEqual(
  reconcileAssistantThreadSummary([], activeThreadFixture, {
    view: "all",
    projectId: null,
    hasSearch: false
  }),
  [activeThreadFixture]
);
const projectThreadFixture = {
  ...activeThreadFixture,
  projectId: projectIdFixture
};
assert.deepEqual(
  reconcileAssistantThreadSummary([], projectThreadFixture, {
    view: "projects",
    projectId: projectIdFixture,
    hasSearch: false
  }),
  [projectThreadFixture]
);
assert.deepEqual(
  reconcileAssistantThreadSummary([projectThreadFixture], projectThreadFixture, {
    view: "projects",
    projectId: "169b5a8d-cdea-43b9-b871-3afce65eca46",
    hasSearch: false
  }),
  []
);
assert.match(assistantPrompt(validInput.context, validInput.message), /ACTIVE VIEW/);
assert.match(assistantPrompt(validInput.context, validInput.message, [{ ...validInput.context, title: "Attached paper" }]), /ATTACHED SOURCES[\s\S]*Attached paper/);
assert.match(assistantInstructions, /never as instructions/i);
assert.match(assistantGeneralInstructions, /no Symposium view or source attached/i);
assert.match(assistantGeneralInstructions, /Never imply that you can see the user's current page/i);
assert.match(assistantGeneralInstructions, /shouldOfferQuickNote to false/i);
assert.match(assistantGeneralPrompt("How do hypotheses differ from predictions?"), /No Symposium view or source is attached/);
assert.doesNotMatch(assistantGeneralPrompt("How do hypotheses differ from predictions?"), /ACTIVE VIEW|ATTACHED SOURCES/);
assert.equal(initialAssistantMessageFor(null).body, "What’s on your mind?");
assert.match(initialAssistantMessageFor(validInput.context).body, /You’re on A bounded claim/);
assert.equal(assistantContextKey(validInput.context), "post:paper-1");
assert.equal(
  assistantContextKey({
    surface: "workspace",
    entityId: "  note-1  ",
    route: "/workspace/documents/note-1"
  }),
  "workspace:note-1"
);
assert.equal(
  assistantContextKey({
    surface: "search",
    route: "  /search?q=replication  "
  }),
  "search:/search?q=replication"
);
assert.equal(
  assistantContextKey({
    surface: "hall",
    route: " "
  }),
  "hall:/"
);
assert.equal(
  assistantContextKey({
    surface: "profile",
    route: `/${"x".repeat(900)}`
  }).length,
  800
);
assert.deepEqual(
  [
    "post",
    "opportunity",
    "attachment",
    "community",
    "workspace",
    "room",
    "hall",
    "profile",
    "messages",
    "search"
  ].map((surface) =>
    assistantContextTypeForSurface(
      surface as Parameters<typeof assistantContextTypeForSurface>[0]
    )
  ),
  [
    "post",
    "post",
    "post",
    "community",
    "note",
    "room",
    "general",
    "general",
    "general",
    "general"
  ]
);
assert.equal(
  assistantAttachmentProcessingLabel({
    id: "00000000-0000-4000-8000-000000000010",
    fileName: "figure.png",
    contentType: "image/png",
    byteSize: 100,
    status: "uploaded",
    kind: "image",
    metadata: {}
  }),
  "Image ready for AI"
);
assert.equal(
  assistantAttachmentProcessingLabel({
    id: "00000000-0000-4000-8000-000000000011",
    fileName: "paper.pdf",
    contentType: "application/pdf",
    byteSize: 100,
    status: "uploaded",
    kind: "pdf",
    metadata: { previewText: "Bounded extraction" }
  }),
  "Text extracted"
);
assert.equal(
  assistantAttachmentProcessingLabel({
    id: "00000000-0000-4000-8000-000000000012",
    fileName: "archive.bin",
    contentType: "application/octet-stream",
    byteSize: 100,
    status: "uploaded",
    kind: "document",
    metadata: {}
  }),
  "Stored only"
);
assert.equal(
  assistantAttachmentUrl({
    id: "00000000-0000-4000-8000-000000000013",
    fileName: "paper.pdf",
    contentType: "application/pdf",
    byteSize: 100,
    status: "uploaded",
    kind: "pdf",
    metadata: {}
  }, "owner/name"),
  "/api/assistant-attachments/00000000-0000-4000-8000-000000000013?actorHandle=owner%2Fname"
);
assert.match(assistantTranslationInstructions("french"), /Translate the source requested by the user into French/);
assert.match(assistantTranslationInstructions("sanskrit"), /Sanskrit is experimental/);
assert.equal(assistantTranslationLanguages.length, 17);
assert.equal(new Set(assistantTranslationLanguages).size, assistantTranslationLanguages.length);
assert.equal(assistantTranslationLanguageOptions[12]?.value, "sanskrit");
assert.equal(assistantTranslationLanguageOptions[12]?.label, "Sanskrit (experimental)");
assert.deepEqual(filterTranslationLanguageOptions("gujrati").map((option) => option.value), ["gujarati"]);
assert.deepEqual(filterTranslationLanguageOptions("chinese").map((option) => option.value), ["simplified_chinese"]);
assert.deepEqual(filterTranslationLanguageOptions("does-not-exist"), []);
const translationLanguageSelectionRegex = new RegExp(`^(?:${translationLanguageSelectionPattern})$`);
assistantTranslationLanguageOptions.forEach((option) => {
  assert.equal(translationLanguageSelectionRegex.test(option.label), true);
});
assert.equal(translationLanguageSelectionRegex.test("Italian"), false);
assert.equal(translationLanguageSelectionRegex.test("san"), false);
assert.equal(assistantMaxOutputTokens("translate"), 1200);
assert.equal(assistantMaxOutputTokens("answer", { draftEdit: true }), 1200);
assert.equal(assistantMaxOutputTokens("answer", { actionDraft: true }), 2000);
assert.doesNotMatch(assistantRenderedInput({
  history: [{ role: "assistant", body: "Earlier answer must not inflate translation input." }],
  context: validInput.context,
  message: "Translate the current source.",
  intent: "translate",
  targetLanguage: "german"
}), /Earlier answer/);
const generalRenderedInput = assistantRenderedInput({
  history: [{ role: "assistant", body: "Earlier general answer." }],
  context: null,
  message: "What makes a strong scientific explanation?",
  intent: "answer"
});
assert.match(generalRenderedInput, /Earlier general answer/);
assert.match(generalRenderedInput, /no Symposium view or source attached/i);
assert.doesNotMatch(generalRenderedInput, /ACTIVE VIEW|ATTACHED SOURCES|A bounded claim/);
const resolvedActionFollowupInput = assistantRenderedInput({
  history: [
    {
      role: "user",
      body: "Now can you make a post about the Agarthan conspiracy?"
    },
    {
      role: "assistant",
      body: "I did not prepare an Office action. Nothing was created."
    }
  ],
  context: null,
  message: "ok do it",
  intent: "answer",
  resolvedActionRequest: "Now can you make a post about the Agarthan conspiracy?"
});
assert.match(resolvedActionFollowupInput, /RESOLVED ACTION CONTEXT/);
assert.match(resolvedActionFollowupInput, /reviewable private Office draft proposal only/);
assert.match(resolvedActionFollowupInput, /post publicly/);
assert.match(resolvedActionFollowupInput, /latest user's answer or refinements/);
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
assert.match(localFailure.body, /Reference: provider_error/);
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
assistantTranslationLanguages.forEach((language) => {
  assert.equal(supportedLanguageFromInstruction(assistantTranslationLanguageLabels[language]), language);
});
assert.equal(supportedLanguageFromInstruction("Gujrati"), "gujarati");
assert.equal(supportedLanguageFromInstruction("Chinese"), "simplified_chinese");
assert.equal(supportedLanguageFromInstruction("Italian"), null);
assert.equal(supportedLanguageFromInstruction("French or Spanish"), null);
assert.deepEqual(
  assistantTranslationLanguageOptions.map((option) => option.label),
  [
    "Bengali",
    "English",
    "French",
    "German",
    "Greek",
    "Gujarati",
    "Hindi",
    "Japanese",
    "Korean",
    "Marathi",
    "Portuguese",
    "Punjabi",
    "Sanskrit (experimental)",
    "Simplified Chinese",
    "Spanish",
    "Tamil",
    "Telugu"
  ]
);
assert.notEqual(assistantTranslationLanguageOptions.at(-1)?.value, "sanskrit");
assert.match(documentTranslationInstructions, /one supplied source page/i);
assert.match(documentTranslationInstructions, /source language may be any language/i);
assert.match(documentTranslationRenderedInput(documentTranslationInput), /LANGUAGE INSTRUCTION/);
assert.match(documentTranslationRenderedInput(documentTranslationInput), /structured_text_overlay/);
assert.doesNotMatch(documentTranslationRenderedInput(scannedPdfTranslationInput), /data:image/);
assert.ok(documentTranslationRenderedInput(scannedPdfTranslationInput).length > 12_000);
assert.deepEqual(documentTranslationRequestContent(documentTranslationInput).map((item) => item.type), ["input_text"]);
assert.deepEqual(documentTranslationRequestContent(scannedPdfTranslationInput).map((item) => item.type), ["input_text", "input_image"]);
assert.doesNotMatch(
  JSON.stringify(documentTranslationResponseFormat()),
  /minItems|maxItems|minimum|maximum/
);
const documentTranslationSchema = documentTranslationResponseFormat().schema;
assert.deepEqual(
  documentTranslationSchema.properties.targetLanguage.enum,
  [...assistantTranslationLanguages, "unsupported"]
);
assert.deepEqual(
  contentTranslationResponseFormat.schema.properties.targetLanguage.enum,
  [...assistantTranslationLanguages, "unsupported"]
);
const documentTranslationJsonPageSchema = documentTranslationSchema.properties.pages.items;
assert.deepEqual(
  documentTranslationJsonPageSchema.required,
  ["pageNumber", "segments", "layoutBlocks", "preservedArtifacts"]
);
assert.equal(documentTranslationJsonPageSchema.additionalProperties, false);
assert.equal("required" in documentTranslationJsonPageSchema.properties, false);
assert.equal("additionalProperties" in documentTranslationJsonPageSchema.properties, false);
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) >= 1400);
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) <= 12_000);
assert.equal(documentTranslationMaxOutputTokens(scannedPdfTranslationInput), 7000);
assert.equal(documentTranslationModeForPage(scannedPdfTranslationInput.sourcePages[0]), "visual_reconstruction");
const denseVisualPdfTranslationInput = {
  ...scannedPdfTranslationInput,
  sourcePages: [{
    pageNumber: 4,
    body: "A visually complex page with prose, captions, figures, and equations.",
    segments: Array.from({ length: 24 }, (_, index) => ({
      id: `pdf-4-line-${index}`,
      text: `A formatted source line ${index + 1} with scientific terminology and context.`
    })),
    imageDataUrl: "data:image/jpeg;base64,YWJj"
  }]
};
assert.equal(documentTranslationModeForPage(denseVisualPdfTranslationInput.sourcePages[0]), "structured_text_overlay");
assert.ok(documentTranslationMaxOutputTokens(denseVisualPdfTranslationInput) >= 2000);
assert.ok(documentTranslationMaxOutputTokens(denseVisualPdfTranslationInput) <= 12_000);
assert.deepEqual(
  pdfTranslationSegmentsFromTextContent(2, {
    items: [
      { str: "The vital assumption", hasEOL: false },
      { str: "is locality.", hasEOL: true },
      { str: "E(a,b) = -a · b", hasEOL: true },
      { str: "III. Illustration", hasEOL: true },
      { str: "and so on...", hasEOL: true }
    ]
  }),
  [
    { id: "pdf-2-line-0", text: "The vital assumption is locality." },
    { id: "pdf-2-line-1", text: "III. Illustration" },
    { id: "pdf-2-line-2", text: "and so on..." }
  ]
);
assert.deepEqual(
  pdfTranslationSegmentsFromTextContent(4, {
    items: [
      { str: "A spatially measured", hasEOL: false, transform: [12, 0, 0, 12, 80, 720], height: 12 },
      { str: "PDF heading", hasEOL: false, transform: [12, 0, 0, 12, 240, 720], height: 12 },
      { str: "A separate paragraph line", hasEOL: false, transform: [10, 0, 0, 10, 80, 690], height: 10 },
      { str: "continues here.", hasEOL: false, transform: [10, 0, 0, 10, 260, 690], height: 10 }
    ]
  }),
  [
    { id: "pdf-4-line-0", text: "A spatially measured PDF heading" },
    { id: "pdf-4-line-1", text: "A separate paragraph line continues here." }
  ]
);
assert.deepEqual(
  restoreTranslationSegmentOrder(
    [{ id: "a", text: "First" }, { id: "b", text: "Second" }],
    [{ id: "b", text: "Deuxième" }, { id: "a", text: "Premier" }]
  ),
  [{ id: "a", text: "Premier" }, { id: "b", text: "Deuxième" }]
);
assert.deepEqual(
  restoreTranslationSegmentOrder(
    [{ id: "a", text: "First" }, { id: "b", text: "Second" }],
    [{ id: "model-a", text: "Premier" }, { id: "model-b", text: "Deuxième" }]
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
const documentViewerSessionValues = new Map<string, string>();
const documentViewerSessionStorage = {
  getItem: (key: string) => documentViewerSessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    documentViewerSessionValues.set(key, value);
  }
};
const documentBrowserSessionId = "assistant-document-session";
resetDocumentViewerSessionsForTests();
rememberDocumentTranslation(
  documentTranslationInput.attachmentId,
  validDocumentTranslationResult,
  documentViewerSessionStorage,
  documentBrowserSessionId
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).resultsByPage[7],
  validDocumentTranslationResult
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).translatedVisiblePages.has(7),
  true
);
setDocumentTranslationVisible(
  documentTranslationInput.attachmentId,
  7,
  false,
  documentViewerSessionStorage,
  documentBrowserSessionId
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).translatedVisiblePages.has(7),
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
}, "assistant-boundary-check", documentViewerSessionStorage, documentBrowserSessionId);
assert.equal(observedPositionPage, 3);
assert.deepEqual(readDocumentReadingPosition(
  documentTranslationInput.attachmentId,
  documentViewerSessionStorage,
  documentBrowserSessionId
), {
  pageNumber: 3,
  pageProgress: 0.42
});
reapplyDocumentReadingPosition(documentTranslationInput.attachmentId, {
  pageNumber: 3,
  pageProgress: 0.42
}, "assistant-boundary-reapply", documentViewerSessionStorage, documentBrowserSessionId);
assert.equal(observedPositionCount, 2);
unsubscribePosition();
resetDocumentViewerSessionsForTests();
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).resultsByPage[7]?.targetLanguage,
  "spanish"
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).translatedVisiblePages.has(7),
  false
);
assert.deepEqual(readDocumentReadingPosition(
  documentTranslationInput.attachmentId,
  documentViewerSessionStorage,
  documentBrowserSessionId
), {
  pageNumber: 3,
  pageProgress: 0.42
});
const crossTabDocumentEnvelope = JSON.parse(
  documentViewerSessionValues.get(documentViewerSessionStorageKey) ?? "{}"
) as {
  sessionId: string;
  documents: Array<{
    attachmentId: string;
    translatedVisiblePages: number[];
    position?: { pageNumber: number; pageProgress: number };
  }>;
};
assert.equal(crossTabDocumentEnvelope.sessionId, documentBrowserSessionId);
const crossTabDocumentRecord = crossTabDocumentEnvelope.documents.find(
  (record) => record.attachmentId === documentTranslationInput.attachmentId
);
assert.ok(crossTabDocumentRecord);
crossTabDocumentRecord.translatedVisiblePages = [7];
crossTabDocumentRecord.position = { pageNumber: 7, pageProgress: 0.77 };
documentViewerSessionStorage.setItem(
  documentViewerSessionStorageKey,
  JSON.stringify(crossTabDocumentEnvelope)
);
assert.equal(
  applyDocumentViewerSessionStorageUpdate(
    "unrelated-storage-key",
    documentViewerSessionStorage,
    documentBrowserSessionId
  ),
  false
);
assert.equal(
  applyDocumentViewerSessionStorageUpdate(
    documentViewerSessionStorageKey,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ),
  true
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    documentBrowserSessionId
  ).translatedVisiblePages.has(7),
  true
);
assert.deepEqual(readDocumentReadingPosition(
  documentTranslationInput.attachmentId,
  documentViewerSessionStorage,
  documentBrowserSessionId
), {
  pageNumber: 7,
  pageProgress: 0.77
});
resetDocumentViewerSessionsForTests();
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    documentViewerSessionStorage,
    "different-browser-session"
  ).resultsByPage[7],
  undefined
);
resetDocumentViewerSessionsForTests();
Array.from({ length: maxDocumentViewerSessionEntries + 4 }, (_, index) => index).forEach((index) => {
  const attachmentId = `document-cross-tab-stress-${index}`;
  rememberDocumentTranslation(
    attachmentId,
    {
      ...validDocumentTranslationResult,
      attachmentId
    },
    documentViewerSessionStorage,
    documentBrowserSessionId
  );
  rememberDocumentReadingPosition(
    attachmentId,
    { pageNumber: index + 1, pageProgress: (index % 10) / 10 },
    "document-cross-tab-stress",
    documentViewerSessionStorage,
    documentBrowserSessionId
  );
});
const boundedDocumentEnvelope = JSON.parse(
  documentViewerSessionValues.get(documentViewerSessionStorageKey) ?? "{}"
) as { documents: Array<{ attachmentId: string }> };
assert.equal(boundedDocumentEnvelope.documents.length, maxDocumentViewerSessionEntries);
assert.equal(
  boundedDocumentEnvelope.documents.some((record) =>
    record.attachmentId === "document-cross-tab-stress-0"
  ),
  false
);
documentViewerSessionValues.set(documentViewerSessionStorageKey, "{malformed");
resetDocumentViewerSessionsForTests();
assert.deepEqual(
  documentViewerSessionSnapshot(
    "document-cross-tab-stress-11",
    documentViewerSessionStorage,
    documentBrowserSessionId
  ),
  {
    resultsByPage: {},
    translatedVisiblePages: new Set()
  }
);
const throwingDocumentViewerSessionStorage = {
  getItem: () => {
    throw new Error("document session storage unavailable");
  },
  setItem: () => {
    throw new Error("document session storage quota exceeded");
  }
};
resetDocumentViewerSessionsForTests();
rememberDocumentTranslation(
  documentTranslationInput.attachmentId,
  validDocumentTranslationResult,
  throwingDocumentViewerSessionStorage,
  documentBrowserSessionId
);
assert.equal(
  documentViewerSessionSnapshot(
    documentTranslationInput.attachmentId,
    throwingDocumentViewerSessionStorage,
    documentBrowserSessionId
  ).resultsByPage[7],
  validDocumentTranslationResult
);
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
assert.ok(contentTranslationMaxOutputTokens(contentTranslationModelInput) >= 1200);
assert.ok(contentTranslationMaxOutputTokens(contentTranslationModelInput) <= 12_000);
const richContentTranslationModelInput = {
  ...contentTranslationModelInput,
  sourceId: "rich-post",
  sourceTitle: "A demanding post with attachments, equations, nested comments, and formatting",
  sourceSegments: Array.from({ length: 100 }, (_, index) => ({
    id: `node-${index}:run-${index}`,
    text: `Segment ${index + 1} preserves a distinct piece of scientific prose and formatting.`
  }))
};
assert.ok(contentTranslationMaxOutputTokens(richContentTranslationModelInput) >= 4_000);
assert.ok(contentTranslationMaxOutputTokens(richContentTranslationModelInput) <= 12_000);
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

const importedWhitespaceDocument = {
  version: 1 as const,
  nodes: [
    {
      id: "google-docs-paste",
      type: "paragraph" as const,
      content: [{
        text: "\t\tComment 3a2\n\nShow previous replies\u00a0",
        marks: ["bold" as const]
      }],
      align: "left" as const,
      indent: 0
    }
  ],
  settings: { width: "standard" as const, margin: "normal" as const }
};
assert.deepEqual(contentTranslationSourceSegments(importedWhitespaceDocument), [
  { id: "n0:r0:t0", text: "Comment 3a2" },
  { id: "n0:r0:t1", text: "Show previous replies" }
]);
const longTranslationRun = `${"scientific explanation ".repeat(650)}conclusion`;
const longTranslationDocument = {
  version: 1 as const,
  nodes: [{
    id: "long-translation-run",
    type: "paragraph" as const,
    content: [{ text: longTranslationRun }],
    align: "left" as const,
    indent: 0
  }]
};
const longTranslationSegments = contentTranslationSourceSegments(longTranslationDocument);
assert.ok(longTranslationSegments.length > 1);
assert.ok(longTranslationSegments.every((segment) => segment.text.length <= 12_000));
const restoredLongTranslation = contentTranslatedDocument(
  longTranslationDocument,
  longTranslationSegments
);
assert.equal(restoredLongTranslation.nodes[0]?.type, "paragraph");
if (restoredLongTranslation.nodes[0]?.type === "paragraph") {
  assert.equal(restoredLongTranslation.nodes[0].content[0]?.text, longTranslationRun);
}
const translatedImportedWhitespaceDocument = contentTranslatedDocument(importedWhitespaceDocument, [
  { id: "n0:r0:t0", text: "\n  Comentario 3a2  " },
  { id: "n0:r0:t1", text: "Mostrar respuestas anteriores\t" }
]);
const translatedImportedParagraph = translatedImportedWhitespaceDocument.nodes[0];
assert.equal(translatedImportedParagraph?.type, "paragraph");
if (translatedImportedParagraph?.type === "paragraph") {
  assert.equal(
    translatedImportedParagraph.content[0]?.text,
    "\t\tComentario 3a2\n\nMostrar respuestas anteriores\u00a0"
  );
  assert.deepEqual(translatedImportedParagraph.content[0]?.marks, ["bold"]);
}
const preservedLongCode = Array.from({ length: 600 }, (_, index) =>
  `const line${index + 1} = "${"x".repeat(120)}";`
).join("\n");
const codeTranslationDocument = {
  version: 1 as const,
  nodes: [
    {
      id: "translate-this",
      type: "paragraph" as const,
      content: [{ text: "Translate this explanation." }],
      align: "left" as const,
      indent: 0
    },
    {
      id: "preserve-code",
      type: "code" as const,
      language: "typescript",
      code: preservedLongCode
    }
  ],
  settings: { width: "standard" as const, margin: "normal" as const }
};
assert.equal(contentTranslationSourceBody(codeTranslationDocument), "Translate this explanation.");
assert.deepEqual(contentTranslationSourceSegments(codeTranslationDocument), [
  { id: "n0:r0", text: "Translate this explanation." }
]);
const translatedCodeDocument = contentTranslatedDocument(codeTranslationDocument, [
  { id: "n0:r0", text: "Traduire cette explication." }
]);
assert.equal(translatedCodeDocument.nodes[1]?.type, "code");
if (translatedCodeDocument.nodes[1]?.type === "code") {
  assert.equal(translatedCodeDocument.nodes[1].code, preservedLongCode);
}
assert.equal(contentTranslationSourceBody({
  version: 1,
  nodes: [{ id: "only-code", type: "code", code: preservedLongCode }]
}), "Content");
assert.deepEqual(contentTranslationSourceSegments({
  version: 1,
  nodes: [{ id: "only-code", type: "code", code: preservedLongCode }]
}), [{ id: "fallback:body", text: "Content" }]);
assert.equal(contentTranslationModelOutputSchema.parse({
  targetLanguage: "french",
  targetLanguageLabel: "French",
  translatedTitle: "Une affirmation circonscrite",
  translatedSegments: [{ id: "n0:r0", text: "  Espacement préservé  " }],
  message: "French translation ready."
}).translatedSegments[0]?.text, "  Espacement préservé  ");

const contentFingerprint = contentTranslationFingerprint(contentTranslationModelInput);
assert.match(contentFingerprint, /^[a-f0-9]{64}$/);
assert.notEqual(contentFingerprint, contentTranslationFingerprint({ ...contentTranslationModelInput, sourceRevision: 3 }));
const translatedContentResult = contentTranslationResultSchema.parse({
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
});
assert.equal(contentTranslationResultSchema.safeParse(translatedContentResult).success, true);
assert.equal(contentTranslationResultSchema.safeParse({
  ...translatedContentResult,
  translatedBody: `${preservedLongCode}${" expansion".repeat(6_000)}`,
  translatedDocument: {
    version: 1,
    nodes: [
      { id: "preserved-code", type: "code", code: preservedLongCode },
      {
        id: "expanded-translation",
        type: "paragraph",
        content: [{ text: " expansion".repeat(6_000) }],
        align: "left",
        indent: 0
      }
    ]
  }
}).success, true, "translation results must allow natural-language expansion around preserved long code");

const contentTranslationSessionValues = new Map<string, string>();
const contentTranslationSessionStorage = {
  getItem: (key: string) => contentTranslationSessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    contentTranslationSessionValues.set(key, value);
  }
};
const contentTranslationSessionIdentity = {
  viewerHandle: "@ada",
  sourceType: "post" as const,
  sourceId: translatedContentResult.sourceId,
  sourceRevision: translatedContentResult.sourceRevision
};
const contentBrowserSessionId = "assistant-content-session";
resetContentTranslationSessionsForTests();
assert.equal(readContentTranslationSession(
  contentTranslationSessionIdentity,
  contentTranslationSessionStorage,
  contentBrowserSessionId
), null);
rememberContentTranslationSession({
  viewerHandle: contentTranslationSessionIdentity.viewerHandle,
  result: translatedContentResult,
  showTranslation: true,
  storage: contentTranslationSessionStorage,
  sessionId: contentBrowserSessionId
});
assert.equal(peekContentTranslationSession(contentTranslationSessionIdentity)?.result.targetLanguage, "french");
assert.equal(
  readContentTranslationSession(
    contentTranslationSessionIdentity,
    contentTranslationSessionStorage,
    contentBrowserSessionId
  )?.showTranslation,
  true
);
assert.equal(readContentTranslationSession({
  ...contentTranslationSessionIdentity,
  viewerHandle: "@different-user"
}, contentTranslationSessionStorage, contentBrowserSessionId), null);
assert.equal(readContentTranslationSession({
  ...contentTranslationSessionIdentity,
  sourceRevision: contentTranslationSessionIdentity.sourceRevision + 1
}, contentTranslationSessionStorage, contentBrowserSessionId), null);
rememberContentTranslationSession({
  viewerHandle: contentTranslationSessionIdentity.viewerHandle,
  result: translatedContentResult,
  showTranslation: false,
  storage: contentTranslationSessionStorage,
  sessionId: contentBrowserSessionId
});
resetContentTranslationSessionsForTests();
assert.equal(
  readContentTranslationSession(
    contentTranslationSessionIdentity,
    contentTranslationSessionStorage,
    contentBrowserSessionId
  )?.showTranslation,
  false
);
const crossTabTranslationEnvelope = JSON.parse(
  contentTranslationSessionValues.get(contentTranslationSessionStorageKey) ?? "{}"
) as {
  sessionId: string;
  records: Array<{ sourceId: string; showTranslation: boolean }>;
};
assert.equal(crossTabTranslationEnvelope.sessionId, contentBrowserSessionId);
const crossTabTranslationRecords = crossTabTranslationEnvelope.records;
const crossTabTranslationRecord = crossTabTranslationRecords.find(
  (record) => record.sourceId === contentTranslationSessionIdentity.sourceId
);
assert.ok(crossTabTranslationRecord);
crossTabTranslationRecord.showTranslation = true;
contentTranslationSessionStorage.setItem(
  contentTranslationSessionStorageKey,
  JSON.stringify(crossTabTranslationEnvelope)
);
assert.deepEqual(
  readContentTranslationSessionStorageUpdate(
    contentTranslationSessionIdentity,
    "unrelated-storage-key",
    contentTranslationSessionStorage,
    contentBrowserSessionId
  ),
  { handled: false, entry: null }
);
assert.equal(peekContentTranslationSession(contentTranslationSessionIdentity)?.showTranslation, false);
const crossTabTranslationUpdate = readContentTranslationSessionStorageUpdate(
  contentTranslationSessionIdentity,
  contentTranslationSessionStorageKey,
  contentTranslationSessionStorage,
  contentBrowserSessionId
);
assert.equal(crossTabTranslationUpdate.handled, true);
assert.equal(crossTabTranslationUpdate.entry?.showTranslation, true);
assert.equal(peekContentTranslationSession(contentTranslationSessionIdentity)?.showTranslation, true);
Array.from({ length: maxContentTranslationSessionEntries + 3 }, (_, index) => index).forEach((index) => {
  rememberContentTranslationSession({
    viewerHandle: contentTranslationSessionIdentity.viewerHandle,
    result: {
      ...translatedContentResult,
      sourceId: `bounded-post-${index}`
    },
    showTranslation: true,
    storage: contentTranslationSessionStorage,
    sessionId: contentBrowserSessionId
  });
});
assert.equal(
  (JSON.parse(contentTranslationSessionValues.get(contentTranslationSessionStorageKey) ?? "{}") as {
    records: unknown[];
  }).records.length,
  maxContentTranslationSessionEntries
);
assert.equal(peekContentTranslationSession({
  ...contentTranslationSessionIdentity,
  sourceId: "bounded-post-0"
}), null);
contentTranslationSessionValues.set(contentTranslationSessionStorageKey, "{malformed");
resetContentTranslationSessionsForTests();
assert.equal(readContentTranslationSession(
  contentTranslationSessionIdentity,
  contentTranslationSessionStorage,
  contentBrowserSessionId
), null);

const throwingContentTranslationSessionStorage = {
  getItem: () => {
    throw new Error("session storage unavailable");
  },
  setItem: () => {
    throw new Error("session storage quota exceeded");
  }
};
resetContentTranslationSessionsForTests();
rememberContentTranslationSession({
  viewerHandle: "  @Ada  ",
  result: {
    ...translatedContentResult,
    sourceId: "unicode:paper/%/संस्कृत"
  },
  showTranslation: true,
  storage: throwingContentTranslationSessionStorage
});
assert.equal(peekContentTranslationSession({
  viewerHandle: "@ada",
  sourceType: "post",
  sourceId: "unicode:paper/%/संस्कृत",
  sourceRevision: translatedContentResult.sourceRevision
})?.showTranslation, true);
resetContentTranslationSessionsForTests();
assert.equal(readContentTranslationSession(
  contentTranslationSessionIdentity,
  throwingContentTranslationSessionStorage
), null);

const stressedContentTranslationSessionValues = new Map<string, string>();
const stressedContentTranslationSessionStorage = {
  getItem: (key: string) => stressedContentTranslationSessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    stressedContentTranslationSessionValues.set(key, value);
  }
};
resetContentTranslationSessionsForTests();
Array.from({ length: 1_024 }, (_, index) => index).forEach((index) => {
  const viewerHandle = `@stress-user-${index % 11}`;
  const sourceType = index % 3 === 0 ? "comment" as const : "post" as const;
  const sourceId = `stress:${index % 43}/%/${index % 7}`;
  const sourceRevision = (index % 5) + 1;
  const showTranslation = index % 2 === 0;
  const result = {
    ...translatedContentResult,
    sourceType,
    sourceId,
    sourceRevision
  };
  rememberContentTranslationSession({
    viewerHandle,
    result,
    showTranslation,
    storage: stressedContentTranslationSessionStorage
  });
  assert.equal(peekContentTranslationSession({
    viewerHandle: `  ${viewerHandle.toUpperCase()}  `,
    sourceType,
    sourceId,
    sourceRevision
  })?.showTranslation, showTranslation);
  assert.equal(readContentTranslationSession({
    viewerHandle: `@other-${viewerHandle}`,
    sourceType,
    sourceId,
    sourceRevision
  }, stressedContentTranslationSessionStorage), null);
});
const stressedContentTranslationSessionRecords = (JSON.parse(
  stressedContentTranslationSessionValues.get(contentTranslationSessionStorageKey) ?? "{}"
) as {
  records: Array<{
    viewerHandle: string;
    sourceType: "post" | "comment";
    sourceId: string;
    sourceRevision: number;
  }>;
}).records;
assert.equal(stressedContentTranslationSessionRecords.length, maxContentTranslationSessionEntries);
resetContentTranslationSessionsForTests();
stressedContentTranslationSessionRecords.forEach((record) => {
  assert.notEqual(readContentTranslationSession(record, stressedContentTranslationSessionStorage), null);
});

const revisionReplacementSessionValues = new Map<string, string>();
const revisionReplacementSessionStorage = {
  getItem: (key: string) => revisionReplacementSessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    revisionReplacementSessionValues.set(key, value);
  }
};
resetContentTranslationSessionsForTests();
[1, 2, 3, 4, 5].forEach((sourceRevision) => {
  rememberContentTranslationSession({
    viewerHandle: "@revision-user",
    result: {
      ...translatedContentResult,
      sourceId: "revision-stress-source",
      sourceRevision
    },
    showTranslation: true,
    storage: revisionReplacementSessionStorage
  });
});
const revisionReplacementRecords = (JSON.parse(
  revisionReplacementSessionValues.get(contentTranslationSessionStorageKey) ?? "{}"
) as {
  records: Array<{ sourceId: string; sourceRevision: number }>;
}).records;
assert.deepEqual(
  revisionReplacementRecords.filter((record) => record.sourceId === "revision-stress-source")
    .map((record) => record.sourceRevision),
  [5]
);
resetContentTranslationSessionsForTests();
assert.equal(
  readContentTranslationSession(
    {
      viewerHandle: "@revision-user",
      sourceType: "post",
      sourceId: "revision-stress-source",
      sourceRevision: 5
    },
    revisionReplacementSessionStorage,
    "different-browser-session"
  ),
  null
);

const richSourceLayout = {
  version: 1 as const,
  nodes: [
    {
      id: "centered-rule",
      type: "paragraph" as const,
      content: [
        { text: "Centered ", marks: ["bold" as const], font: "serif" as const, size: "lead" as const },
        { text: "separator", marks: ["underline" as const], color: "blue" as const }
      ],
      align: "center" as const,
      indent: 2
    },
    {
      id: "inline-image",
      type: "attachment" as const,
      attachmentId: "source-image",
      placement: "inline" as const,
      caption: "Original caption"
    },
    {
      id: "formula",
      type: "equation" as const,
      source: "E=mc^2",
      display: true,
      label: "source-equation"
    },
    {
      id: "nested-list",
      type: "list" as const,
      style: "lower-alpha" as const,
      depth: 3,
      items: [[{ text: "First item", marks: ["italic" as const] }]]
    },
    {
      id: "empty-spacing-block",
      type: "paragraph" as const,
      content: [],
      align: "right" as const,
      indent: 1
    }
  ],
  settings: { width: "wide" as const, margin: "generous" as const }
};
const structurallyHostileTranslation = {
  version: 1 as const,
  nodes: [
    {
      id: "centered-rule",
      type: "paragraph" as const,
      content: [
        { text: "Centrado", marks: ["strikethrough" as const], font: "mono" as const, size: "small" as const },
        { text: "separador", marks: ["italic" as const], color: "crimson" as const }
      ],
      align: "left" as const,
      indent: 0
    },
    {
      id: "inline-image",
      type: "attachment" as const,
      attachmentId: "wrong-image",
      placement: "inline" as const,
      caption: "Leyenda traducida"
    },
    {
      id: "formula",
      type: "equation" as const,
      source: "translated-and-corrupted",
      display: false,
      label: "wrong-equation"
    },
    {
      id: "nested-list",
      type: "list" as const,
      style: "bullet" as const,
      depth: 0,
      items: [[{ text: "Primer elemento", marks: ["strikethrough" as const] }]]
    }
  ],
  settings: { width: "standard" as const, margin: "compact" as const }
};
const structurePreservingTranslation = translatedDocumentForSource({
  sourceDocument: richSourceLayout,
  sourceBody: "unused source fallback",
  translatedDocument: structurallyHostileTranslation,
  translatedBody: "unused translated fallback"
});
assert.deepEqual(structurePreservingTranslation.settings, richSourceLayout.settings);
assert.deepEqual(
  structurePreservingTranslation.nodes.map((node) => ({ id: node.id, type: node.type })),
  richSourceLayout.nodes.map((node) => ({ id: node.id, type: node.type }))
);
const preservedParagraph = structurePreservingTranslation.nodes[0];
assert.equal(preservedParagraph?.type, "paragraph");
if (preservedParagraph?.type === "paragraph") {
  assert.equal(preservedParagraph.align, "center");
  assert.equal(preservedParagraph.indent, 2);
  assert.equal(preservedParagraph.content[0]?.text, "Centrado");
  assert.deepEqual(preservedParagraph.content[0]?.marks, ["bold"]);
  assert.equal(preservedParagraph.content[0]?.font, "serif");
  assert.equal(preservedParagraph.content[0]?.size, "lead");
  assert.equal(preservedParagraph.content[1]?.text, "separador");
  assert.deepEqual(preservedParagraph.content[1]?.marks, ["underline"]);
  assert.equal(preservedParagraph.content[1]?.color, "blue");
}
const preservedAttachment = structurePreservingTranslation.nodes[1];
assert.equal(preservedAttachment?.type, "attachment");
if (preservedAttachment?.type === "attachment") {
  assert.equal(preservedAttachment.attachmentId, "source-image");
  assert.equal(preservedAttachment.caption, "Leyenda traducida");
}
assert.deepEqual(structurePreservingTranslation.nodes[2], richSourceLayout.nodes[2]);
const preservedList = structurePreservingTranslation.nodes[3];
assert.equal(preservedList?.type, "list");
if (preservedList?.type === "list") {
  assert.equal(preservedList.style, "lower-alpha");
  assert.equal(preservedList.depth, 3);
  assert.equal(preservedList.items[0]?.[0]?.text, "Primer elemento");
  assert.deepEqual(preservedList.items[0]?.[0]?.marks, ["italic"]);
}
assert.deepEqual(structurePreservingTranslation.nodes[4], richSourceLayout.nodes[4]);

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
assert.equal(assistantResponseSchema.safeParse({
  conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
  providerConfigured: true,
  status: "discarded",
  model: "gpt-5.6-terra",
  quota: { dailyLimit: 3, remainingToday: 2, monthlyBudgetUsd: 40, extremelyLimited: true },
  message: {
    id: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32",
    conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
    role: "assistant",
    body: "This chat was deleted while the answer was being prepared, so the answer was discarded.",
    evidence: []
  }
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
assert.equal(assistantResponseSchema.shape.message.safeParse({
  id: "c6f055c0-b137-4713-9f5f-c2ee0b78ab32",
  conversationId: "4de47155-28c2-4e19-8628-d15f339ce71b",
  role: "assistant",
  body: "Quick Note saved.",
  quickNote,
  quickNoteResult: {
    id: "df44a21f-e540-48ea-9f40-7e6b4c3bd753",
    title: quickNote.title,
    revision: 1,
    createdAt: new Date().toISOString(),
    notebookId: null,
    notebookName: null,
    href: "/workspace?view=notes&note=df44a21f-e540-48ea-9f40-7e6b4c3bd753"
  }
}).success, true);

const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
const usageService = readFileSync("apps/api/src/services/assistantUsage.ts", "utf8");
const documentRepository = readFileSync("apps/api/src/repository/documentTranslations.ts", "utf8");
const contentRepository = readFileSync("apps/api/src/repository/contentTranslations.ts", "utf8");
const scribbles = readFileSync("apps/api/src/repository/workspaceScribbles.ts", "utf8");
const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const route = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const assistantAttachmentRoute = readFileSync("app/api/assistant-attachments/[attachmentId]/route.ts", "utf8");
const attachmentRepository = readFileSync("apps/api/src/repository/attachments.ts", "utf8");
const attachmentOwnership = readFileSync("apps/api/src/services/attachmentOwnership.ts", "utf8");
const attachmentUploadClient = readFileSync("features/attachments/attachmentUploadClient.ts", "utf8");
const attachmentRules = readFileSync("lib/attachmentRules.ts", "utf8");
const assistantRouteSupport = readFileSync("lib/assistantRouteSupport.ts", "utf8");
const assistantShell = readFileSync("features/assistant/AssistantExperience.tsx", "utf8");
const assistantContextDock = readFileSync("features/assistant/AssistantContextDock.tsx", "utf8");
const assistantEvidenceMap = readFileSync("features/assistant/AssistantEvidenceMap.tsx", "utf8");
const assistantMessageBody = readFileSync("features/assistant/AssistantMessageBody.tsx", "utf8");
const assistantMessageCard = readFileSync("features/assistant/AssistantMessageCard.tsx", "utf8");
const assistantQuickNoteCards = readFileSync("features/assistant/AssistantQuickNoteCards.tsx", "utf8");
const assistantThreadHistoryItem = readFileSync("features/assistant/AssistantThreadHistoryItem.tsx", "utf8");
const assistantPresentation = readFileSync("features/assistant/assistantPresentation.ts", "utf8");
const assistantContextPolicy = readFileSync("lib/assistantContext.ts", "utf8");
const tablet = [
  assistantShell,
  assistantContextDock,
  assistantEvidenceMap,
  assistantMessageBody,
  assistantMessageCard,
  assistantQuickNoteCards,
  assistantThreadHistoryItem,
  assistantPresentation
].join("\n");
const assistantControllerHook = readFileSync("features/assistant/useAssistantController.ts", "utf8");
const assistantControllerModel = readFileSync("features/assistant/assistantControllerModel.ts", "utf8");
const assistantController = [
  assistantControllerHook,
  assistantControllerModel
].join("\n");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const liveController = readFileSync(
  "features/live-sync/useSymposiumLiveController.ts",
  "utf8"
);
const canonicalRoutes = readFileSync("features/navigation/canonicalRoute.ts", "utf8");
const assistantPage = readFileSync("app/assistant/page.tsx", "utf8");
const assistantThreadPage = readFileSync("app/assistant/threads/[threadId]/page.tsx", "utf8");
const attachmentContext = readFileSync("features/assistant/tabletAttachmentContext.ts", "utf8");
const attachmentViews = readFileSync("features/attachments/AttachmentViews.tsx", "utf8");
const documentTranslationControl = readFileSync("features/attachments/DocumentTranslationControl.tsx", "utf8");
const translationLanguagePicker = readFileSync("features/translation/TranslationLanguagePicker.tsx", "utf8");
const contentTranslationSession = readFileSync("features/translation/contentTranslationSession.ts", "utf8");
const documentViewerSession = readFileSync("features/attachments/documentViewerSession.ts", "utf8");
const browserSessionPersistence = readFileSync("lib/browserSessionPersistence.ts", "utf8");
const contentTranslationControl = readFileSync("features/translation/ContentTranslationControl.tsx", "utf8");
const tabletStyles = readFileSync("styles/92-ai-tablet.css", "utf8");
const postViews = readFileSync("features/posts/PostViews.tsx", "utf8");
const commentThread = readFileSync("features/comments/CommentThread.tsx", "utf8");
const profileViews = readFileSync("features/profiles/ProfileViews.tsx", "utf8");
const attachmentModal = readFileSync("features/attachments/AttachmentPreviewModal.tsx", "utf8");
const pdfClient = readFileSync("features/attachments/pdfAttachmentClient.ts", "utf8");
const attachmentStyles = readFileSync("styles/20-content-core.css", "utf8");
const packageManifest = readFileSync("package.json", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const renderBlueprint = readFileSync("render.yaml", "utf8");
const env = readFileSync("apps/api/src/config/env.ts", "utf8");

assert.match(assistantShell, /AssistantContextDock/);
assert.match(assistantShell, /AssistantMessageCard/);
assert.match(assistantShell, /AssistantThreadHistoryItem/);
assert.doesNotMatch(assistantShell, /symposiumApi|useNativeCitation|nativeSourceForAssistantCitation/);
assert.doesNotMatch(assistantShell, /function QuickNoteDraftCard|function ContextDock|function ThreadHistoryItem/);
assert.match(assistantQuickNoteCards, /\/api\/assistant\/quick-notes/);
assert.match(assistantQuickNoteCards, /Confirm & save Quick Note/);
assert.match(assistantEvidenceMap, /nativeSourceForAssistantCitation/);
assert.match(assistantEvidenceMap, /stageCitation/);
assert.match(assistantContextDock, /assistantContextKey\(context\)/);
assert.match(assistantContextPolicy, /assistantContextTypeForSurface/);
assert.match(repository, /assistantContextTypeForSurface/);
assert.match(repository, /assistantContextKey/);
assert.doesNotMatch(repository, /const assistantContextKey|const assistantContextTypeFor/);
assert.match(assistantController, /assistantContextTypeForSurface/);
assert.match(assistantController, /assistantContextKey/);
assert.doesNotMatch(assistantController, /const contextKeyFor|const contextTypeFor/);
assert.match(assistantControllerHook, /const runContextMutation = useCallback/);
assert.match(assistantControllerHook, /runContextMutation<AssistantContextUpdateResultContract>/);
assert.match(assistantControllerHook, /runContextMutation<AssistantSourceUpdateResultContract>/);
assert.equal(
  assistantControllerHook.match(
    /This thread changed in another session\. The latest Context Dock state is loaded/g
  )?.length,
  1,
  "Context and source writes must share one revision-conflict recovery path"
);
const restoreViewStart = shell.indexOf("const restoreView");
const navigateViewStart = shell.indexOf("const navigateView", restoreViewStart);
const restoreViewBlock = shell.slice(restoreViewStart, navigateViewStart);
const navigateViewBlock = shell.slice(navigateViewStart, shell.indexOf("const enterRoom", navigateViewStart));
const assistantWorkspaceBaseBlock = tabletStyles.slice(
  tabletStyles.indexOf(".assistant-workspace {"),
  tabletStyles.indexOf(".assistant-workspace .assistant-left")
);

assert.match(provider, /store: false/);
assert.match(provider, /service_tier: "default"/);
assert.match(provider, /max_output_tokens: assistantMaxOutputTokens\(input\.intent, \{\s+actionDraft: Boolean\(input\.actionDraftRequested\),\s+draftEdit: Boolean\(input\.draftSession\)\s+\}\)/);
assert.match(provider, /type: "json_schema"/);
assert.match(provider, /strict: true/);
assert.match(provider, /symposium-translation-v2/);
assert.match(provider, /"symposium-general-chat-v1"/);
assert.match(provider, /"symposium-contextual-tablet-vision-v1"/);
assert.match(provider, /"symposium-contextual-tablet-v3"/);
assert.match(provider, /reasoning: \{ effort: "none" \}/);
assert.match(provider, /symposium-document-page-translation-v7/);
assert.match(provider, /symposium-content-translation-v4/);
assert.match(provider, /documentTranslationRequestContent\(input\.request\)/);
assert.match(provider, /insufficient_quota/);
assert.match(repository, /providerErrorCode/);
assert.match(repository, /last_message_at AS "lastMessageAt"/);
assert.match(repository, /conversation\.pinned_at IS NOT NULL\) DESC,[\s\S]*conversation\.last_message_at DESC/);
assert.match(repository, /message\.body ILIKE \$\$\{values\.length\} ESCAPE/);
assert.match(repository, /conversation\.archived_at IS NOT NULL/);
assert.match(repository, /conversation\.archived_at IS NULL/);
assert.match(repository, /conversation\.deleted_at IS NULL/);
assert.match(repository, /SET last_message_at = GREATEST/);
assert.match(repository, /mode === "clear"/);
assert.match(repository, /active_source_id = NULL/);
assert.match(repository, /active_context_key = NULL/);
assert.match(repository, /JSON\.stringify\(source \? \[source\] : \[\]\)/);
assert.match(repository, /grounding: context \? "sources" : "none"/);
assert.match(repository, /Attach a Symposium source before starting a source translation/);
assert.match(repository, /new Date\(source\.attachedAt\)\.toISOString\(\)/);
assert.match(migration, /0056_recover_assistant_sources_and_message_activity/);
assert.match(migration, /assistant_historical_source_recovery/);
assert.match(migration, /message\.metadata -> 'context'/);
assert.match(migration, /'provenance', 'recovered'/);
assert.match(migration, /assistant_message\.metadata -> 'evidence'/);
assert.match(migration, /ai_conversations_owner_kind_last_message_idx/);
assert.match(migration, /0057_assistant_chat_library/);
assert.match(migration, /0058_assistant_message_attachments/);
assert.match(migration, /0059_bounded_assistant_vision/);
assert.match(migration, /ai_usage_vision_input_count_check/);
assert.match(migration, /owner_type IN \('post', 'comment', 'message', 'assistant_message'/);
assert.match(migration, /attachments_assistant_message_owner_idx/);
assert.match(migration, /pinned_at TIMESTAMPTZ/);
assert.match(migration, /archived_at TIMESTAMPTZ/);
assert.match(migration, /deleted_at TIMESTAMPTZ/);
assert.match(migration, /metadata_revision INTEGER NOT NULL DEFAULT 1/);
assert.match(migration, /ai_conversations_active_library_idx/);
assert.match(migration, /ai_conversations_archived_library_idx/);
assert.match(migration, /ai_conversations_title_trgm_idx/);
assert.match(migration, /ai_messages_body_trgm_idx/);
assert.match(migration, /ai_conversations_metadata_revision_check/);
assert.match(assistantController, /orderAssistantThreadsByLatestMessage/);
assert.doesNotMatch(assistantController, /findActiveThreadForContext/);
assert.doesNotMatch(
  assistantController,
  /activeContextKey === contextKey[\s\S]*?openThread\(matching\.id\)/
);
assert.match(
  assistantController,
  /void refreshThreads\(\)\.catch\([\s\S]*?Research-thread history could not be loaded\.[\s\S]*?setThreadLoading\(false\)/
);
assert.match(assistantController, /threadListRequestRef\.current \+= 1/);
assert.match(assistantController, /explicitNewThreadRef\.current = true/);
assert.match(assistantController, /suppressedRequestedConversationIdRef\.current = conversationIdRef\.current \?\? null/);
assert.match(assistantController, /suppressedRequestedConversationIdRef\.current === requestedConversationId/);
assert.match(assistantController, /setThreadLibraryFilters/);
assert.match(assistantController, /loadMoreThreads/);
assert.match(assistantController, /operation: "changed" \| "deleted"/);
assert.match(assistantController, /change\.operation === "deleted"/);
assert.match(assistantController, /event\.kind\.startsWith\("assistant\."\)/);
assert.match(assistantController, /assistant\.thread\.deleted/);
assert.match(assistantController, /threadMutationRetryRef/);
assert.match(tablet, /candidate\.lastMessageAt/);
assert.match(tablet, /Search titles and messages/);
assert.match(tablet, /Load more chats/);
assert.match(tablet, /Delete this chat permanently/);
assert.match(tablet, /This chat is archived/);
assert.match(tablet, /Restore this chat to continue/);
assert.match(tablet, /Inspect saved context/);
assert.match(tablet, /Stored source text/);
assert.match(tablet, /Start a new blank chat/);
assert.match(tablet, /Remove chat context/);
assert.match(tablet, /Add current view/);
assert.match(assistantController, /What’s on your mind\?/);
assert.match(tablet, /source\.provenance === "recovered"/);
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
assert.match(migration, /0062_canonical_owner_daily_ai_quota_reset_20260727/);
assert.match(migration, /WHERE profile\.handle IN \('@udayan', '@bantz'\)/);
assert.match(migration, /0049_assistant_research_threads/);
assert.match(migration, /context_sources JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
assert.match(migration, /0050_assistant_context_dock_translation/);
assert.match(migration, /0051_translation_layout_fidelity/);
assert.match(migration, /0052_document_view_continuity/);
assert.match(migration, /0053_failed_ai_usage_accounting/);
assert.match(migration, /0054_expand_translation_languages/);
assert.match(migration, /0055_persist_assistant_quick_note_results/);
assert.match(migration, /'simplified_chinese', 'sanskrit'/);
assert.match(migration, /actual_cost_micros = 0[\s\S]*error_code IN/);
assert.match(migration, /kind TEXT NOT NULL DEFAULT 'research_thread'/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS content_translations/);
assert.match(repository, /listAssistantConversations/);
assert.match(repository, /getAssistantConversation/);
assert.match(repository, /updateAssistantConversation/);
assert.match(repository, /deleteAssistantConversation/);
assert.match(repository, /updateAssistantConversationContext/);
assert.match(repository, /updateAssistantConversationSource/);
assert.match(repository, /assistant\.thread\.update/);
assert.match(repository, /assistant\.thread\.delete/);
assert.match(repository, /DELETE FROM ai_messages WHERE conversation_id = \$1/);
assert.match(repository, /title = 'Deleted chat'/);
assert.match(repository, /preservedUsageLedger: true/);
assert.doesNotMatch(repository, /DELETE FROM ai_conversations/);
assert.match(repository, /SELECT deleted_at AS "deletedAt"[\s\S]*FOR UPDATE/);
assert.match(repository, /status: "discarded"/);
assert.match(repository, /assistant\.message\.discard/);
assert.match(repository, /reason: "conversation_deleted"/);
assert.match(repository, /answer was discarded/);
assert.match(assistantController, /response\.status === "discarded"/);
assert.match(assistantController, /Boolean\(thread\?\.archivedAt\)/);
assert.doesNotMatch(assistantController, /thread\?\.archivedAt !== null/);
assert.match(repository, /assistant\.context\.updated/);
assert.match(repository, /kind = 'research_thread'/);
assert.match(repository, /origin_source_id/);
assert.match(repository, /buildAssistantEvidence/);
assert.match(repository, /validateAssistantEvidenceSources/);
assert.match(repository, /attachedContexts/);
assert.match(route, /shared: true, scope: "assistant", limit: 10/);
assert.match(route, /\/v1\/assistant\/conversations\/:id\/context/);
assert.match(route, /\/v1\/assistant\/conversations\/:id\/sources/);
assert.match(route, /app\.patch<\{ Params: RouteParams \}>\("\/v1\/assistant\/conversations\/:id"/);
assert.match(route, /app\.delete<\{ Params: RouteParams \}>\("\/v1\/assistant\/conversations\/:id"/);
assert.equal(typeof updateAssistantConversationRoute, "function");
assert.equal(typeof deleteAssistantConversationRoute, "function");
assert.match(assistantRouteSupport, /proxyLiveApiRequest/);
assert.match(assistantRouteSupport, /readJson<AssistantRequestBody>/);
assert.match(assistantRouteSupport, /workspaceActorHandle\(request, body\?\.actorHandle\)/);
assert.match(assistantRouteSupport, /status: 503/);
assert.match(assistantRouteSupport, /"Cache-Control": "no-store"/);
assert.doesNotMatch(assistantRouteSupport, /localStorage|fallback/i);
assert.match(route, /\/v1\/assistant\/document-translations/);
assert.match(route, /\/v1\/assistant\/content-translations/);
assert.match(route, /\/v1\/assistant\/quick-notes/);
assert.match(route, /\/v1\/assistant-attachments\/:attachmentId\/access/);
assert.match(route, /assertAssistantAttachmentAccess/);
assert.match(assistantAttachmentRoute, /createProtectedAttachmentRoute/);
assert.match(repository, /attachment\.owner_type = 'assistant_message'/);
assert.match(repository, /conversation\.owner_handle = \$2/);
assert.match(repository, /replaceOwnerAttachments\(client/);
assert.match(repository, /ownerType: "assistant_message"/);
assert.match(repository, /input\.intent === "translate" && attachmentIds\.length/);
assert.match(repository, /Whole-file translation is paused in this limited beta/);
assert.match(repository, /queueAttachmentsForOwnerStorageDeletion/);
assert.match(repository, /"assistant_chat_deleted"/);
assert.match(repository, /maxAssistantAttachmentBytes/);
assert.match(repository, /assistantAttachmentContext/);
assert.match(repository, /bounded text preview extracted/);
assert.match(attachmentRepository, /input\.ownerType === "assistant_message"/);
assert.match(attachmentOwnership, /"assistant_message"/);
assert.match(attachmentUploadClient, /validateAssistantAttachmentDetails/);
assert.match(attachmentUploadClient, /\/api\/assistant-attachments\//);
assert.match(attachmentRules, /maxAssistantAttachmentBytes = 5 \* 1024 \* 1024/);
assert.match(route, /scope: "assistant-action", limit: 30/);
assert.match(scribbles, /conversation\.owner_handle = \$3/);
assert.match(scribbles, /assistant\.quick_note\.create/);
assert.match(scribbles, /assistant_quick_note/);
assert.match(scribbles, /FOR UPDATE OF message, conversation/);
assert.match(scribbles, /quickNoteResult: value/);
assert.match(scribbles, /existingResult\.success/);
assert.match(tablet, /Limited beta/);
assert.match(tablet, /Loading allowance/);
assert.match(tablet, /Send message · uses 1 AI answer/);
assert.match(tablet, /Files up to 5 MB/);
assert.match(tablet, /uploads use no\s+answer/);
assert.match(tablet, /at most 2 images per answer/);
assert.match(tablet, /documents use bounded extracted text/);
assert.match(tablet, /Image ready for AI/);
assert.match(tablet, /aria-label="Attach files"/);
assert.match(tablet, /className="tablet-attachment-input"/);
assert.match(tabletStyles, /\.tablet-attachment-input \{ display: none; \}/);
assert.match(tablet, /AttachmentPreviewModal/);
assert.match(assistantController, /attachmentIds: submittedAttachmentIds/);
assert.match(assistantController, /ownerType: "assistant_message"/);
assert.match(assistantController, /attachmentDraftsRef/);
assert.match(assistantController, /submissionThreadRequest/);
assert.match(assistantController, /Whole-file translation is paused in this limited beta/);
assert.match(assistantController, /Ask about this view/);
assert.match(tablet, /Confirm & save Quick Note/);
assert.match(tablet, /Office destination/);
assert.match(tablet, /All · Quick Notes/);
assert.match(tablet, /Create & select/);
assert.match(tablet, /savedQuickNote=\{message\.quickNoteResult\}/);
assert.match(tablet, /useState\(mode === "workspace"\)/);
assert.match(tablet, /setContextDockOpen\(mode === "workspace"\)/);
assert.match(assistantController, /synchronizeThreadMutation/);
assert.match(assistantController, /assistantRequestIntentFor\(message\)/);
assert.match(assistantController, /Name a supported target language/);
assert.match(tablet, /New chat/);
assert.match(tablet, /Context Dock/);
assert.doesNotMatch(tablet, /Ask anything · add Symposium context when useful/);
assert.match(tablet, /This page/);
assert.match(tablet, /Capture update/);
assert.match(tablet, /Use this page/);
assert.match(tablet, /Add page/);
assert.match(tablet, /Evidence map/);
assert.match(tablet, /message\.claims/);
assert.match(provider, /shouldOfferQuickNote/);
assert.doesNotMatch(tablet, /Opening and browsing cost nothing/);
assert.doesNotMatch(tablet, /tablet-context-card/);
assert.doesNotMatch(tablet, /tablet-translation-controls/);
assert.doesNotMatch(tablet, /tablet-prompts/);
assert.match(provider, /If the user asks for a translation/);
assert.match(shell, /surface: "messages"/);
assert.match(shell, /surface: "workspace"/);
assert.match(shell, /surface: "attachment"/);
assert.match(shell, /const toggleTablet = \(\) => \{[\s\S]*?if \(assistantOpen\)[\s\S]*?collapseAssistantToTablet\(assistantThreadId\)[\s\S]*?if \(tabletOpen\)[\s\S]*?assistantOpen: true/);
assert.match(shell, /const assistantCollapseThreadIdRef = useRef<string \| null \| undefined>\(undefined\)/);
assert.match(shell, /const collapseAssistantToTablet = \(threadId: string \| null\) => \{[\s\S]*?assistantCollapseThreadIdRef\.current = threadId;[\s\S]*?goBack\(\)/);
assert.match(restoreViewBlock, /isAssistantCollapse[\s\S]*?replaceViewSnapshot\([\s\S]*?assistantOpen: isAssistantCollapse \? false[\s\S]*?assistantThreadId: isAssistantCollapse[\s\S]*?collapsedAssistantThreadId/);
assert.doesNotMatch(restoreViewBlock, /setTabletOpen\(false\)/);
assert.doesNotMatch(navigateViewBlock, /setTabletOpen\(false\)/);
assert.match(shell, /title=\{assistantOpen \? "Collapse AI Workspace to Tablet" : tabletOpen \? "Expand AI Tablet" : "Open AI Tablet"\}/);
assert.match(shell, /aria-expanded=\{tabletOpen \|\| assistantOpen\}/);
assert.match(shell, /\{tabletOpen \|\| assistantOpen \? \([\s\S]*?mode=\{assistantOpen \? "workspace" : "compact"\}/);
assert.match(shell, /assistantThreadId: assistantController\.conversationId \?\? null/);
assert.match(shell, /enabled: tabletOpen \|\| assistantOpen/);
assert.match(shell, /liveEvents: assistantEvents/);
assert.match(liveController, /appendAssistantEvent/);
assert.match(liveController, /setAssistantBuffer/);
assert.doesNotMatch(shell, /event\.kind\.startsWith\("assistant\."\)|setAssistantEvents/);
assert.match(tablet, /Expand to AI Workspace/);
assert.match(tablet, /Collapse to AI Tablet/);
assert.match(tablet, /Search chats/);
assert.match(tablet, /data-mobile-pane=\{mobilePane\}/);
assert.match(tablet, /aria-pressed=\{mobilePane === "threads"\}/);
assert.match(tablet, /aria-pressed=\{mobilePane === "chat"\}/);
assert.match(tablet, /aria-pressed=\{mobilePane === "context" && rightPanel === "context"\}/);
assert.match(tablet, /aria-pressed=\{mobilePane === "context" && rightPanel === "draft"\}/);
assert.match(tablet, /className="tablet-thread-current assistant-panel-title" aria-label="Assistant chat history"/);
assert.match(tablet, /<strong>Assistant<\/strong>/);
assert.match(tablet, /\{thread \? <small>\{thread\.sourceCount\} active source/);
assert.doesNotMatch(tablet, /activeContext \? "Current view ready" : "No context attached"/);
assert.doesNotMatch(tablet, /<span><BrainCircuit size=\{16\} \/>AI Workspace<\/span>/);
assert.doesNotMatch(tablet, /assistant-chat-heading/);
assert.match(tablet, /\{mode === "compact" \? \(\s*<div className=\{`tablet-active-context/);
assert.match(tablet, /`Context · \$\{activeContext\.title\}`/);
assert.match(tablet, /"Plain chat · No context"/);
assert.doesNotMatch(tablet, /<small>\{activeContext \? "Using context" : "Plain chat"\}<\/small>/);
assert.match(tablet, /\{mode === "workspace" \? \(\s*<aside className="assistant-right"/);
assert.match(tablet, /onCollapse=\{onCollapse\}/);
assert.match(tablet, /className="assistant-collapse-control"/);
assert.match(tablet, /ref=\{composerRef\}/);
assert.match(tablet, /lineHeight \* 4 \+ verticalChrome/);
assert.match(tablet, /rows=\{2\}/);
assert.match(tablet, /aria-label="Message Symposium AI"/);
assert.match(tablet, /event\.key === "Enter" && !event\.shiftKey/);
assert.match(tablet, /event\.preventDefault\(\);\s*submitForm\(\);/);
assert.match(tablet, /aria-label="Send message · uses 1 AI answer"/);
assert.match(tablet, /title="Send message · uses 1 AI answer"/);
assert.doesNotMatch(tablet, /<Send size=\{15\} \/><span>Send · uses 1<\/span>/);
assert.match(tablet, /\{pendingAttachments\.length \? \(\s*<small className="tablet-attachment-limit">/);
assert.match(tablet, /\$\{remainingToday\}\/\$\{dailyLimit\} answers · \$\$\{monthlyBudgetUsd\} shared cap/);
assert.match(assistantController, /limit: "20"/);
assert.match(assistantController, /if \(!enabled\) return;/);
assert.match(assistantController, /new BroadcastChannel\(assistantBroadcastChannel\)/);
assert.match(assistantController, /This thread changed in another session/);
assert.match(assistantController, /actorHandleRef/);
assert.match(assistantController, /submissionLockRef/);
assert.match(assistantController, /contextLockRef/);
assert.match(assistantController, /messageRetryRef/);
assert.match(assistantController, /contextRetryRef/);
assert.match(assistantController, /sourceRetryRef/);
assert.match(assistantController, /threadActionLockRef/);
assert.match(assistantController, /const startNewThread = useCallback\(\([\s\S]*?requestedAttemptRef\.current = null/);
assert.match(assistantController, /if \(!requestedConversationId\) \{[\s\S]*?requestedAttemptRef\.current = null;[\s\S]*?return;/);
assert.match(tabletStyles, /\.assistant-compact \.assistant-thread-filters/);
assert.match(tabletStyles, /\.tablet-composer-main[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto/);
assert.match(tabletStyles, /\.tablet-composer \.tablet-send-button[\s\S]*?min-width: 2\.65rem[\s\S]*?width: 2\.65rem/);
assert.match(tabletStyles, /\.tablet-active-context > span[\s\S]*?display: flex/);
assert.match(tabletStyles, /\.tablet-transcript[\s\S]*?gap: 0\.58rem[\s\S]*?padding: 0\.66rem 0\.62rem/);
assert.match(tabletStyles, /\.tablet-message-body[\s\S]*?padding: 0\.55rem 0\.66rem/);
assert.match(tabletStyles, /\.assistant-workspace \.assistant-center[\s\S]*?height: calc\(100% \+ var\(--symposium-side-tool-bottom\) - var\(--symposium-shell-edge\)\)/);
assert.match(tabletStyles, /\.assistant-workspace \.tablet-thread-bar[\s\S]*?min-height: 3\.25rem/);
assert.match(tabletStyles, /\.assistant-collapse-control/);
const assistantLauncherHidingBlock = tabletStyles.match(
  /\.symposium-shell\[data-view="assistant"\] :is\(([\s\S]*?)\)\s*\{\s*display: none;/
)?.[1] ?? "";
assert.doesNotMatch(assistantLauncherHidingBlock, /\.scribble-launcher/);
assert.match(shell, /<ScribbleLauncher \/>/);
assert.match(tabletStyles, /\.assistant-thread-filters/);
assert.match(tabletStyles, /\.assistant-thread-popover/);
assert.match(tabletStyles, /\.assistant-archived-notice/);
assert.match(tabletStyles, /@media \(max-width: 760px\) and \(max-height: 640px\)/);
assert.match(tabletStyles, /@media \(max-width: 1100px\)[\s\S]*?\.assistant-workspace\[data-mobile-pane="threads"\]/);
assert.match(tabletStyles, /@media \(max-width: 1100px\) and \(max-height: 640px\)/);
assert.match(assistantWorkspaceBaseBlock, /gap: 12px/);
assert.match(assistantWorkspaceBaseBlock, /--assistant-aligned-side-width: calc\([\s\S]*?var\(--symposium-side-tool-width\) - var\(--symposium-shell-edge\)[\s\S]*?\)/);
assert.match(assistantWorkspaceBaseBlock, /grid-template-columns:[\s\S]*?minmax\(0, var\(--assistant-aligned-side-width\)\)[\s\S]*?minmax\(24rem, 1fr\)[\s\S]*?minmax\(0, var\(--assistant-aligned-side-width\)\)/);
assert.match(assistantWorkspaceBaseBlock, /overflow: visible/);
assert.doesNotMatch(assistantWorkspaceBaseBlock, /background:|box-shadow:|border:/);
assert.match(tabletStyles, /\.assistant-workspace \.assistant-left,[\s\S]*?border-radius: 14px/);
assert.doesNotMatch(tabletStyles, /--assistant-history-width|--assistant-context-width/);
assert.match(canonicalRoutes, /\/assistant\/threads\/\$\{encoded\(route\.threadId\)\}/);
assert.match(canonicalRoutes, /canonicalAssistantBackdropIds/);
assert.match(canonicalRoutes, /new URLSearchParams\(\{ backdrop: route\.backdrop \}\)/);
assert.match(assistantPage, /kind: "assistant"/);
assert.match(assistantThreadPage, /kind: "assistant", threadId/);
assert.match(shell, /assistantBackdropForView/);
assert.match(shell, /assistantBackdropRender/);
assert.match(shell, /setAssistantOriginContext\(tabletContext\)/);
assert.match(shell, /const assistantVisibleContext =/);
assert.match(shell, /assistantOpen && assistantBackdrop === "messages"/);
assert.match(shell, /context: assistantVisibleContext/);
assert.match(shell, /data-assistant-backdrop=\{activeAssistantBackdrop \?\? undefined\}/);
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
assert.match(attachmentViews, /const imageDataUrl = await renderPdfPageTranslationImage\(document, boundedPage\)/);
assert.doesNotMatch(attachmentViews, /pdfPageNeedsVisualTranslationFallback/);
const visionTranslationCanvasBlock = attachmentViews.match(
  /if \(visionTranslationBlocks\.length\) \{([\s\S]*?)\n      return;\n    \}/
)?.[1] ?? "";
assert.doesNotMatch(
  visionTranslationCanvasBlock,
  /fillRect\(0, 0, translationCanvas\.width, translationCanvas\.height\)/
);
assert.ok(
  visionTranslationCanvasBlock.indexOf("visionTranslationBlocks.forEach") <
  visionTranslationCanvasBlock.indexOf("preservedArtifacts.forEach")
);
assert.match(attachmentViews, /const textBandLeft = translationCanvas\.width \* 0\.025/);
assert.match(attachmentViews, /const textBandWidth = translationCanvas\.width \* 0\.95/);
assert.match(attachmentViews, /DocumentTranslationControl state=\{translation\}/);
assert.match(documentTranslationControl, /TranslationLanguagePicker/);
assert.match(documentTranslationControl, /This translates the current page/);
assert.match(documentTranslationControl, /Document formatting can shift/);
assert.match(documentTranslationControl, /reading guide/);
assert.match(documentTranslationControl, /DocumentTranslationGuidance/);
assert.match(documentTranslationControl, /TriangleAlert/);
assert.match(attachmentViews, /attachment-document-has-guidance/);
assert.match(attachmentStyles, /\.attachment-document-has-guidance\s*\{\s*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/);
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
assert.match(contentRepository, /unsupportedTranslationLanguageMessage/);
assert.match(contentTranslationControl, /Translate entire \{sourceLabel\}/);
assert.match(contentTranslationControl, /Only a completed translation uses 1 answer/);
assert.match(contentTranslationControl, /Translate · 1 answer/);
assert.match(contentTranslationControl, /Original/);
assert.match(contentTranslationControl, /TranslationLanguagePicker/);
assert.match(translationLanguagePicker, /role="combobox"/);
assert.match(translationLanguagePicker, /role="listbox"/);
assert.match(translationLanguagePicker, /Type to filter languages/);
assert.match(translationLanguagePicker, /filterTranslationLanguageOptions/);
assert.match(translationLanguagePicker, /pattern=\{translationLanguageSelectionPattern\}/);
assert.match(translationLanguagePicker, /required/);
assert.match(translationLanguagePicker, /scrollIntoView\(\{ block: "nearest" \}\)/);
assert.match(tabletStyles, /\.translation-language-listbox/);
assert.match(tabletStyles, /\.feed-post:has\(\.content-translation-menu\)[\s\S]*overflow: visible/);
assert.match(attachmentStyles, /\.post-attachments:has\(\.document-translation-popover\)[\s\S]*overflow: visible/);
assert.match(attachmentStyles, /\.stage:has\(\.document-translation-popover\),[\s\S]*\.stage:has\(\.content-translation-menu\)/);
assert.match(attachmentStyles, /@media \(max-width: 680px\)[\s\S]*\.attachment-pagebar \.document-translation-control[\s\S]*position: static/);
assert.match(attachmentStyles, /@media \(max-width: 680px\)[\s\S]*\.attachment-modal-fullscreen \.attachment-modal-header-controls[\s\S]*flex-wrap: wrap[\s\S]*width: 100%/);
assert.match(attachmentStyles, /\.attachment-modal-fullscreen \.attachment-modal-header-controls > \*,[\s\S]*\.attachment-modal-fullscreen \.attachment-zoom-controls[\s\S]*flex: 0 0 auto/);
assert.match(contentTranslationControl, /translatedDocumentForSource/);
assert.doesNotMatch(contentTranslationControl, /content-translation-copy/);
assert.match(contentTranslationControl, /readContentTranslationSession/);
assert.match(contentTranslationControl, /rememberContentTranslationSession/);
assert.match(contentTranslationControl, /subscribeContentTranslationSession/);
assert.match(contentTranslationControl, /viewerHandle/);
assert.match(contentTranslationControl, /resultSessionIdentityKey === sessionIdentityKey/);
assert.equal(
  contentTranslationControl.match(/setResult\(response\)/g)?.length,
  1,
  "Only a completed translation may replace the remembered translated result"
);
assert.match(browserSessionPersistence, /window\.localStorage/);
assert.match(contentTranslationSession, /window\.addEventListener\("storage"/);
assert.match(browserSessionPersistence, /browserSessionPersistenceCookieName/);
assert.match(browserSessionPersistence, /SameSite=Lax/);
assert.match(contentTranslationSession, /sessionId/);
assert.match(contentTranslationSession, /maxContentTranslationSessionEntries = 12/);
assert.match(contentTranslationSession, /contentTranslationResultSchema\.safeParse/);
assert.match(contentTranslationSession, /legacyContentTranslationSessionStorageKey/);
assert.match(postViews, /sourceType: "post",[\s\S]*viewerHandle: actorHandle/);
assert.match(commentThread, /sourceType: "comment",[\s\S]*viewerHandle: actorHandle/);
assert.match(profileViews, /sourceType: "comment",[\s\S]*viewerHandle: actorHandle/);
assert.match(postViews, /<ScribbleCitable source=\{postScribbleSource\(item\)\}>[\s\S]*translation\.showTranslation[\s\S]*<TranslatedContent/);
assert.match(commentThread, /<ScribbleCitable source=\{scribbleSource\}>[\s\S]*translation\.showTranslation[\s\S]*<TranslatedContent/);
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
assert.match(documentViewerSession, /window\.addEventListener\("storage"/);
assert.match(documentViewerSession, /documentViewerSessionStorageKey/);
assert.match(documentViewerSession, /documentTranslationResultSchema\.safeParse/);
assert.match(documentViewerSession, /sessionId/);
assert.match(attachmentStyles, /min-height: var\(--docx-original-page-height/);
assert.match(attachmentStyles, /\.attachment-pdf-parallel-canvas/);
assert.match(attachmentStyles, /\.attachment-pdf-parallel-text-layer/);
assert.match(attachmentStyles, /\.attachment-text-parallel-page/);
assert.match(provider, /layoutBlocks for each natural-language region/);
assert.match(provider, /symposium-document-page-translation-v7/);
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
