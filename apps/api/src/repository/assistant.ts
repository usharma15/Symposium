import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assistantMessageInputSchema,
  type AssistantQuotaStatusContract,
  type AssistantResponseContract
} from "../../../../packages/contracts/src";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { actualCostMicros, reserveCostMicros, usdToMicros } from "../services/aiBudget";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  assistantProviderFailure,
  assistantInstructions,
  assistantPrompt,
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
  remainingToday: number;
};

const quota = (remainingToday: number) => ({
  dailyLimit: env.SYMPOSIUM_AI_USER_DAILY_LIMIT,
  remainingToday: Math.max(0, remainingToday),
  monthlyBudgetUsd: env.SYMPOSIUM_AI_MONTHLY_BUDGET_USD,
  extremelyLimited: true as const
});

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
    quota: quota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT),
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
      quota: quota(0)
    };
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const usage = await getPool().query<{ usedToday: number }>(
    `SELECT count(*)::int AS "usedToday"
     FROM ai_usage
     WHERE owner_handle = $1 AND created_at >= date_trunc('day', now())`,
    [owner]
  );
  return {
    enabled: env.SYMPOSIUM_AI_ENABLED,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    model: env.SYMPOSIUM_AI_MODEL,
    quota: quota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT - (usage.rows[0]?.usedToday ?? 0))
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

  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:ai-budget', 0))");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:ai-user:' || $1, 0))", [owner]);
  const usage = await client.query<{
    userMinute: number;
    userDaily: number;
    globalDaily: number;
    inFlight: number;
    dailyCostMicros: string;
    monthlyCostMicros: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE owner_handle = $1 AND created_at >= now() - interval '60 seconds')::int AS "userMinute",
       count(*) FILTER (WHERE owner_handle = $1 AND created_at >= date_trunc('day', now()))::int AS "userDaily",
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS "globalDaily",
       count(*) FILTER (WHERE owner_handle = $1 AND status = 'reserved' AND created_at >= now() - interval '2 minutes')::int AS "inFlight",
       COALESCE(sum(CASE WHEN status = 'completed' THEN actual_cost_micros ELSE reserved_cost_micros END)
         FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailyCostMicros",
       COALESCE(sum(CASE WHEN status = 'completed' THEN actual_cost_micros ELSE reserved_cost_micros END)
         FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS "monthlyCostMicros"
     FROM ai_usage`,
    [owner]
  );
  const current = usage.rows[0]!;
  if (current.inFlight >= 1) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The AI Tablet only allows one request at a time. Wait for the current answer." });
  }
  if (current.userMinute >= 2) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Extremely limited AI beta: maximum two attempts per minute." });
  }
  if (current.userDaily >= env.SYMPOSIUM_AI_USER_DAILY_LIMIT) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Daily AI limit reached. Each person gets only ${env.SYMPOSIUM_AI_USER_DAILY_LIMIT} answers per day during the extremely limited beta.` });
  }
  if (current.globalDaily >= env.SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The shared AI capacity for today is exhausted. It resets tomorrow." });
  }

  const renderedInput = [
    assistantInstructions,
    ...history.map((entry) => `${entry.role}: ${entry.body}`),
    assistantPrompt(input.context, input.message)
  ].join("\n");
  const reservedCostMicros = reserveCostMicros(
    env.SYMPOSIUM_AI_MODEL,
    renderedInput,
    env.SYMPOSIUM_AI_MAX_OUTPUT_TOKENS
  );
  if (Number(current.dailyCostMicros) + reservedCostMicros > usdToMicros(env.SYMPOSIUM_AI_DAILY_BUDGET_USD)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The shared AI spending limit for today is exhausted. It resets tomorrow." });
  }
  if (Number(current.monthlyCostMicros) + reservedCostMicros > usdToMicros(env.SYMPOSIUM_AI_MONTHLY_BUDGET_USD)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The AI Tablet monthly spending cap has been reached. AI is paused until the next month." });
  }

  const reserved = await client.query<{ id: string }>(
    `INSERT INTO ai_usage (conversation_id, owner_handle, model, reserved_cost_micros)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [conversationId, owner, env.SYMPOSIUM_AI_MODEL, reservedCostMicros]
  );
  await client.query(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, input.message, JSON.stringify({ context: input.context, contextType: input.contextType, contextId: input.contextId ?? null })]
  );
  return {
    value: {
      owner,
      conversationId,
      usageId: reserved.rows[0]!.id,
      reservedCostMicros,
      history,
      input,
      remainingToday: env.SYMPOSIUM_AI_USER_DAILY_LIMIT - current.userDaily - 1
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
      providerErrorCode: failure?.code ?? null
    })]
  );
  await client.query(
    `UPDATE ai_usage SET
       status = $2,
       actual_cost_micros = $3,
       input_tokens = $4,
       cached_input_tokens = $5,
       cache_write_tokens = $6,
       output_tokens = $7,
       provider_response_id = $8,
       error_code = $9,
       updated_at = now()
     WHERE id = $1 AND owner_handle = $10 AND status = 'reserved'`,
    [
      prepared.usageId,
      providerError ? "failed" : "completed",
      actualMicros,
      result?.inputTokens ?? 0,
      result?.cachedInputTokens ?? 0,
      result?.cacheWriteTokens ?? 0,
      result?.outputTokens ?? 0,
      result?.providerResponseId ?? null,
      providerError ? failure?.code ?? "provider_error" : null,
      prepared.owner
    ]
  );
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
    quota: quota(prepared.remainingToday),
    message: { ...row, createdAt: new Date(row.createdAt).toISOString() }
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
      message: input.message
    });
  } catch (error) {
    failure = assistantProviderFailure(error);
    console.error("SYMPOSIUM AI provider request failed.", error);
  }
  return finalizeAssistant(prepared, result, failure, mutation);
};
