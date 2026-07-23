import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  contentTranslationInputSchema,
  contentTranslationModelInputSchema,
  contentTranslationResultSchema,
  documentPlainTextProjection,
  versionedDocumentSchema,
  type AssistantTranslationLanguageContract,
  type ContentTranslationModelInputContract,
  type ContentTranslationResultContract,
  type TranslationResultSegmentContract,
  type TranslationSourceSegmentContract,
  type VersionedDocumentContract
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
  callContentTranslationModel,
  contentTranslationMaxOutputTokens,
  contentTranslationRenderedInput,
  type AssistantProviderFailure,
  type ContentTranslationModelResult
} from "../services/openaiResponses";
import { supportedLanguageFromInstruction, translationLanguageLabels } from "../services/translationLanguages";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type ParsedInput = ReturnType<typeof contentTranslationInputSchema.parse>;
type ContentSource = ContentTranslationModelInputContract;
type TranslationCacheRow = {
  sourceType: "post" | "comment";
  sourceId: string;
  sourceRevision: number;
  sourceFingerprint: string;
  targetLanguage: AssistantTranslationLanguageContract;
  targetLanguageLabel: string;
  translatedTitle: string;
  translatedBody: string;
  translatedDocument: unknown;
  model: string;
  createdAt: Date | string;
};
type PreparedTranslation = {
  owner: string;
  source: ContentSource;
  sourceFingerprint: string;
  requestedLanguage: AssistantTranslationLanguageContract;
  conversationId: string;
  usageId: string;
  reservedCostMicros: number;
  dailyLimit: number;
  remainingToday: number;
};

const plainTextDocument = (body: string): VersionedDocumentContract => ({
  version: 1,
  nodes: body.replace(/\r\n/g, "\n").split(/\n{2,}/).map((paragraph, index) => ({
    id: `translation-plain-${index}`,
    type: "paragraph" as const,
    content: paragraph ? [{ text: paragraph }] : [],
    align: "left" as const,
    indent: 0
  })),
  settings: { width: "standard", margin: "normal" }
});

const sourceDocument = (document: unknown, fallback: string) => {
  const parsed = versionedDocumentSchema.safeParse(document);
  return parsed.success ? parsed.data : plainTextDocument(fallback);
};

const sourceSegments = (document: VersionedDocumentContract): TranslationSourceSegmentContract[] => {
  const segments: TranslationSourceSegmentContract[] = [];
  const add = (id: string, text: string | undefined) => {
    if (text?.trim()) segments.push({ id, text });
  };
  document.nodes.forEach((node, nodeIndex) => {
    const prefix = `n${nodeIndex}`;
    if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
      node.content.forEach((run, runIndex) => add(`${prefix}:r${runIndex}`, run.text));
      return;
    }
    if (node.type === "list") {
      node.items.forEach((item, itemIndex) => {
        item.forEach((run, runIndex) => add(`${prefix}:i${itemIndex}:r${runIndex}`, run.text));
      });
      return;
    }
    if (node.type === "code") {
      return;
    }
    if (node.type === "equation") {
      return;
    }
    if (node.type === "drawing" || node.type === "attachment") {
      add(`${prefix}:caption`, node.caption);
      return;
    }
    if (node.type === "reference") {
      add(`${prefix}:resource`, node.resource.label);
      return;
    }
    if (node.type === "citation") {
      add(`${prefix}:label`, node.label);
      add(`${prefix}:excerpt`, node.excerpt);
    }
  });
  if (segments.length > 0) return segments;

  return [{
    id: "fallback:body",
    text: documentPlainTextProjection(document).trim() || "Content"
  }];
};

const translatedDocument = (
  document: VersionedDocumentContract,
  translatedSegments: TranslationResultSegmentContract[]
): VersionedDocumentContract => {
  const translated = new Map(translatedSegments.map((segment) => [segment.id, segment.text]));
  return {
    ...document,
    nodes: document.nodes.map((node, nodeIndex) => {
      const prefix = `n${nodeIndex}`;
      if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
        return {
          ...node,
          content: node.content.map((run, runIndex) => ({
            ...run,
            text: translated.get(`${prefix}:r${runIndex}`) ?? run.text
          }))
        };
      }
      if (node.type === "list") {
        return {
          ...node,
          items: node.items.map((item, itemIndex) => item.map((run, runIndex) => ({
            ...run,
            text: translated.get(`${prefix}:i${itemIndex}:r${runIndex}`) ?? run.text
          })))
        };
      }
      if (node.type === "code" || node.type === "equation") return node;
      if (node.type === "drawing" || node.type === "attachment") {
        return { ...node, caption: translated.get(`${prefix}:caption`) ?? node.caption };
      }
      if (node.type === "reference") {
        return {
          ...node,
          resource: {
            ...node.resource,
            label: translated.get(`${prefix}:resource`) ?? node.resource.label
          }
        };
      }
      if (node.type === "citation") {
        return {
          ...node,
          label: translated.get(`${prefix}:label`) ?? node.label,
          excerpt: translated.get(`${prefix}:excerpt`) ?? node.excerpt
        };
      }
      return node;
    })
  };
};

