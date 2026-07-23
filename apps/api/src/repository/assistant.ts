import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assistantContextSchema,
  assistantContextUpdateInputSchema,
  assistantConversationListQuerySchema,
  assistantMessageInputSchema,
  assistantThreadSourceSchema,
  type AssistantContextContract,
  type AssistantContextUpdateResultContract,
  type AssistantQuotaStatusContract,
  type AssistantResponseContract,
  type AssistantThreadDetailContract,
  type AssistantThreadPageContract,
  type AssistantThreadSourceContract,
  type AssistantThreadStateContract
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
type ConversationRow = {
  id: string;
  title: string;
  contextType: string;
  contextId: string | null;
  contextSources: unknown;
  activeContextKey: string | null;
  contextRevision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PreparedAssistant = {
  owner: string;
  conversationId: string;
  usageId: string;
  reservedCostMicros: number;
  history: HistoryMessage[];
  context: AssistantContextContract;
  attachedContexts: AssistantContextContract[];
  thread: AssistantThreadStateContract;
  input: ParsedInput;
  dailyLimit: number;
  remainingToday: number;
};

const assistantContextKey = (context: AssistantContextContract) =>
  `${context.surface}:${context.entityId?.trim() || context.route.trim() || "/"}`.slice(0, 800);

const assistantThreadSources = (value: unknown): AssistantThreadSourceContract[] => {
  const parsed = assistantThreadSourceSchema.array().max(12).safeParse(value);
  return parsed.success ? parsed.data : [];
};

const isoString = (value: Date | string) => new Date(value).toISOString();

const assistantThreadState = (row: ConversationRow): AssistantThreadStateContract => {
  const sources = assistantThreadSources(row.contextSources);
  return {
    id: row.id,
    title: row.title,
    contextType: row.contextType,
    contextId: row.contextId,
    activeContextKey: row.activeContextKey,
    contextRevision: row.contextRevision,
    sourceCount: sources.length,
    sources,
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt)
  };
};

const sourceForContext = (
  context: AssistantContextContract,
  attachedAt = new Date().toISOString()
): AssistantThreadSourceContract => ({
  key: assistantContextKey(context),
  context,
  attachedAt
});

type AssistantCursor = { updatedAt: string; id: string };

const encodeAssistantCursor = (row: { updatedAt: Date | string; id: string }) =>
  Buffer.from(JSON.stringify({ updatedAt: isoString(row.updatedAt), id: row.id } satisfies AssistantCursor)).toString("base64url");

const parseAssistantCursor = (cursor: string): AssistantCursor => {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<AssistantCursor>;
    if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)) || typeof value.id !== "string") {
      throw new Error("Invalid cursor.");
    }
    return value as AssistantCursor;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The research-thread cursor is invalid." });
  }
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
    `WITH quota_reset AS (
       SELECT COALESCE(max(reset_at), date_trunc('day', now())) AS reset_at
       FROM ai_daily_quota_resets
       WHERE owner_handle = $1 AND usage_day = current_date
     )
     SELECT count(*)::int AS "usedToday", current_date::text AS "usageDay"
     FROM ai_usage CROSS JOIN quota_reset
     WHERE owner_handle = $1 AND created_at >= quota_reset.reset_at`,
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

