import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  completeRequestCost,
  createRequestCostState,
  recordDatabaseQuery,
  requestCostBudget,
  responsePayloadBytes,
  runWithRequestCost
} from "@/apps/api/src/services/requestCosts";

const server = readFileSync("apps/api/src/server.ts", "utf8");
const rateLimit = readFileSync("apps/api/src/services/rateLimit.ts", "utf8");
const actors = readFileSync("apps/api/src/http/actors.ts", "utf8");
const events = readFileSync("apps/api/src/services/events.ts", "utf8");
const attachmentRoutes = readFileSync("apps/api/src/routes/attachmentRoutes.ts", "utf8");
const workspaceRoutes = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
const auth = readFileSync("apps/api/src/services/auth.ts", "utf8");
const dbClient = readFileSync("apps/api/src/db/client.ts", "utf8");
const apiClient = readFileSync("features/api/symposiumApiClient.ts", "utf8");
const inquiryViews = readFileSync("apps/api/src/repository/inquiryViews.ts", "utf8");
const maintenance = readFileSync("apps/api/src/services/maintenance.ts", "utf8");
const renderAssets = readFileSync("features/rooms/roomRenderAssets.ts", "utf8");
const shellViews = readFileSync("features/shell/SymposiumShellViews.tsx", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const profileRepository = readFileSync("apps/api/src/repository/profiles.ts", "utf8");
const profileActions = readFileSync("apps/api/src/repository/actions.ts", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const renderDirectory = "public/symposium-renders";
const renderFiles = readdirSync(renderDirectory);
const avifRenderFiles = renderFiles.filter((file) => file.endsWith(".avif"));
const avifRenderBytes = avifRenderFiles.reduce(
  (total, file) => total + statSync(join(renderDirectory, file)).size,
  0
);

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
assert.match(actors, /shared: options\.shared \?\? false/);
assert.match(attachmentRoutes, /shared: true, scope: "attachment"/);
assert.match(workspaceRoutes, /shared: true, scope: "assistant"/);
assert.match(workspaceRoutes, /shared: true, scope: "message-send"/);
assert.match(auth, /syncedHandleCacheTtlMs = 5 \* 60 \* 1000/);
assert.match(dbClient, /max: env\.DATABASE_POOL_MAX/);
assert.match(dbClient, /pool\.on\("connect", instrumentPoolClient\)/);
assert.match(server, /runWithRequestCost\(cost, done\)/);
assert.match(server, /request_cost_budget_exceeded/);
assert.doesNotMatch(events, /getRedis|redis\.publish|symposium:events/);
assert.doesNotMatch(server, /fastifyTRPCPlugin|attachRealtime|\/trpc\//);
assert.match(server, /methods: \["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"\]/);
assert.doesNotMatch(packageJson, /"socket\.io"/);
assert.match(apiClient, /source\.pathname\.replace/);
assert.match(apiClient, /Authorization", `Bearer \$\{token\}`/);
assert.match(apiClient, /mutationCanReplay/);
assert.match(inquiryViews, /recordContentView/);
assert.doesNotMatch(inquiryViews, /claimMutation|completeMutation|post_actions/);
assert.match(maintenance, /maintenance_leases/);
assert.match(maintenance, /created_at < now\(\) - interval '90 days'/);
assert.match(maintenance, /created_at < now\(\) - interval '365 days'/);
assert.match(renderAssets, /-v1\.avif/);
assert.doesNotMatch(renderAssets, /roomRenders\.night|preloadRemainingRenders/);
assert.doesNotMatch(shellViews, /RenderPreloadDeck|loading="eager"/);
assert.match(nextConfig, /max-age=31536000, immutable/);
assert.equal(renderFiles.some((file) => file.endsWith(".png")), false);
assert.equal(avifRenderFiles.length, 20);
assert.ok(avifRenderBytes < 4 * 1024 * 1024, "Versioned room renders must stay below a 4 MB deployment budget.");
assert.match(profileActions, /query\.includeSummary[\s\S]*profileActivityCountSummary/);
assert.match(profileRepository, /listProfileActivitySubjects/);
assert.match(shell, /const requestSummary = !append && \(forceSummary \|\| !existingSnapshot\.totals\)/);
assert.match(shell, /includeSummary: String\(requestSummary\)/);
assert.match(shell, /data\.items\?\.length \|\| data\.profiles/);

const measuredCost = createRequestCostState();
runWithRequestCost(measuredCost, () => {
  recordDatabaseQuery(12);
  recordDatabaseQuery(8, true);
});
const measuredSnapshot = completeRequestCost(measuredCost, {
  method: "GET",
  route: "/v1/profiles/:handle/activity",
  statusCode: 200,
  responseBytes: 640,
  completedAt: measuredCost.startedAt + 40
});
assert.equal(measuredSnapshot.queryCount, 2);
assert.equal(measuredSnapshot.queryErrors, 1);
assert.equal(measuredSnapshot.queryDurationMs, 20);
assert.deepEqual(measuredSnapshot.violations, []);
assert.equal(requestCostBudget("GET", "/v1/profiles/:handle/activity").queryCount, 14);
assert.equal(responsePayloadBytes("measured"), 8);

console.log("Provider cost boundary checks passed.");