const loadContentSource = async (input: ParsedInput, owner: string): Promise<ContentSource> => {
  if (input.sourceType === "post") {
    const result = await getPool().query<{
      id: string;
      title: string;
      body: string;
      document: unknown;
      revision: number;
    }>(
      `SELECT
         post.id,
         post.title,
         post.body,
         post.content_document AS document,
         post.revision
       FROM posts post
       LEFT JOIN communities community ON community.id = post.community_id
       LEFT JOIN community_memberships membership
         ON membership.community_id = post.community_id
        AND membership.profile_handle = $2
        AND membership.status = 'active'
       WHERE post.id = $1
         AND post.deleted_at IS NULL
         AND (
           post.community_id IS NULL
           OR post.post_type = 'paper'
           OR community.visibility = 'public'
           OR membership.profile_handle IS NOT NULL
           OR post.author_handle = $2
         )
       LIMIT 1`,
      [input.sourceId, owner]
    );
    const row = result.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That post is unavailable or you no longer have access to it." });
    const document = sourceDocument(row.document, row.body);
    return contentTranslationModelInputSchema.parse({
      ...input,
      sourceRevision: row.revision,
      sourceTitle: row.title,
      sourceBody: documentPlainTextProjection(document) || row.body,
      sourceDocument: document,
      sourceSegments: sourceSegments(document)
    });
  }

  const result = await getPool().query<{
    id: string;
    authorName: string;
    postTitle: string;
    body: string;
    document: unknown;
    revision: number;
  }>(
    `SELECT
       comment.id,
       comment.author_name AS "authorName",
       post.title AS "postTitle",
       comment.body,
       comment.content_document AS document,
       comment.revision
     FROM comments comment
     JOIN posts post ON post.id = comment.post_id
     LEFT JOIN communities community ON community.id = post.community_id
     LEFT JOIN community_memberships membership
       ON membership.community_id = post.community_id
      AND membership.profile_handle = $2
      AND membership.status = 'active'
     WHERE comment.id = $1
       AND comment.deleted_at IS NULL
       AND post.deleted_at IS NULL
       AND (
         post.community_id IS NULL
         OR post.post_type = 'paper'
         OR community.visibility = 'public'
         OR membership.profile_handle IS NOT NULL
         OR post.author_handle = $2
         OR comment.author_handle = $2
       )
     LIMIT 1`,
    [input.sourceId, owner]
  );
  const row = result.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That comment is unavailable or you no longer have access to it." });
  const document = sourceDocument(row.document, row.body);
  return contentTranslationModelInputSchema.parse({
    ...input,
    sourceRevision: row.revision,
    sourceTitle: `Comment by ${row.authorName} on ${row.postTitle}`.slice(0, 300),
    sourceBody: documentPlainTextProjection(document) || row.body,
    sourceDocument: document,
    sourceSegments: sourceSegments(document)
  });
};