export const listAssistantConversations = async (
  rawQuery: unknown,
  actor: Actor
): Promise<AssistantThreadPageContract> => {
  const query = assistantConversationListQuerySchema.parse(rawQuery);
  if (!hasDatabase()) return { threads: [], nextCursor: null };
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const cursor = query.cursor ? parseAssistantCursor(query.cursor) : null;
  const values: unknown[] = [owner];
  const clauses = ["owner_handle = $1"];
  if (cursor) {
    values.push(cursor.updatedAt, cursor.id);
    clauses.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }
  if (query.contextKey) {
    values.push(JSON.stringify([{ key: query.contextKey }]));
    clauses.push(`context_sources @> $${values.length}::jsonb`);
  }
  values.push(query.limit + 1);
  const result = await getPool().query<ConversationRow>(
    `SELECT
       id,
       title,
       context_type AS "contextType",
       context_id AS "contextId",
       context_sources AS "contextSources",
       active_context_key AS "activeContextKey",
       context_revision AS "contextRevision",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM ai_conversations
     WHERE ${clauses.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    threads: rows.map((row) => {
      const state = assistantThreadState(row);
      const { sources: _sources, ...summary } = state;
      return summary;
    }),
    nextCursor: hasMore && last ? encodeAssistantCursor(last) : null
  };
};

export const getAssistantConversation = async (
  conversationId: string,
  actor: Actor
): Promise<AssistantThreadDetailContract> => {
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const conversation = await getPool().query<ConversationRow>(
    `SELECT
       id,
       title,
       context_type AS "contextType",
       context_id AS "contextId",
       context_sources AS "contextSources",
       active_context_key AS "activeContextKey",
       context_revision AS "contextRevision",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM ai_conversations
     WHERE id = $1 AND owner_handle = $2`,
    [conversationId, owner]
  );
  const row = conversation.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
  const messages = await getPool().query<{
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    body: string;
    createdAt: Date | string;
  }>(
    `SELECT id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"
     FROM (
       SELECT id, conversation_id, role, body, created_at
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  return {
    ...assistantThreadState(row),
    messages: messages.rows.map((message) => ({ ...message, createdAt: isoString(message.createdAt) }))
  };
};

export const updateAssistantConversationContext = async (
  conversationId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantContextUpdateResultContract> => {
  const input = assistantContextUpdateInputSchema.parse(rawInput);
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Research threads require the live database." });
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantContextUpdateResultContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    const conversation = await client.query<ConversationRow>(
      `SELECT
         id,
         title,
         context_type AS "contextType",
         context_id AS "contextId",
         context_sources AS "contextSources",
         active_context_key AS "activeContextKey",
         context_revision AS "contextRevision",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM ai_conversations
       WHERE id = $1 AND owner_handle = $2
       FOR UPDATE`,
      [conversationId, owner]
    );
    const row = conversation.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
    if (row.contextRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This research thread changed elsewhere. Reload it before changing its sources."
      });
    }

    const source = sourceForContext(input.context);
    let sources = assistantThreadSources(row.contextSources).filter((entry) => entry.key !== source.key);
    sources.push(source);
    const protectedKeys = new Set([source.key, input.mode === "attach" ? row.activeContextKey : source.key].filter(Boolean));
    while (sources.length > 12) {
      const removable = sources.findIndex((entry) => !protectedKeys.has(entry.key));
      sources.splice(removable >= 0 ? removable : 0, 1);
    }
    const activeContextKey = input.mode === "use" || !row.activeContextKey ? source.key : row.activeContextKey;
    const updated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET context_sources = $3::jsonb,
           active_context_key = $4,
           context_revision = context_revision + 1,
           context_id = CASE WHEN $5 = 'use' THEN $6 ELSE context_id END,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2
       RETURNING
         id,
         title,
         context_type AS "contextType",
         context_id AS "contextId",
         context_sources AS "contextSources",
         active_context_key AS "activeContextKey",
         context_revision AS "contextRevision",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [conversationId, owner, JSON.stringify(sources), activeContextKey, input.mode, input.context.entityId ?? null]
    );
    const systemBody = input.mode === "use"
      ? `Active view changed to ${input.context.title || "the current view"}.`
      : `Added ${input.context.title || "the current view"} as a source.`;
    const messageResult = await client.query<{
      id: string;
      conversationId: string;
      role: "system";
      body: string;
      createdAt: Date | string;
    }>(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'system', $2, $3)
       RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
      [conversationId, systemBody, JSON.stringify({ event: "context_update", mode: input.mode, contextKey: source.key })]
    );
    const message = messageResult.rows[0]!;
    const response: AssistantContextUpdateResultContract = {
      thread: assistantThreadState(updated.rows[0]!),
      message: { ...message, createdAt: isoString(message.createdAt) }
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.context.update",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        mode: input.mode,
        contextKey: source.key,
        contextRevision: response.thread.contextRevision
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.context.updated",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: { mode: input.mode, contextKey: source.key, contextRevision: response.thread.contextRevision }
    });
    return { value: response, events: [event] };
  });
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
  let conversationRow: ConversationRow;
  if (!conversationId) {
    const source = sourceForContext(input.context);
    const conversation = await client.query<ConversationRow>(
      `INSERT INTO ai_conversations (
         owner_handle,
         title,
         context_type,
         context_id,
         context_sources,
         active_context_key
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING
         id,
         title,
         context_type AS "contextType",
         context_id AS "contextId",
         context_sources AS "contextSources",
         active_context_key AS "activeContextKey",
         context_revision AS "contextRevision",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        owner,
        input.message.slice(0, 80),
        input.contextType,
        input.contextId ?? input.context.entityId ?? null,
        JSON.stringify([source]),
        source.key
      ]
    );
    conversationRow = conversation.rows[0]!;
    conversationId = conversationRow.id;
  } else {
    const ownedConversation = await client.query<ConversationRow>(
      `SELECT
         id,
         title,
         context_type AS "contextType",
         context_id AS "contextId",
         context_sources AS "contextSources",
         active_context_key AS "activeContextKey",
         context_revision AS "contextRevision",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM ai_conversations
       WHERE id = $1 AND owner_handle = $2
       FOR SHARE`,
      [conversationId, owner]
    );
    if (!ownedConversation.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "AI conversation not found." });
    conversationRow = ownedConversation.rows[0]!;
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

  let sources = assistantThreadSources(conversationRow.contextSources);
  let activeSource = sources.find((source) => source.key === conversationRow.activeContextKey);
  if (!activeSource) {
    activeSource = sourceForContext(input.context);
    sources = [...sources.filter((source) => source.key !== activeSource!.key), activeSource].slice(-12);
    const hydrated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET context_sources = $3::jsonb,
           active_context_key = $4,
           context_revision = context_revision + 1
       WHERE id = $1 AND owner_handle = $2
       RETURNING
         id,
         title,
         context_type AS "contextType",
         context_id AS "contextId",
         context_sources AS "contextSources",
         active_context_key AS "activeContextKey",
         context_revision AS "contextRevision",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [conversationId, owner, JSON.stringify(sources), activeSource.key]
    );
    conversationRow = hydrated.rows[0]!;
  }
  const context = assistantContextSchema.parse(activeSource.context);
  const attachedContexts = sources
    .filter((source) => source.key !== activeSource!.key)
    .slice(-4)
    .map((source) => source.context);
  const renderedInput = assistantRenderedInput({
    history,
    context,
    attachedContexts,
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
    [conversationId, input.message, JSON.stringify({
      context,
      contextKey: activeSource.key,
      attachedContextKeys: sources.filter((source) => source.key !== activeSource!.key).map((source) => source.key),
      contextType: conversationRow.contextType,
      contextId: conversationRow.contextId
    })]
  );
  return {
    value: {
      owner,
      conversationId,
      usageId: reservation.usageId,
      reservedCostMicros: reservation.reservedCostMicros,
      history,
      context,
      attachedContexts,
      thread: assistantThreadState({ ...conversationRow, contextSources: sources }),
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
          surface: prepared.context.surface,
          route: prepared.context.route.startsWith("/") ? prepared.context.route : "/",
          title: prepared.context.title.trim() || "Current view",
          ...(prepared.context.entityType ? { entityType: prepared.context.entityType } : {}),
          ...(prepared.context.entityId ? { entityId: prepared.context.entityId } : {})
        }
      }
    : undefined;
  const quickNote = result?.quickNote
      ? {
        ...result.quickNote,
        source: {
          surface: prepared.context.surface,
          route: prepared.context.route.startsWith("/") ? prepared.context.route : "/",
          title: prepared.context.title.trim() || "Current view",
          ...(prepared.context.entityType ? { entityType: prepared.context.entityType } : {}),
          ...(prepared.context.entityId ? { entityId: prepared.context.entityId } : {})
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
  const updatedConversation = await client.query<ConversationRow>(
    `UPDATE ai_conversations
     SET updated_at = now()
     WHERE id = $1 AND owner_handle = $2
     RETURNING
       id,
       title,
       context_type AS "contextType",
       context_id AS "contextId",
       context_sources AS "contextSources",
       active_context_key AS "activeContextKey",
       context_revision AS "contextRevision",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [prepared.conversationId, prepared.owner]
  );
  const row = assistantMessage.rows[0]!;
  const response: AssistantResponseContract = {
    conversationId: prepared.conversationId,
    providerConfigured: true,
    status: providerError ? "provider_error" : "answered",
    model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(prepared.dailyLimit, prepared.remainingToday),
    thread: assistantThreadState(updatedConversation.rows[0] ?? {
      ...prepared.thread,
      contextSources: prepared.thread.sources,
      createdAt: prepared.thread.createdAt,
      updatedAt: new Date().toISOString()
    }),
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
      surface: prepared.context.surface,
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
      context: prepared.context,
      attachedContexts: prepared.attachedContexts,
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
