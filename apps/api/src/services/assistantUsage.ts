import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { env } from "../config/env";
import { reserveCostMicros, usdToMicros } from "./aiBudget";
import { assistantDailyLimitFor } from "./assistantQuota";

export type AssistantUsageReservation = {
  usageId: string;
  reservedCostMicros: number;
  dailyLimit: number;
  remainingToday: number;
};

export const assistantQuota = (dailyLimit: number, remainingToday: number) => ({
  dailyLimit,
  remainingToday: Math.max(0, remainingToday),
  monthlyBudgetUsd: env.SYMPOSIUM_AI_MONTHLY_BUDGET_USD,
  extremelyLimited: true as const
});

export const reserveAssistantUsage = async (
  client: PoolClient,
  input: {
    owner: string;
    conversationId: string;
    renderedInput: string;
    maxOutputTokens: number;
  }
): Promise<AssistantUsageReservation> => {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:ai-budget', 0))");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:ai-user:' || $1, 0))", [input.owner]);
  const usage = await client.query<{
    userMinute: number;
    userDaily: number;
    globalDaily: number;
    inFlight: number;
    dailyCostMicros: string;
    monthlyCostMicros: string;
    usageDay: string;
  }>(
    `WITH quota_reset AS (
       SELECT COALESCE(max(reset_at), date_trunc('day', now())) AS reset_at
       FROM ai_daily_quota_resets
       WHERE owner_handle = $1 AND usage_day = current_date
     )
     SELECT
       count(*) FILTER (WHERE owner_handle = $1 AND created_at >= now() - interval '60 seconds')::int AS "userMinute",
       count(*) FILTER (WHERE owner_handle = $1 AND created_at >= quota_reset.reset_at)::int AS "userDaily",
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS "globalDaily",
       count(*) FILTER (WHERE owner_handle = $1 AND status = 'reserved' AND created_at >= now() - interval '2 minutes')::int AS "inFlight",
       COALESCE(sum(CASE WHEN status = 'completed' THEN actual_cost_micros ELSE reserved_cost_micros END)
         FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailyCostMicros",
       COALESCE(sum(CASE WHEN status = 'completed' THEN actual_cost_micros ELSE reserved_cost_micros END)
         FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS "monthlyCostMicros",
       current_date::text AS "usageDay"
     FROM ai_usage CROSS JOIN quota_reset`,
    [input.owner]
  );
  const current = usage.rows[0]!;
  const dailyLimit = assistantDailyLimitFor(input.owner, current.usageDay, {
    baseLimit: env.SYMPOSIUM_AI_USER_DAILY_LIMIT
  });
  if (current.inFlight >= 1) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Only one AI request can run at a time for this account." });
  }
  if (current.userMinute >= 2) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI requests are limited to two attempts per minute." });
  }
  if (current.userDaily >= dailyLimit) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Daily AI limit reached. Every account has a hard limit of ${dailyLimit} answers per usage day.` });
  }
  if (current.globalDaily >= env.SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The shared AI capacity for today is exhausted. It resets tomorrow." });
  }

  const reservedCostMicros = reserveCostMicros(
    env.SYMPOSIUM_AI_MODEL,
    input.renderedInput,
    input.maxOutputTokens
  );
  if (Number(current.dailyCostMicros) + reservedCostMicros > usdToMicros(env.SYMPOSIUM_AI_DAILY_BUDGET_USD)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The shared AI spending limit for today is exhausted. It resets tomorrow." });
  }
  if (Number(current.monthlyCostMicros) + reservedCostMicros > usdToMicros(env.SYMPOSIUM_AI_MONTHLY_BUDGET_USD)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The AI monthly spending cap has been reached. AI is paused until the next month." });
  }

  const reserved = await client.query<{ id: string }>(
    `INSERT INTO ai_usage (conversation_id, owner_handle, model, reserved_cost_micros)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.conversationId, input.owner, env.SYMPOSIUM_AI_MODEL, reservedCostMicros]
  );
  return {
    usageId: reserved.rows[0]!.id,
    reservedCostMicros,
    dailyLimit,
    remainingToday: dailyLimit - current.userDaily - 1
  };
};

export const completeAssistantUsage = async (
  client: PoolClient,
  input: {
    usageId: string;
    owner: string;
    providerError: boolean;
    actualCostMicros: number;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    providerResponseId?: string;
    errorCode?: string;
  }
) => {
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
      input.usageId,
      input.providerError ? "failed" : "completed",
      input.actualCostMicros,
      input.inputTokens,
      input.cachedInputTokens,
      input.cacheWriteTokens,
      input.outputTokens,
      input.providerResponseId ?? null,
      input.providerError ? input.errorCode ?? "provider_error" : null,
      input.owner
    ]
  );
};
