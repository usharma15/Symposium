import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assistantMessageInputSchema,
  type AssistantQuotaStatusContract,
  type AssistantResponseContract
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
  assistantMaxOutputTokens,
  assistantRenderedInput,
  callAssistantModel,
  type AssistantProviderFailure,
  type AssistantModelResult
} from "../services/openaiResponses";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type ParsedInput = ReturnType<typeof assistantMessageInputSchema.parse>;
type HistoryMessage = { role: "user" | "assistant"; body: string };

type PreparedAssistant = {
  owner: string;
  conversationId: string;
  usageId: string;
  reservedCostMicros: number;
  history: HistoryMessage[];
  input: ParsedInput;
  dailyLimit: number;
  remainingToday: number;
};

const unavailableResponse = (
  input: ParsedInput,
  status: "provider_not_configured" | "disabled",
  body: string
): AssistantResponseContract => {
  const conversationId = input.conversationId ?? randomUUID();
  return {
    conversationId,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    status,
    model: env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, env.SYMPOSIUM_AI_USER_DAILY_LIMIT),
    message: {
      id: randomUUID(),
      conversationId,
      role: "assistant",
      body,
      createdAt: new Date().toISOString()
    }
  };
};

export const getAssistantQuota = async (actor: Actor): Promise<AssistantQuotaStatusContract> => {
  if (!hasDatabase()) {
    return {
      enabled: false,
      providerConfigured: Boolean(env.OPENAI_API_KEY),
      model: env.SYMPOSIUM_AI_MODEL,
      quota: assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, 0)
    };
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const usage = await getPool().query<{ usedToday: number; usageDay: string }>(
    `SELECT count(*)::int AS "usedToday", current_date::text AS "usageDay"
     FROM ai_usage
     WHERE owner_handle = $1 AND created_at >= date_trunc('day', now())`,
    [owner]
  );
  const dailyLimit = env.SYMPOSIUM_AI_USER_DAILY_LIMIT;
  return {
    enabled: env.SYMPOSIUM_AI_ENABLED,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    model: env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(dailyLimit, dailyLimit - (usage.rows[0]?.usedToday ?? 0))
  };
};