export const contentTranslationFingerprint = (source: ContentSource) => createHash("sha256")
  .update(JSON.stringify({
    policy: 2,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    sourceTitle: source.sourceTitle,
    sourceBody: source.sourceBody,
    sourceDocument: source.sourceDocument,
    sourceSegments: source.sourceSegments
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
  source: ContentSource,
  sourceFingerprint: string,
  targetLanguage: AssistantTranslationLanguageContract
) => {
  const result = await getPool().query<TranslationCacheRow>(
    `SELECT
       source_type AS "sourceType",
       source_id AS "sourceId",
       source_revision AS "sourceRevision",
       source_fingerprint AS "sourceFingerprint",
       target_language AS "targetLanguage",
       target_language_label AS "targetLanguageLabel",
       translated_title AS "translatedTitle",
       translated_body AS "translatedBody",
       translated_document AS "translatedDocument",
       model,
       created_at AS "createdAt"
     FROM content_translations
     WHERE source_type = $1
       AND source_id = $2
       AND source_fingerprint = $3
       AND target_language = $4
     LIMIT 1`,
    [source.sourceType, source.sourceId, sourceFingerprint, targetLanguage]
  );
  return result.rows[0] ?? null;
};

const cachedResult = async (row: TranslationCacheRow, owner: string): Promise<ContentTranslationResultContract> => {
  const parsedDocument = versionedDocumentSchema.safeParse(row.translatedDocument);
  return {
    status: "translated",
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    sourceFingerprint: row.sourceFingerprint,
    cached: true,
    targetLanguage: row.targetLanguage,
    targetLanguageLabel: translationLanguageLabels[row.targetLanguage],
    translatedTitle: row.translatedTitle,
    translatedBody: row.translatedBody,
    translatedDocument: parsedDocument.success ? parsedDocument.data : plainTextDocument(row.translatedBody),
    message: "Reused the saved translation. No AI answer was consumed.",
    model: row.model,
    createdAt: new Date(row.createdAt).toISOString(),
    quota: await currentQuota(owner)
  };
};

const noSpendResult = async (
  source: ContentSource,
  sourceFingerprint: string,
  owner: string,
  status: "unsupported_language" | "disabled",
  message: string
): Promise<ContentTranslationResultContract> => ({
  status,
  sourceType: source.sourceType,
  sourceId: source.sourceId,
  sourceRevision: source.sourceRevision,
  sourceFingerprint,
  cached: false,
  targetLanguage: null,
  targetLanguageLabel: null,
  translatedTitle: "",
  translatedBody: "",
  translatedDocument: null,
  message,
  model: env.SYMPOSIUM_AI_MODEL,
  createdAt: new Date().toISOString(),
  quota: status === "disabled"
    ? assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, 0)
    : await currentQuota(owner)
});

const prepareTranslation = async (
  source: ContentSource,
  sourceFingerprint: string,
  requestedLanguage: AssistantTranslationLanguageContract,
  owner: string,
  mutation?: MutationContext
): Promise<PreparedTranslation | { replayed: ContentTranslationResultContract }> => runAtomic<
  PreparedTranslation | { replayed: ContentTranslationResultContract }
>(async (client) => {
  const claim = await claimMutation<ContentTranslationResultContract>(client, owner, mutation);
  if (claim.replayed) return { value: { replayed: contentTranslationResultSchema.parse(claim.response) } };
  const conversation = await client.query<{ id: string }>(
    `INSERT INTO ai_conversations (owner_handle, kind, title, context_type, context_id)
     VALUES ($1, 'content_translation', $2, $3, $4)
     RETURNING id`,
    [
      owner,
      `Translate ${source.sourceTitle}`.slice(0, 120),
      source.sourceType,
      source.sourceId
    ]
  );
  const conversationId = conversation.rows[0]!.id;
  const reservation = await reserveAssistantUsage(client, {
    owner,
    conversationId,
    renderedInput: contentTranslationRenderedInput(source),
    maxOutputTokens: contentTranslationMaxOutputTokens(source)
  });
  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, source.languageInstruction, JSON.stringify({
      source: "content_translation",
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      sourceFingerprint,
      requestedLanguage
    })]
  );
  return {
    value: {
      owner,
      source,
      sourceFingerprint,
      requestedLanguage,
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
  modelResult: ContentTranslationModelResult | null,
  failure: AssistantProviderFailure | null,
  mutation?: MutationContext
): Promise<ContentTranslationResultContract> => runAtomic(async (client) => {
  const validOutput = modelResult?.output.targetLanguage === prepared.requestedLanguage;
  const providerError = !modelResult || !validOutput;
  const output = validOutput ? modelResult.output : null;
  const translatedStructure = output
    ? translatedDocument(prepared.source.sourceDocument, output.translatedSegments)
    : null;
  const translatedBody = translatedStructure ? documentPlainTextProjection(translatedStructure) : "";
  const status: ContentTranslationResultContract["status"] = providerError ? "provider_error" : "translated";
  const message = providerError
    ? failure?.body ?? "The AI provider returned an invalid content translation. This failed attempt still uses one daily answer."
    : `${translationLanguageLabels[prepared.requestedLanguage]} translation ready for this ${prepared.source.sourceType}.`;
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
    errorCode: failure?.code ?? (!validOutput ? "translation_language_mismatch" : undefined)
  });
  const response: ContentTranslationResultContract = {
    status,
    sourceType: prepared.source.sourceType,
    sourceId: prepared.source.sourceId,
    sourceRevision: prepared.source.sourceRevision,
    sourceFingerprint: prepared.sourceFingerprint,
    cached: false,
    targetLanguage: providerError ? null : prepared.requestedLanguage,
    targetLanguageLabel: providerError ? null : translationLanguageLabels[prepared.requestedLanguage],
    translatedTitle: output?.translatedTitle ?? "",
    translatedBody,
    translatedDocument: translatedStructure,
    message,
    model: modelResult?.model ?? env.SYMPOSIUM_AI_MODEL,
    createdAt: new Date().toISOString(),
    quota: assistantQuota(prepared.dailyLimit, prepared.remainingToday)
  };
  contentTranslationResultSchema.parse(response);
  if (status === "translated") {
    await client.query(
      `INSERT INTO content_translations (
         source_type, source_id, source_revision, source_fingerprint, source_title,
         target_language, target_language_label, translated_title, translated_body,
         translated_document, model, creator_handle
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (source_type, source_id, source_fingerprint, target_language) DO NOTHING`,
      [
        prepared.source.sourceType,
        prepared.source.sourceId,
        prepared.source.sourceRevision,
        prepared.sourceFingerprint,
        prepared.source.sourceTitle,
        prepared.requestedLanguage,
        translationLanguageLabels[prepared.requestedLanguage],
        response.translatedTitle,
        response.translatedBody,
        JSON.stringify(response.translatedDocument),
        response.model,
        prepared.owner
      ]
    );
  }
  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'assistant', $2, $3)`,
    [prepared.conversationId, message, JSON.stringify({
      source: "content_translation",
      status,
      sourceFingerprint: prepared.sourceFingerprint,
      targetLanguage: response.targetLanguage,
      providerResponseId: modelResult?.providerResponseId ?? null,
      providerErrorCode: failure?.code ?? null
    })]
  );
  await client.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1", [prepared.conversationId]);
  await stageAuditLog(client, {
    actorHandle: prepared.owner,
    action: "assistant.content.translate",
    subjectType: prepared.source.sourceType,
    subjectId: prepared.source.sourceId,
    metadata: mutationAuditMetadata(mutation, {
      sourceRevision: prepared.source.sourceRevision,
      sourceFingerprint: prepared.sourceFingerprint,
      targetLanguage: response.targetLanguage,
      status,
      model: response.model,
      actualCostMicros: actualMicros
    })
  });
  await completeMutation(client, prepared.owner, mutation, response);
  const event = await stageEvent(client, {
    kind: "assistant.content.translation.created",
    actorHandle: prepared.owner,
    subjectType: prepared.source.sourceType,
    subjectId: prepared.source.sourceId,
    visibility: "private",
    payload: {
      status,
      targetLanguage: response.targetLanguage,
      sourceRevision: prepared.source.sourceRevision,
      sourceFingerprint: prepared.sourceFingerprint
    }
  });
  return { value: response, events: [event] };
});

export const translateContent = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<ContentTranslationResultContract> => {
  const input = contentTranslationInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Content translation requires the durable live usage ledger." });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const source = await loadContentSource(input, owner);
  const sourceFingerprint = contentTranslationFingerprint(source);
  if (!env.SYMPOSIUM_AI_ENABLED) {
    return noSpendResult(source, sourceFingerprint, owner, "disabled", "Content translation is currently switched off.");
  }
  if (!env.OPENAI_API_KEY) {
    return noSpendResult(source, sourceFingerprint, owner, "disabled", "The content translation provider is not configured.");
  }
  const requestedLanguage = supportedLanguageFromInstruction(input.languageInstruction);
  if (!requestedLanguage) {
    return noSpendResult(
      source,
      sourceFingerprint,
      owner,
      "unsupported_language",
      "Choose English, French, German, or Spanish. No AI answer was consumed."
    );
  }
  const cached = await findCachedTranslation(source, sourceFingerprint, requestedLanguage);
  if (cached) return cachedResult(cached, owner);
  const prepared = await prepareTranslation(source, sourceFingerprint, requestedLanguage, owner, mutation);
  if ("replayed" in prepared) return prepared.replayed;
  let result: ContentTranslationModelResult | null = null;
  let failure: AssistantProviderFailure | null = null;
  try {
    result = await callContentTranslationModel({ ownerHandle: owner, request: source });
  } catch (error) {
    failure = assistantProviderFailure(error);
    console.error("SYMPOSIUM content translation request failed.", error);
  }
  return finalizeTranslation(prepared, result, failure, mutation);
};
