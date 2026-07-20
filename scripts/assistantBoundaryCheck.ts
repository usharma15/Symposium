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
  assistantTranslationInstructions
} from "@/apps/api/src/services/openaiResponses";
import {
  assistantMessageInputSchema,
  assistantQuickNoteResultSchema,
  assistantResponseSchema,
  assistantTranslationDraftSchema,
  saveAssistantQuickNoteInputSchema
} from "@/packages/contracts/src";
import { buildTabletAttachmentContext, tabletAttachmentTextLimit } from "@/features/assistant/tabletAttachmentContext";
import { pdfTextItemsToPlainText, resolvePdfDocumentUrl } from "@/features/attachments/pdfAttachmentClient";

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
const temporaryOwnerPolicy = {
  baseLimit: 3,
  ownerHandle: "@udayan",
  ownerOverrideLimit: 10,
  ownerOverrideUsageDay: "2026-07-20"
};
assert.equal(assistantDailyLimitFor("@udayan", "2026-07-20", temporaryOwnerPolicy), 10);
assert.equal(assistantDailyLimitFor("udayan", "2026-07-21", temporaryOwnerPolicy), 3);
assert.equal(assistantDailyLimitFor("@someone_else", "2026-07-20", temporaryOwnerPolicy), 3);
assert.equal(assistantDailyLimitFor("@udayan", "2026-07-20", { ...temporaryOwnerPolicy, ownerOverrideLimit: 2 }), 3);
assert.match(assistantProviderFailure(new DOMException("timed out", "TimeoutError")).body, /45-second safety timeout/);

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
  href: "/workspace?view=notes&note=df44a21f-e540-48ea-9f40-7e6b4c3bd753"
}).success, true);

const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
const scribbles = readFileSync("apps/api/src/repository/workspaceScribbles.ts", "utf8");
const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const route = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const tablet = readFileSync("features/workspace/WorkspacePanels.tsx", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const attachmentContext = readFileSync("features/assistant/tabletAttachmentContext.ts", "utf8");
const attachmentViews = readFileSync("features/attachments/AttachmentViews.tsx", "utf8");
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
assert.match(provider, /prompt_cache_key: translating \? "symposium-translation-v1" : "symposium-contextual-tablet-v1"/);
assert.match(provider, /insufficient_quota/);
assert.match(repository, /providerErrorCode/);
assert.match(repository, /pg_advisory_xact_lock\(hashtextextended\('symposium:ai-budget'/);
assert.match(repository, /current\.userMinute >= 2/);
assert.match(repository, /current\.inFlight >= 1/);
assert.match(repository, /getAssistantQuota/);
assert.match(repository, /SYMPOSIUM_AI_USER_DAILY_LIMIT/);
assert.match(repository, /dailyLimitFor\(owner, current\.usageDay\)/);
assert.match(repository, /quota\(prepared\.dailyLimit, prepared\.remainingToday\)/);
assert.match(repository, /SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT/);
assert.match(repository, /SYMPOSIUM_AI_DAILY_BUDGET_USD/);
assert.match(repository, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD/);
assert.match(migration, /0037_ai_usage_budget_ledger/);
assert.match(migration, /reserved_cost_micros BIGINT NOT NULL/);
assert.match(route, /shared: true, scope: "assistant", limit: 10/);
assert.match(route, /\/v1\/assistant\/quick-notes/);
assert.match(route, /scope: "assistant-action", limit: 30/);
assert.match(scribbles, /conversation\.owner_handle = \$3/);
assert.match(scribbles, /assistant\.quick_note\.create/);
assert.match(scribbles, /source: "assistant_translation"/);
assert.match(tablet, /Extremely limited beta/);
assert.match(tablet, /Loading today’s tiny AI allowance/);
assert.match(tablet, /Send · uses 1/);
assert.match(tablet, /Ask about this view/);
assert.match(tablet, /Confirm & save Quick Note/);
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
assert.match(attachmentViews, /readPdfPageText\(document, pageNumber\)/);
assert.doesNotMatch(attachmentViews, /<iframe[^>]+title=\{attachment\.fileName\}/);
assert.match(attachmentModal, /kind: "pdf-text", page, excerpt/);
assert.match(pdfClient, /maxPdfMetadataPages = 40/);
assert.match(pdfClient, /pdfTextStatus: previewText \? "extracted" : "none"/);
assert.match(packageManifest, /"pdfjs-dist": "6\.1\.200"/);
assert.match(nextConfig, /source: "\/attachment-assets\/:path\*"/);
assert.match(nextConfig, /destination: `\$\{publicAttachmentBaseUrl\}\/\:path\*`/);
assert.match(env, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD:[\s\S]*max\(40\)\.default\(40\)/);
assert.match(env, /SYMPOSIUM_AI_OWNER_DAILY_LIMIT_USAGE_DAY/);
assert.match(renderBlueprint, /SYMPOSIUM_AI_OWNER_DAILY_LIMIT[\s\S]*value: "10"/);
assert.match(renderBlueprint, /SYMPOSIUM_AI_OWNER_DAILY_LIMIT_USAGE_DAY[\s\S]*value: "2026-07-20"/);

console.log("AI Tablet cost and context boundary checks passed.");