const prepareAssistant = async (
  input: ParsedInput,
  owner: string,
  mutation?: MutationContext
): Promise<PreparedAssistant | { replayed: AssistantResponseContract }> => runAtomic<PreparedAssistant | { replayed: AssistantResponseContract }>(async (client) => {
  const claim = await claimMutation<AssistantResponseContract>(client, owner, mutation);
  if (claim.replayed) return { value: { replayed: claim.response } };

  let conversationId = input.conversationId;
  let history: HistoryMessage[] = [];
  if (!conversationId) {
    const conversation = await client.query<{ id: string }>(
      `INSERT INTO ai_conversations (owner_handle, title, context_type, context_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [owner, input.message.slice(0, 80), input.contextType, input.contextId ?? input.context.entityId ?? null]
    );
    conversationId = conversation.rows[0]!.id;
  } else {
    const ownedConversation = await client.query(
      "SELECT id FROM ai_conversations WHERE id = $1 AND owner_handle = $2 FOR SHARE",
      [conversationId, owner]
    );
    if (!ownedConversation.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "AI conversation not found." });
    const historyResult = await client.query<HistoryMessage>(
      `SELECT role, body FROM (
         SELECT role, body, created_at
         FROM ai_messages
         WHERE conversation_id = $1 AND role IN ('user', 'assistant')
         ORDER BY created_at DESC
         LIMIT 6
       ) recent ORDER BY created_at ASC`,
      [conversationId]
    );
    history = historyResult.rows;
  }

  const renderedInput = assistantRenderedInput({
    history,
    context: input.context,
    message: input.message,
    intent: input.intent,
    targetLanguage: input.targetLanguage
  });
  const reservation = await reserveAssistantUsage(client, {
    owner,
    conversationId,
    renderedInput,
    maxOutputTokens: assistantMaxOutputTokens(input.intent)
  });
  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, input.message, JSON.stringify({ context: input.context, contextType: input.contextType, contextId: input.contextId ?? null })]
  );
  return {
    value: {
      owner,
      conversationId,
      usageId: reservation.usageId,
      reservedCostMicros: reservation.reservedCostMicros,
      history,
      input,
      dailyLimit: reservation.dailyLimit,
      remainingToday: reservation.remainingToday
    }
  };
});

const finalizeAssistant = async (
  prepared: PreparedAssistant,
  result: AssistantModelResult | null,
  failure: AssistantProviderFailure | null,
  mutation?: MutationContext
): Promise<AssistantResponseContract> => runAtomic(async (client) => {
  const providerError = !result;
  const body = result?.body ?? failure?.body ?? "The AI provider could not complete this answer. This failed beta attempt still uses one daily answer so repeated retries cannot create surprise costs.";
  const translation = result?.translation && prepared.input.targetLanguage
    ? {
        ...result.translation,
        targetLanguage: prepared.input.targetLanguage,
        source: {
          surface: prepared.input.context.surface,
          route: prepared.input.context.route.startsWith("/") ? prepared.input.context.route : "/",
          title: prepared.input.context.title.trim() || "Current view",
          ...(prepared.input.context.entityType ? { entityType: prepared.input.context.entityType } : {}),
          ...(prepared.input.context.entityId ? { entityId: prepared.input.context.entityId } : {})
        }
      }
    : undefined;
  const quickNote = result?.quickNote
    ? {
        ...result.quickNote,
        source: {
          surface: prepared.input.context.surface,
          route: prepared.input.context.route.startsWith("/") ? prepared.input.context.route : "/",
          title: prepared.input.context.title.trim() || "Current view",
          ...(prepared.input.context.entityType ? { entityType: prepared.input.context.entityType } : {}),
          ...(prepared.input.context.entityId ? { entityId: prepared.input.context.entityId } : {})
        }
      }
    : undefined;
  const actualMicros = result
    ? actualCostMicros(env.SYMPOSIUM_AI_MODEL, result.inputTokens, result.outputTokens)
    : prepared.reservedCostMicros;
  const assistantMessage = await client.query<{
    id: string;
    conversationId: string;
    role: "assistant";
    body: string;
    createdAt: Date | string;
  }>(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'assistant', $2, $3)
     RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
    [prepared.conversationId, body, JSON.stringify({
      model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
      providerResponseId: result?.providerResponseId ?? null,
      providerError,
      providerErrorCode: failure?.code ?? null,
      translation: translation ?? null,
      quickNote: quickNote ?? null
    })]
  );
  await completeAssistantUsage(client, {
    usageId: prepared.usageId,
    owner: prepared.owner,
    providerError,
    actualCostMicros: actualMicros,
    inputTokens: result?.inputTokens ?? 0,
    cachedInputTokens: result?.cachedInputTokens ?? 0,
    cacheWriteTokens: result?.cacheWriteTokens ?? 0,
    outputTokens: result?.outputTokens ?? 0,
    providerResponseId: result?.providerResponseId,
    errorCode: failure?.code
  });
  await client.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [
    prepared.conversationId,
    prepared.owner
  ]);
  const row = assistantMessage.rows[0]!;
  const response: AssistantResponseContract = {
    conversationId: prepared.conversationId,
    providerConfigured: true,
    status: providerError ? "provider_error" : "answered",
    model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(prepared.dailyLimit, prepared.remainingToday),
    message: { ...row, createdAt: new Date(row.createdAt).toISOString() },
    ...(translation ? { translation } : {}),
    ...(quickNote ? { quickNote } : {})
  };
  await stageAuditLog(client, {
    actorHandle: prepared.owner,
    action: "assistant.message",
    subjectType: "ai_conversation",
    subjectId: prepared.conversationId,
    metadata: mutationAuditMetadata(mutation, {
      contextId: prepared.input.contextId,
      contextType: prepared.input.contextType,
      surface: prepared.input.context.surface,
      intent: prepared.input.intent,
      targetLanguage: prepared.input.targetLanguage,
      model: response.model,
      status: response.status,
      actualCostMicros: actualMicros
    })
  });
  await completeMutation(client, prepared.owner, mutation, response);
  const event = await stageEvent(client, {
    kind: "assistant.message.created",
    actorHandle: prepared.owner,
    subjectType: "ai_conversation",
    subjectId: prepared.conversationId,
    visibility: "private",
    payload: { messageId: response.message.id, status: response.status }
  });
  return { value: response, events: [event] };
});

export const askAssistant = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantResponseContract> => {
  const input = assistantMessageInputSchema.parse(rawInput);
  if (!env.SYMPOSIUM_AI_ENABLED) {
    return unavailableResponse(input, "disabled", "The AI Tablet is currently switched off. It only runs when the shared cost-controlled beta is explicitly enabled.");
  }
  if (!env.OPENAI_API_KEY) {
    return unavailableResponse(input, "provider_not_configured", "The AI Tablet is ready, but the model provider key has not been configured yet.");
  }
  if (!hasDatabase()) {
    return unavailableResponse(input, "disabled", "The AI Tablet will not spend money without its durable usage ledger. Connect the live database first.");
  }

  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const prepared = await prepareAssistant(input, owner, mutation);
  if ("replayed" in prepared) return prepared.replayed;

  let result: AssistantModelResult | null = null;
  let failure: AssistantProviderFailure | null = null;
  try {
    result = await callAssistantModel({
      ownerHandle: owner,
      history: prepared.history,
      context: input.context,
      message: input.message,
      intent: input.intent,
      targetLanguage: input.targetLanguage
    });
  } catch (error) {
    failure = assistantProviderFailure(error);
    console.error("SYMPOSIUM AI provider request failed.", error);
  }
  return finalizeAssistant(prepared, result, failure, mutation);
};
