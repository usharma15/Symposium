import type { RequestCostSnapshot } from "./requestCosts";

const requestWindowMs = 15 * 60 * 1000;
const maximumRequestSamples = 512;

type RequestOperabilitySample = {
  recordedAt: number;
  statusCode: number;
  queryErrors: number;
  queryDurationMs: number;
  totalDurationMs: number;
  responseBytes: number;
  budgetViolationCount: number;
  maximumBudgetUtilization: number;
};

export type RequestOperabilityStatus = {
  status: "unobserved" | "nominal" | "degraded";
  windowMinutes: number;
  retainedSampleCapacity: number;
  observedRequests: number;
  serverErrors: number;
  queryErrors: number;
  budgetViolations: number;
  latencyMs: { p50: number; p95: number; max: number } | null;
  databaseMs: { p50: number; p95: number; max: number } | null;
  responseBytes: { p50: number; p95: number; max: number } | null;
  maximumBudgetUtilization: number;
  lastObservedAt: string | null;
  lastProblemAt: string | null;
};

let requestSamples: RequestOperabilitySample[] = [];

const rounded = (value: number) => Number(value.toFixed(2));

const distribution = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const at = (percentile: number) =>
    ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * percentile) - 1))] ?? 0;
  return {
    p50: rounded(at(0.5)),
    p95: rounded(at(0.95)),
    max: rounded(ordered.at(-1) ?? 0)
  };
};

const budgetUtilization = (snapshot: RequestCostSnapshot) => Math.max(
  snapshot.budget.queryCount > 0 ? snapshot.queryCount / snapshot.budget.queryCount : 0,
  snapshot.budget.queryDurationMs > 0 ? snapshot.queryDurationMs / snapshot.budget.queryDurationMs : 0,
  snapshot.budget.responseBytes > 0 ? snapshot.responseBytes / snapshot.budget.responseBytes : 0,
  snapshot.budget.totalDurationMs > 0 ? snapshot.totalDurationMs / snapshot.budget.totalDurationMs : 0
);

export const recordRequestOperability = (
  snapshot: RequestCostSnapshot,
  recordedAt = Date.now()
) => {
  requestSamples.push({
    recordedAt,
    statusCode: snapshot.statusCode,
    queryErrors: snapshot.queryErrors,
    queryDurationMs: snapshot.queryDurationMs,
    totalDurationMs: snapshot.totalDurationMs,
    responseBytes: snapshot.responseBytes,
    budgetViolationCount: snapshot.violations.length,
    maximumBudgetUtilization: budgetUtilization(snapshot)
  });
  if (requestSamples.length > maximumRequestSamples) {
    requestSamples = requestSamples.slice(-maximumRequestSamples);
  }
};

export const getRequestOperabilityStatus = (now = Date.now()): RequestOperabilityStatus => {
  const cutoff = now - requestWindowMs;
  const recent = requestSamples.filter((sample) => sample.recordedAt >= cutoff && sample.recordedAt <= now);
  const serverErrors = recent.filter((sample) => sample.statusCode >= 500).length;
  const queryErrors = recent.reduce((total, sample) => total + sample.queryErrors, 0);
  const budgetViolations = recent.reduce((total, sample) => total + sample.budgetViolationCount, 0);
  const problems = recent.filter((sample) =>
    sample.statusCode >= 500 || sample.queryErrors > 0 || sample.budgetViolationCount > 0
  );
  const lastObservedAt = recent.at(-1)?.recordedAt ?? null;
  const lastProblemAt = problems.at(-1)?.recordedAt ?? null;
  return {
    status: !recent.length
      ? "unobserved"
      : serverErrors || queryErrors || budgetViolations ? "degraded" : "nominal",
    windowMinutes: requestWindowMs / 60_000,
    retainedSampleCapacity: maximumRequestSamples,
    observedRequests: recent.length,
    serverErrors,
    queryErrors,
    budgetViolations,
    latencyMs: distribution(recent.map((sample) => sample.totalDurationMs)),
    databaseMs: distribution(recent.map((sample) => sample.queryDurationMs)),
    responseBytes: distribution(recent.map((sample) => sample.responseBytes)),
    maximumBudgetUtilization: rounded(Math.max(0, ...recent.map((sample) => sample.maximumBudgetUtilization))),
    lastObservedAt: lastObservedAt === null ? null : new Date(lastObservedAt).toISOString(),
    lastProblemAt: lastProblemAt === null ? null : new Date(lastProblemAt).toISOString()
  };
};

export const resetRequestOperabilityForTests = () => {
  requestSamples = [];
};
