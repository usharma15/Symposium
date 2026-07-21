import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actualCostMicros, conservativeInputTokenCeiling, reserveCostMicros, usdToMicros } from "@/apps/api/src/services/aiBudget";
import { assistantDailyLimitFor } from "@/apps/api/src/services/assistantQuota";
import {
  assistantInstructions,
  assistantMaxOutputTokens,
  assistantPrompt,
  assistantProviderFailure,
  assistantRenderedInput,
  assistantTranslationInstructions,
  documentTranslationInstructions,
  documentTranslationMaxOutputTokens,
  documentTranslationRequestContent,
  documentTranslationRenderedInput
} from "@/apps/api/src/services/openaiResponses";
import {
  documentTranslationFingerprint,
  supportedLanguageFromInstruction
} from "@/apps/api/src/repository/documentTranslations";
import {
  assistantMessageInputSchema,
  assistantQuickNoteResultSchema,
  assistantResponseSchema,
  assistantTranslationDraftSchema,
  saveAssistantQuickNoteInputSchema,
  documentTranslationInputSchema,
  documentTranslationModelOutputSchema,
  documentTranslationResultSchema
} from "@/packages/contracts/src";
import { buildTabletAttachmentContext, tabletAttachmentTextLimit } from "@/features/assistant/tabletAttachmentContext";
import {
  pdfPageNeedsVisualTranslationFallback,
  pdfTextItemsToPlainText,
  resolvePdfDocumentUrl
} from "@/features/attachments/pdfAttachmentClient";

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
assert.match(assistantPrompt(validInput.context, validInput.message), /CURRENT VIEW/);
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
const permanentUserPolicy = { baseLimit: 10 };
assert.equal(assistantDailyLimitFor("@udayan", "2026-07-20", permanentUserPolicy), 10);
assert.equal(assistantDailyLimitFor("@someone_else", "2030-01-01", permanentUserPolicy), 10);
assert.match(assistantProviderFailure(new DOMException("timed out", "TimeoutError")).body, /request timeout/);

