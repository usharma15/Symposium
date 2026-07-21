import { createHash } from "node:crypto";
import {
  documentTranslationInputSchema,
  documentTranslationResultSchema,
  type AssistantTranslationLanguageContract,
  type DocumentTranslationInputContract,
  type DocumentTranslationPageContract,
  type DocumentTranslationResultContract
} from "../../../../packages/contracts/src";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { actualCostMicros } from "../services/aiBudget";
import { assistantQuota, completeAssistantUsage, reserveAssistantUsage } from "../services/assistantUsage";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  assistantProviderFailure,
  callDocumentTranslationModel,
  documentTranslationMaxOutputTokens,
  documentTranslationRenderedInput,
  type AssistantProviderFailure,
  type DocumentTranslationModelResult
} from "../services/openaiResponses";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type ParsedInput = ReturnType<typeof documentTranslationInputSchema.parse>;
type TranslationCacheRow = {
  attachmentId: string;
  sourceFingerprint: string;
  sourceComplete: boolean;
  targetLanguage: AssistantTranslationLanguageContract;
  targetLanguageLabel: string;
  translatedTitle: string;
  pages: DocumentTranslationPageContract[];
  model: string;
  createdAt: Date | string;
};

type PreparedTranslation = {
  owner: string;
  input: ParsedInput;
  sourceFingerprint: string;
  conversationId: string;
  usageId: string;
  reservedCostMicros: number;
  dailyLimit: number;
  remainingToday: number;
};

const languageLabels: Record<AssistantTranslationLanguageContract, string> = {
  english: "English",
  french: "French",
  german: "German",
  spanish: "Spanish"
};

const languageAliases: Record<AssistantTranslationLanguageContract, string[]> = {
  english: ["english", "anglais", "ingles", "englisch"],
  french: ["french", "francais", "franzosisch", "frances"],
  german: ["german", "deutsch", "allemand", "aleman"],
  spanish: ["spanish", "espanol", "spanisch", "espagnol"]
};

const normalizedInstruction = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z]+/g, " ")
  .trim();

export const supportedLanguageFromInstruction = (value: string): AssistantTranslationLanguageContract | null => {
  const words = new Set(normalizedInstruction(value).split(/\s+/).filter(Boolean));
  const matches = (Object.entries(languageAliases) as Array<[AssistantTranslationLanguageContract, string[]]>)
    .filter(([, aliases]) => aliases.some((alias) => words.has(alias)))
    .map(([language]) => language);
  return matches.length === 1 ? matches[0]! : null;
};

export const documentTranslationFingerprint = (input: DocumentTranslationInputContract) => createHash("sha256")
  .update(JSON.stringify({
    attachmentId: input.attachmentId,
    sourceTitle: input.sourceTitle,
    sourceKind: input.sourceKind,
    sourceComplete: input.sourceComplete,
    sourcePages: input.sourcePages
  }))
  .digest("hex");

const currentQuota = async (owner: string) => {
  const usage = await getPool().query<{ usedToday: number }>(
    `WITH quota_reset AS (
       SELECT COALESCE(max(reset_at), date_trunc('day', now())) AS reset_at
       FROM ai_daily_quota_resets
       WHERE owner_handle = $1 AND usage_day = current_date
     )
     SELECT count(*)::int AS "usedToday"
     FROM ai_usage CROSS JOIN quota_reset
     WHERE owner_handle = $1 AND created_at >= quota_reset.reset_at`,
    [owner]
  );
  return assistantQuota(
    env.SYMPOSIUM_AI_USER_DAILY_LIMIT,
    env.SYMPOSIUM_AI_USER_DAILY_LIMIT - (usage.rows[0]?.usedToday ?? 0)
  );
};

const findCachedTranslation = async (
  attachmentId: string,
  sourceFingerprint: string,
  targetLanguage: AssistantTranslationLanguageContract
) => {
  const result = await getPool().query<TranslationCacheRow>(
    `SELECT
       attachment_id AS "attachmentId",
       source_fingerprint AS "sourceFingerprint",
       source_complete AS "sourceComplete",
       target_language AS "targetLanguage",
       target_language_label AS "targetLanguageLabel",
       translated_title AS "translatedTitle",
       pages,
       model,
       created_at AS "createdAt"
     FROM document_translations
     WHERE attachment_id = $1 AND source_fingerprint = $2 AND target_language = $3
     LIMIT 1`,
    [attachmentId, sourceFingerprint, targetLanguage]
  );
  return result.rows[0] ?? null;
};

