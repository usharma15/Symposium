import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acquireLiveStream,
  getLiveStreamOperabilityStatus,
  maxLiveStreamsPerClient,
  recordLiveReplayEvents,
  recordLiveStreamProblem,
  releaseLiveStream,
  resetLiveStreamRegistry
} from "@/apps/api/src/services/liveStreamRegistry";
import {
  getRequestOperabilityStatus,
  recordRequestOperability,
  resetRequestOperabilityForTests
} from "@/apps/api/src/services/operability";
import {
  completeRequestCost,
  createRequestCostState,
  recordDatabaseQuery,
  runWithRequestCost
} from "@/apps/api/src/services/requestCosts";

const at = Date.parse("2026-08-01T00:00:00.000Z");

resetRequestOperabilityForTests();
const nominalState = createRequestCostState();
runWithRequestCost(nominalState, () => recordDatabaseQuery(120));
recordRequestOperability(completeRequestCost(nominalState, {
  method: "GET",
  route: "/v1/bootstrap",
  statusCode: 200,
  responseBytes: 190_000,
  completedAt: nominalState.startedAt + 420
}), at);

const nominal = getRequestOperabilityStatus(at);
assert.equal(nominal.status, "nominal");
assert.equal(nominal.observedRequests, 1);
assert.deepEqual(nominal.latencyMs, { p50: 420, p95: 420, max: 420 });
assert.equal(nominal.databaseMs?.p95, 120);
assert.equal(nominal.lastObservedAt, "2026-08-01T00:00:00.000Z");

resetRequestOperabilityForTests();
const marginalState = createRequestCostState();
runWithRequestCost(marginalState, () => recordDatabaseQuery(950));
const marginalSnapshot = completeRequestCost(marginalState, {
  method: "GET",
  route: "/v1/bootstrap",
  statusCode: 200,
  responseBytes: 190_000,
  completedAt: marginalState.startedAt + 700
});
recordRequestOperability(marginalSnapshot, at);
const marginal = getRequestOperabilityStatus(at);
assert.equal(marginal.status, "nominal");
assert.equal(marginal.budgetViolations, 1);
assert.equal(marginal.budgetViolationRequests, 1);
assert.deepEqual(marginal.degradationThresholds, {
  budgetViolationRequests: 2,
  maximumBudgetUtilization: 1.25
});
recordRequestOperability(marginalSnapshot, at + 1_000);
assert.equal(getRequestOperabilityStatus(at + 1_000).status, "degraded");

resetRequestOperabilityForTests();
const severeState = createRequestCostState();
runWithRequestCost(severeState, () => recordDatabaseQuery(1_200));
recordRequestOperability(completeRequestCost(severeState, {
  method: "GET",
  route: "/v1/bootstrap",
  statusCode: 200,
  responseBytes: 190_000,
  completedAt: severeState.startedAt + 800
}), at);
const severe = getRequestOperabilityStatus(at);
assert.equal(severe.status, "degraded");
assert.equal(severe.budgetViolationRequests, 1);
assert.ok(severe.maximumBudgetUtilization >= 1.25);

resetRequestOperabilityForTests();
const degradedState = createRequestCostState();
runWithRequestCost(degradedState, () => recordDatabaseQuery(950, true));
recordRequestOperability(completeRequestCost(degradedState, {
  method: "GET",
  route: "/v1/bootstrap",
  statusCode: 503,
  responseBytes: 1_300_000,
  completedAt: degradedState.startedAt + 3_200
}), at + 1_000);

const degraded = getRequestOperabilityStatus(at + 1_000);
assert.equal(degraded.status, "degraded");
assert.equal(degraded.serverErrors, 1);
assert.equal(degraded.queryErrors, 1);
assert.equal(degraded.budgetViolations, 3);
assert.equal(degraded.budgetViolationRequests, 1);
assert.ok(degraded.maximumBudgetUtilization > 1);
assert.equal(degraded.lastProblemAt, "2026-08-01T00:00:01.000Z");
assert.equal(getRequestOperabilityStatus(at + 16 * 60_000).status, "unobserved");

resetRequestOperabilityForTests();
for (let index = 0; index < 600; index += 1) {
  recordRequestOperability(completeRequestCost(createRequestCostState(), {
    method: "GET",
    route: "/healthz",
    statusCode: 200,
    responseBytes: 32,
    completedAt: performance.now()
  }), at + index);
}
assert.equal(getRequestOperabilityStatus(at + 600).observedRequests, 512);

resetLiveStreamRegistry();
assert.equal(getLiveStreamOperabilityStatus(at).status, "unobserved");
for (let index = 0; index < maxLiveStreamsPerClient; index += 1) {
  assert.equal(acquireLiveStream("actor:private", index > 0, at + index), true);
}
assert.equal(acquireLiveStream("actor:private", true, at + 100), false);
recordLiveReplayEvents(37);
recordLiveStreamProblem("replay_failed", at + 200);
for (let index = 0; index < maxLiveStreamsPerClient; index += 1) releaseLiveStream("actor:private");
const live = getLiveStreamOperabilityStatus(at + 200);
assert.equal(live.status, "degraded");
assert.equal(live.activeStreams, 0);
assert.equal(live.peakStreams, maxLiveStreamsPerClient);
assert.equal(live.connectionCount, maxLiveStreamsPerClient);
assert.equal(live.resumedConnectionCount, maxLiveStreamsPerClient - 1);
assert.equal(live.rejectedConnectionCount, 1);
assert.equal(live.replayedEventCount, 37);
assert.equal(live.replayFailureCount, 1);
assert.equal(JSON.stringify(live).includes("private"), false, "Operability status must not expose client identities.");
assert.equal(getLiveStreamOperabilityStatus(at + 16 * 60_000).status, "nominal");

const server = readFileSync("apps/api/src/server.ts", "utf8");
const readiness = readFileSync("apps/api/src/config/readiness.ts", "utf8");
const eventRoutes = readFileSync("apps/api/src/routes/eventRoutes.ts", "utf8");
const inquiryReads = readFileSync("apps/api/src/repository/inquiryReads.ts", "utf8");
const productionWatch = readFileSync(".github/workflows/production-watch.yml", "utf8");

assert.match(server, /recordRequestOperability\(snapshot\)/);
assert.match(
  readiness,
  /operability:\s*\{[\s\S]*?requests: requestOperability,[\s\S]*?liveStreams: liveStreamOperability/
);
assert.match(eventRoutes, /acquireLiveStream\(clientKey, Boolean\(cursor\)\)/);
assert.doesNotMatch(eventRoutes, /activeStreamsByClient|let activeStreamCount/);
assert.match(
  inquiryReads,
  /const \[requiredProfiles, communityCalls\] = await Promise\.all\(\[[\s\S]*listProfilesByHandles[\s\S]*listPublicCommunityCallMap/
);
assert.match(productionWatch, /schedule:/);
assert.match(productionWatch, /\/readyz/);
assert.match(productionWatch, /EXPECTED_RELEASE/);
assert.match(productionWatch, /operability\?\.requests\?\.status/);
assert.doesNotMatch(productionWatch, /\/v1\/bootstrap/, "The scheduled monitor must remain database-idle-safe.");

resetRequestOperabilityForTests();
resetLiveStreamRegistry();
console.log("Operability telemetry and production-watch checks passed.");
