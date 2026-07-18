import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync("apps/api/src/server.ts", "utf8");
const rateLimit = readFileSync("apps/api/src/services/rateLimit.ts", "utf8");
const trpc = readFileSync("apps/api/src/trpc.ts", "utf8");
const actors = readFileSync("apps/api/src/http/actors.ts", "utf8");
const events = readFileSync("apps/api/src/services/events.ts", "utf8");
const attachmentRoutes = readFileSync("apps/api/src/routes/attachmentRoutes.ts", "utf8");
const workspaceRoutes = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const auth = readFileSync("apps/api/src/services/auth.ts", "utf8");
const dbClient = readFileSync("apps/api/src/db/client.ts", "utf8");

assert.match(
  server,
  /rateLimit\(request, \{ isAuthenticated: false, source: "anonymous" \}, "request", 300, 60\)/,
  "The all-request abuse boundary must stay process-local."
);
assert.doesNotMatch(
  server,
  /rateLimit\([^\n]+\{ shared: true \}/,
  "Public reads, health checks, and stream setup must not spend Redis commands."
);
assert.match(
  rateLimit,
  /options\.shared \? getRedis\(\) : null/,
  "Redis must remain opt-in at each rate-limit call site."
);
assert.match(
  trpc,
  /export const authedProcedure = authenticatedProcedure\(false\)/,
  "Routine authenticated tRPC mutations must remain process-local."
);
assert.match(
  trpc,
  /export const sharedAuthedProcedure = authenticatedProcedure\(true\)/,
  "Provider-sensitive tRPC mutations need an explicit shared boundary."
);
assert.match(actors, /shared: options\.shared \?\? false/);
assert.match(attachmentRoutes, /shared: true, scope: "attachment"/);
assert.match(workspaceRoutes, /shared: true, scope: "assistant"/);
assert.match(workspaceRoutes, /shared: true, scope: "message-send"/);
assert.match(auth, /syncedHandleCacheTtlMs = 5 \* 60 \* 1000/);
assert.match(dbClient, /max: env\.DATABASE_POOL_MAX/);
assert.doesNotMatch(events, /getRedis|redis\.publish|symposium:events/);

console.log("Provider cost boundary checks passed.");