const cachedResult = async (row: TranslationCacheRow, owner: string): Promise<DocumentTranslationResultContract> => ({
  status: "translated",
  attachmentId: row.attachmentId,
  sourceFingerprint: row.sourceFingerprint,
  sourceComplete: row.sourceComplete,
  cached: true,
  targetLanguage: row.targetLanguage,
  targetLanguageLabel: languageLabels[row.targetLanguage],
  translatedTitle: row.translatedTitle,
  pages: row.pages,
  message: "Reused the saved translation. No AI answer was consumed.",
  model: row.model,
  createdAt: new Date(row.createdAt).toISOString(),
  quota: await currentQuota(owner)
});

const disabledResult = (
  input: ParsedInput,
  sourceFingerprint: string,
  message: string
): DocumentTranslationResultContract => ({
  status: "disabled",
  attachmentId: input.attachmentId,
  sourceFingerprint,
  sourceComplete: input.sourceComplete,
  cached: false,
  targetLanguage: null,
  targetLanguageLabel: null,
  translatedTitle: "",
  pages: [],
  message,
  model: env.SYMPOSIUM_AI_MODEL,
  createdAt: new Date().toISOString(),
  quota: assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, 0)
});

const prepareTranslation = async (
  input: ParsedInput,
  sourceFingerprint: string,
  owner: string,
  mutation?: MutationContext
): Promise<PreparedTranslation | { replayed: DocumentTranslationResultContract }> => runAtomic<PreparedTranslation | { replayed: DocumentTranslationResultContract }>(async (client) => {
  const claim = await claimMutation<DocumentTranslationResultContract>(client, owner, mutation);
  if (claim.replayed) return { value: { replayed: documentTranslationResultSchema.parse(claim.response) } };

  const conversation = await client.query<{ id: string }>(
    `INSERT INTO ai_conversations (owner_handle, title, context_type, context_id)
     VALUES ($1, $2, 'attachment', $3)
     RETURNING id`,
    [owner, `Translate ${input.sourceTitle}`.slice(0, 120), input.attachmentId]
  );
  const conversationId = conversation.rows[0]!.id;
  const reservation = await reserveAssistantUsage(client, {
    owner,
    conversationId,
    renderedInput: documentTranslationRenderedInput(input),
    maxOutputTokens: documentTranslationMaxOutputTokens(input)
  });
  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, input.languageInstruction, JSON.stringify({
      source: "document_translation",
      attachmentId: input.attachmentId,
      sourceFingerprint,
      sourceKind: input.sourceKind,
      sourceComplete: input.sourceComplete
    })]
  );
  return {
    value: {
      owner,
      input,
      sourceFingerprint,
      conversationId,
      usageId: reservation.usageId,
      reservedCostMicros: reservation.reservedCostMicros,
      dailyLimit: reservation.dailyLimit,
      remainingToday: reservation.remainingToday
    }
  };
});