const documentTranslationInput = {
  attachmentId: "attachment-docx-1",
  sourceTitle: "Persuasive Framework.docx",
  sourceKind: "docx" as const,
  sourcePages: [{ pageNumber: 7, body: "Persuasive Framework\nFund independent youth labs." }],
  sourceComplete: true,
  languageInstruction: "Please put this into Spanish"
};
assert.equal(documentTranslationInputSchema.safeParse(documentTranslationInput).success, true);
assert.equal(documentTranslationInputSchema.safeParse({
  ...documentTranslationInput,
  sourcePages: [
    ...documentTranslationInput.sourcePages,
    { pageNumber: 8, body: "Evidence and objections." }
  ]
}).success, false);
assert.equal(documentTranslationInputSchema.safeParse({
  ...documentTranslationInput,
  sourcePages: [{ pageNumber: 1, body: "x".repeat(12_001) }]
}).success, false);
const scannedPdfTranslationInput = {
  ...documentTranslationInput,
  attachmentId: "attachment-pdf-scan-1",
  sourceKind: "pdf" as const,
  sourcePages: [{ pageNumber: 1, body: "", imageDataUrl: "data:image/jpeg;base64,YWJj" }]
};
assert.equal(documentTranslationInputSchema.safeParse(scannedPdfTranslationInput).success, true);
assert.equal(documentTranslationInputSchema.safeParse({
  ...scannedPdfTranslationInput,
  sourcePages: [{ pageNumber: 1, body: "" }]
}).success, false);
assert.equal(documentTranslationInputSchema.safeParse({
  ...scannedPdfTranslationInput,
  sourcePages: [{ pageNumber: 1, body: "", imageDataUrl: "data:text/html;base64,YWJj" }]
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
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) >= 800);
assert.ok(documentTranslationMaxOutputTokens(documentTranslationInput) <= 6000);
assert.equal(documentTranslationMaxOutputTokens(scannedPdfTranslationInput), 6000);
assert.equal(pdfPageNeedsVisualTranslationFallback("Short title"), true);
assert.equal(pdfPageNeedsVisualTranslationFallback("x".repeat(200)), false);
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Marco persuasivo",
  pages: [{ pageNumber: 7, body: "Marco persuasivo\nFinanciar laboratorios juveniles independientes." }],
  message: "Spanish translation ready."
}).success, true);
assert.equal(documentTranslationModelOutputSchema.safeParse({
  targetLanguage: "unsupported",
  targetLanguageLabel: "",
  translatedTitle: "",
  pages: [{ pageNumber: 1, body: "Not allowed" }],
  message: "Use a supported language."
}).success, false);
const sourceFingerprint = documentTranslationFingerprint(documentTranslationInput);
assert.match(sourceFingerprint, /^[a-f0-9]{64}$/);
assert.equal(sourceFingerprint, documentTranslationFingerprint(documentTranslationInput));
assert.notEqual(sourceFingerprint, documentTranslationFingerprint({ ...documentTranslationInput, sourceComplete: false }));
assert.equal(documentTranslationResultSchema.safeParse({
  status: "translated",
  attachmentId: documentTranslationInput.attachmentId,
  sourceFingerprint,
  sourceComplete: true,
  cached: false,
  targetLanguage: "spanish",
  targetLanguageLabel: "Spanish",
  translatedTitle: "Marco persuasivo",
  pages: [{ pageNumber: 7, body: "Marco persuasivo" }],
  message: "Spanish translation ready.",
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
const scribbles = readFileSync("apps/api/src/repository/workspaceScribbles.ts", "utf8");
const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const route = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const tablet = readFileSync("features/workspace/WorkspacePanels.tsx", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const attachmentContext = readFileSync("features/assistant/tabletAttachmentContext.ts", "utf8");
const attachmentViews = readFileSync("features/attachments/AttachmentViews.tsx", "utf8");
const documentTranslationControl = readFileSync("features/attachments/DocumentTranslationControl.tsx", "utf8");
const attachmentModal = readFileSync("features/attachments/AttachmentPreviewModal.tsx", "utf8");
const pdfClient = readFileSync("features/attachments/pdfAttachmentClient.ts", "utf8");
const packageManifest = readFileSync("package.json", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const renderBlueprint = readFileSync("render.yaml", "utf8");
const env = readFileSync("apps/api/src/config/env.ts", "utf8");

assert.match(provider, /store: false/);
assert.match(provider, /service_tier: "default"/);
assert.match(provider, /max_output_tokens: assistantMaxOutputTokens\(input\.intent\)/);
assert.match(provider, /type: "json_schema"/);
assert.match(provider, /strict: true/);
assert.match(provider, /symposium-translation-v1/);
assert.match(provider, /prompt_cache_key: translating \? "symposium-translation-v1" : "symposium-contextual-tablet-v2"/);
assert.match(provider, /reasoning: \{ effort: "none" \}/);
assert.match(provider, /symposium-document-page-translation-v3/);
assert.match(provider, /documentTranslationRequestContent\(input\.request\)/);
assert.match(provider, /insufficient_quota/);
assert.match(repository, /providerErrorCode/);
assert.match(usageService, /pg_advisory_xact_lock\(hashtextextended\('symposium:ai-budget'/);
assert.match(usageService, /current\.userMinute >= 2/);
assert.match(usageService, /current\.inFlight >= 1/);
assert.match(repository, /getAssistantQuota/);
assert.match(repository, /SYMPOSIUM_AI_USER_DAILY_LIMIT/);
assert.match(repository, /assistantQuota\(prepared\.dailyLimit, prepared\.remainingToday\)/);
assert.match(usageService, /SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT/);
assert.match(usageService, /SYMPOSIUM_AI_DAILY_BUDGET_USD/);
assert.match(usageService, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD/);
assert.match(migration, /0037_ai_usage_budget_ledger/);
assert.match(migration, /reserved_cost_micros BIGINT NOT NULL/);
assert.match(migration, /0038_document_translation_cache/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS document_translations/);
assert.match(route, /shared: true, scope: "assistant", limit: 10/);
assert.match(route, /\/v1\/assistant\/document-translations/);
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
assert.match(provider, /shouldOfferQuickNote/);
assert.doesNotMatch(tablet, /Opening and browsing cost nothing/);
assert.doesNotMatch(tablet, /tablet-context-card/);
assert.doesNotMatch(tablet, /tablet-translation-controls/);
assert.doesNotMatch(tablet, /tablet-prompts/);
assert.match(provider, /If the user asks for a translation/);
assert.match(shell, /surface: "messages"/);
assert.match(shell, /surface: "workspace"/);
assert.match(shell, /surface: "attachment"/);
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
assert.match(documentTranslationControl, /placeholder="e\.g\. Spanish"/);
assert.match(documentTranslationControl, /Due to limited usage restriction this beta translates one page at a time/);
assert.match(documentTranslationControl, /TriangleAlert/);
assert.match(documentTranslationControl, /Original/);
assert.match(documentTranslationControl, /Translation/);
assert.match(documentTranslationControl, /Translate · uses 1/);
assert.match(documentRepository, /findCachedTranslation/);
assert.match(documentRepository, /No AI answer was consumed/);
assert.match(documentRepository, /reserveAssistantUsage/);
assert.doesNotMatch(attachmentViews, /<iframe[^>]+title=\{attachment\.fileName\}/);
assert.match(attachmentModal, /kind: "pdf-text", page, excerpt/);
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
