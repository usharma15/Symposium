import { AsyncLocalStorage } from "node:async_hooks";

export type RequestCostState = {
  startedAt: number;
  queryCount: number;
  queryDurationMs: number;
  queryErrors: number;
};

export type RequestCostBudget = {
  queryCount: number;
  queryDurationMs: number;
  responseBytes: number;
  totalDurationMs: number;
};

export type RequestCostSnapshot = RequestCostState & {
  method: string;
  route: string;
  statusCode: number;
  responseBytes: number;
  totalDurationMs: number;
  budget: RequestCostBudget;
  violations: Array<keyof RequestCostBudget>;
};

const requestCostStorage = new AsyncLocalStorage<RequestCostState>();

const readBudget: RequestCostBudget = {
  queryCount: 18,
  queryDurationMs: 800,
  responseBytes: 1_250_000,
  totalDurationMs: 3_000
};

const writeBudget: RequestCostBudget = {
  queryCount: 24,
  queryDurationMs: 1_200,
  responseBytes: 1_000_000,
  totalDurationMs: 4_000
};

const routeBudgets: Record<string, RequestCostBudget> = {
  "GET /v1/bootstrap": { queryCount: 16, queryDurationMs: 900, responseBytes: 1_250_000, totalDurationMs: 3_000 },
  "GET /v1/posts": { queryCount: 10, queryDurationMs: 600, responseBytes: 1_250_000, totalDurationMs: 2_500 },
  "GET /v1/posts/:id": { queryCount: 12, queryDurationMs: 800, responseBytes: 1_250_000, totalDurationMs: 3_000 },
  "GET /v1/profiles/:handle/activity": { queryCount: 14, queryDurationMs: 900, responseBytes: 1_750_000, totalDurationMs: 3_000 },
  "GET /v1/search": { queryCount: 10, queryDurationMs: 800, responseBytes: 1_000_000, totalDurationMs: 3_000 }
};

export const createRequestCostState = (): RequestCostState => ({
  startedAt: performance.now(),
  queryCount: 0,
  queryDurationMs: 0,
  queryErrors: 0
});

export const runWithRequestCost = <T>(state: RequestCostState, callback: () => T): T =>
  requestCostStorage.run(state, callback);

export const recordDatabaseQuery = (durationMs: number, failed = false) => {
  const state = requestCostStorage.getStore();
  if (!state) return;
  state.queryCount += 1;
  state.queryDurationMs += Math.max(0, durationMs);
  if (failed) state.queryErrors += 1;
};

export const requestCostBudget = (method: string, route: string): RequestCostBudget =>
  routeBudgets[`${method.toUpperCase()} ${route}`]
    ?? (method === "GET" || method === "HEAD" ? readBudget : writeBudget);

export const completeRequestCost = (
  state: RequestCostState,
  input: {
    method: string;
    route: string;
    statusCode: number;
    responseBytes: number;
    completedAt?: number;
  }
): RequestCostSnapshot => {
  const budget = requestCostBudget(input.method, input.route);
  const totalDurationMs = Math.max(0, (input.completedAt ?? performance.now()) - state.startedAt);
  const values: RequestCostBudget = {
    queryCount: state.queryCount,
    queryDurationMs: state.queryDurationMs,
    responseBytes: input.responseBytes,
    totalDurationMs
  };
  const violations = (Object.keys(budget) as Array<keyof RequestCostBudget>)
    .filter((key) => values[key] > budget[key]);
  return {
    ...state,
    ...input,
    totalDurationMs,
    budget,
    violations
  };
};

export const responsePayloadBytes = (payload: unknown) => {
  if (typeof payload === "string") return Buffer.byteLength(payload);
  if (Buffer.isBuffer(payload)) return payload.byteLength;
  if (payload instanceof Uint8Array) return payload.byteLength;
  return 0;
};

export const shouldSampleRequestCost = (requestId: string, percent = 2) => {
  let hash = 0;
  for (const character of requestId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % 100 < Math.max(0, Math.min(100, percent));
};
