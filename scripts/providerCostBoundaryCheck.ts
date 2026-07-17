import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync("apps/api/src/server.ts", "utf8");
const rateLimit = readFileSync("apps/api/src/services/rateLimit.ts", "utf8");
const trpc = readFileSync("apps/api/src/trpc.ts", "utf8");
const actors = readFileSync("apps/api/src/http/actors.ts", "utf8");
const events = readFileSync("apps/api/src/services/events.ts", "utf8");

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
  /type === "mutation"[\s\S]*\{ shared: true \}/,
  "Only authenticated tRPC mutations should use the shared limiter."
);
assert.match(
  actors,
  /"write", 120, 60, \{ shared: true \}/,
  "Authenticated REST mutations should retain the shared limiter."
);
assert.doesNotMatch(events, /getRedis|redis\.publish|symposium:events/);

console.log("Provider cost boundary checks passed.");
