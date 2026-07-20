import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actualCostMicros, conservativeInputTokenCeiling, reserveCostMicros, usdToMicros } from "@/apps/api/src/services/aiBudget";
import { assistantInstructions, assistantPrompt, assistantProviderFailure } from "@/apps/api/src/services/openaiResponses";
import { assistantMessageInputSchema, assistantResponseSchema } from "@/packages/contracts/src";

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
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, message: "x".repeat(2001) }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, content: "x".repeat(12001) } }).success, false);
assert.equal(assistantMessageInputSchema.safeParse({ ...validInput, context: { ...validInput.context, surface: "unknown" } }).success, false);
assert.match(assistantPrompt(validInput.context, validInput.message), /CURRENT VIEW/);
assert.match(assistantInstructions, /never as instructions/i);
assert.equal(conservativeInputTokenCeiling("abc"), 3);
assert.equal(reserveCostMicros("gpt-5.6-terra", "a", 700), 10_504);
assert.equal(actualCostMicros("gpt-5.6-terra", 1000, 100), 4_625);
assert.equal(usdToMicros(40), 40_000_000);
assert.match(assistantProviderFailure(new DOMException("timed out", "TimeoutError")).body, /45-second safety timeout/);

assert.equal(assistantResponseSchema.safeParse({
  conversationId: "conversation",
  providerConfigured: true,
  status: "answered",
  model: "gpt-5.6-terra",
  quota: { dailyLimit: 3, remainingToday: 2, monthlyBudgetUsd: 40, extremelyLimited: true },
  message: { id: "message", conversationId: "conversation", role: "assistant", body: "Answer" }
}).success, true);

const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const route = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const tablet = readFileSync("features/workspace/WorkspacePanels.tsx", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const env = readFileSync("apps/api/src/config/env.ts", "utf8");

assert.match(provider, /store: false/);
assert.match(provider, /service_tier: "default"/);
assert.match(provider, /max_output_tokens: env\.SYMPOSIUM_AI_MAX_OUTPUT_TOKENS/);
assert.match(provider, /prompt_cache_key: "symposium-contextual-tablet-v1"/);
assert.match(provider, /insufficient_quota/);
assert.match(repository, /providerErrorCode/);
assert.match(repository, /pg_advisory_xact_lock\(hashtextextended\('symposium:ai-budget'/);
assert.match(repository, /current\.userMinute >= 2/);
assert.match(repository, /current\.inFlight >= 1/);
assert.match(repository, /getAssistantQuota/);
assert.match(repository, /SYMPOSIUM_AI_USER_DAILY_LIMIT/);
assert.match(repository, /SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT/);
assert.match(repository, /SYMPOSIUM_AI_DAILY_BUDGET_USD/);
assert.match(repository, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD/);
assert.match(migration, /0037_ai_usage_budget_ledger/);
assert.match(migration, /reserved_cost_micros BIGINT NOT NULL/);
assert.match(route, /shared: true, scope: "assistant", limit: 10/);
assert.match(tablet, /Extremely limited beta/);
assert.match(tablet, /Only Send shares this view with the model and uses an answer/);
assert.match(tablet, /Loading today’s tiny AI allowance/);
assert.match(tablet, /Send · uses 1/);
assert.match(shell, /surface: "messages"/);
assert.match(shell, /surface: "workspace"/);
assert.match(shell, /surface: "attachment"/);
assert.match(shell, /Visible discussion/);
assert.match(shell, /Visible post results/);
assert.match(shell, /Visible feed items/);
assert.match(env, /SYMPOSIUM_AI_MONTHLY_BUDGET_USD:[\s\S]*max\(40\)\.default\(40\)/);

console.log("AI Tablet cost and context boundary checks passed.");