const finalizeTranslation = async (
  prepared: PreparedTranslation,
  modelResult: DocumentTranslationModelResult | null,
  failure: AssistantProviderFailure | null,
  mutation?: MutationContext
): Promise<DocumentTranslationResultContract> => runAtomic(async (client) => {
  const providerError = !modelResult;
  const output = modelResult?.output;
  const targetLanguage = output && output.targetLanguage !== "unsupported" ? output.targetLanguage : null;
  const status: DocumentTranslationResultContract["status"] = providerError
    ? "provider_error"
    : targetLanguage
      ? "translated"
      : "unsupported_language";
  const message = providerError
    ? failure?.body ?? "The AI provider could not translate this document. This failed attempt still uses one daily answer."
    : targetLanguage
      ? prepared.input.sourceComplete
        ? `${languageLabels[targetLanguage]} translation ready for page ${prepared.input.sourcePages[0]!.pageNumber}.`
        : `${languageLabels[targetLanguage]} translation ready for the available text on page ${prepared.input.sourcePages[0]!.pageNumber}; that page's text extraction was incomplete.`
      : output?.message || "Type English, French, German, or Spanish.";
  const actualMicros = modelResult
    ? actualCostMicros(env.SYMPOSIUM_AI_MODEL, modelResult.inputTokens, modelResult.outputTokens)
    : prepared.reservedCostMicros;

  await completeAssistantUsage(client, {
    usageId: prepared.usageId,
    owner: prepared.owner,
    providerError,
    actualCostMicros: actualMicros,
    inputTokens: modelResult?.inputTokens ?? 0,
    cachedInputTokens: modelResult?.cachedInputTokens ?? 0,
    cacheWriteTokens: modelResult?.cacheWriteTokens ?? 0,
    outputTokens: modelResult?.outputTokens ?? 0,
    providerResponseId: modelResult?.providerResponseId,
    errorCode: failure?.code
  });

  const createdAt = new Date().toISOString();
  const response: DocumentTranslationResultContract = {
    status,
    attachmentId: prepared.input.attachmentId,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceComplete: prepared.input.sourceComplete,
    cached: false,
    targetLanguage,
    targetLanguageLabel: targetLanguage ? languageLabels[targetLanguage] : null,
    translatedTitle: targetLanguage ? output?.translatedTitle ?? "" : "",
    pages: targetLanguage ? output?.pages ?? [] : [],
    message,
    model: modelResult?.model ?? env.SYMPOSIUM_AI_MODEL,
    createdAt,
    quota: assistantQuota(prepared.dailyLimit, prepared.remainingToday)
  };
  documentTranslationResultSchema.parse(response);

  if (status === "translated" && targetLanguage) {
    await client.query(
      `INSERT INTO document_translations (
         attachment_id, source_fingerprint, source_title, source_kind, source_complete,
         target_language, target_language_label, translated_title, pages, model, creator_handle
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (attachment_id, source_fingerprint, target_language) DO NOTHING`,
      [
        prepared.input.attachmentId,
        prepared.sourceFingerprint,
        prepared.input.sourceTitle,
        prepared.input.sourceKind,
        prepared.input.sourceComplete,
        targetLanguage,
        languageLabels[targetLanguage],
        response.translatedTitle,
        JSON.stringify(response.pages),
        response.model,
        prepared.owner
      ]
    );
  }

  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'assistant', $2, $3)`,
    [prepared.conversationId, message, JSON.stringify({
      source: "document_translation",
      status,
      sourceFingerprint: prepared.sourceFingerprint,
      targetLanguage,
      providerResponseId: modelResult?.providerResponseId ?? null,
      providerErrorCode: failure?.code ?? null
    })]
  );
  await client.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1", [prepared.conversationId]);
  await stageAuditLog(client, {
    actorHandle: prepared.owner,
    action: "assistant.document.translate",
    subjectType: "attachment",
    subjectId: prepared.input.attachmentId,
    metadata: mutationAuditMetadata(mutation, {
      sourceFingerprint: prepared.sourceFingerprint,
      sourceKind: prepared.input.sourceKind,
      sourceComplete: prepared.input.sourceComplete,
      targetLanguage,
      status,
      model: response.model,
      actualCostMicros: actualMicros
    })
  });
  await completeMutation(client, prepared.owner, mutation, response);
  const event = await stageEvent(client, {
    kind: "assistant.document.translation.created",
    actorHandle: prepared.owner,
    subjectType: "attachment",
    subjectId: prepared.input.attachmentId,
    visibility: "private",
    payload: { status, targetLanguage, sourceFingerprint: prepared.sourceFingerprint }
  });
  return { value: response, events: [event] };
});

export const translateDocument = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<DocumentTranslationResultContract> => {
  const input = documentTranslationInputSchema.parse(rawInput);
  const sourceFingerprint = documentTranslationFingerprint(input);
  if (!env.SYMPOSIUM_AI_ENABLED) {
    return disabledResult(input, sourceFingerprint, "Document translation is currently switched off.");
  }
  if (!env.OPENAI_API_KEY) {
    return disabledResult(input, sourceFingerprint, "The document translation provider is not configured.");
  }
  if (!hasDatabase()) {
    return disabledResult(input, sourceFingerprint, "Document translation requires the durable live usage ledger.");
  }

  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const requestedLanguage = supportedLanguageFromInstruction(input.languageInstruction);
  if (requestedLanguage) {
    const cached = await findCachedTranslation(input.attachmentId, sourceFingerprint, requestedLanguage);
    if (cached) return cachedResult(cached, owner);
  }

  const prepared = await prepareTranslation(input, sourceFingerprint, owner, mutation);
  if ("replayed" in prepared) return prepared.replayed;

  let result: DocumentTranslationModelResult | null = null;
  let failure: AssistantProviderFailure | null = null;
  try {
    result = await callDocumentTranslationModel({ ownerHandle: owner, request: input });
  } catch (error) {
    failure = assistantProviderFailure(error);
    console.error("SYMPOSIUM document translation request failed.", error);
  }
  return finalizeTranslation(prepared, result, failure, mutation);
};
