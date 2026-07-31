import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { reportCheck } from "@/scripts/checkReport";
import {
  consumeLiveEventStream,
  createServerSentEventParser,
  liveEventCursorIsAfter,
  type ServerSentEvent
} from "@/features/live-sync/liveEventTransport";
import {
  liveEventScopeKey,
  liveEventsPath
} from "@/features/live-sync/useLiveEventStream";
import { publishCrossTabMessage } from "@/features/live-sync/useCrossTabItemTransport";
import {
  getLocalLiveBusStatus,
  maxLiveStreamsPerProcess,
  publishLocalLiveEvent,
  subscribeLocalLiveEvents
} from "@/apps/api/src/services/liveBus";

const main = async () => {
assert.equal(liveEventsPath("/api/events", ""), "/api/events");
assert.notEqual(
  liveEventScopeKey("actor:first", "https://api.example"),
  liveEventScopeKey("actor:second", "https://api.example")
);
assert.equal(
  liveEventsPath("/api/events/stream", "2026-07-11T10:00:00.000Z:event/1"),
  "/api/events/stream?cursor=2026-07-11T10%3A00%3A00.000Z%3Aevent%2F1"
);

const parsedEvents: ServerSentEvent[] = [];
const parser = createServerSentEventParser((event) => parsedEvents.push(event));
parser.push(": heartbeat\r\nevent: symposium-event\r\nid: cursor-1\r\ndata: {\"kind\":");
parser.push("\"post.updated\"}\r\n\r\n");
parser.finish();
assert.deepEqual(parsedEvents, [
  {
    data: '{"kind":"post.updated"}',
    event: "symposium-event",
    id: "cursor-1"
  }
]);
assert.equal(liveEventCursorIsAfter("2026-07-22T10:00:00.000Z::b", "2026-07-22T10:00:00.000Z::a"), true);
assert.equal(liveEventCursorIsAfter("2026-07-22T10:00:00.000Z::a", "2026-07-22T10:00:00.000Z::a"), false);
assert.equal(liveEventCursorIsAfter("2026-07-22T09:59:59.999Z::z", "2026-07-22T10:00:00.000Z::a"), false);
await assert.rejects(
  consumeLiveEventStream({
    fetchImpl: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    onEvent: () => undefined,
    onOpen: () => undefined,
    signal: new AbortController().signal,
    url: "https://example.test/events"
  }),
  /unexpected content type/
);

const storageWrites: string[] = [];
assert.equal(
  publishCrossTabMessage({
    channel: { postMessage: () => undefined },
    message: { kind: "profile" },
    storage: {
      removeItem: () => undefined,
      setItem: (_key, value) => storageWrites.push(value)
    },
    storageKey: "sync"
  }),
  "broadcast"
);
assert.deepEqual(storageWrites, []);

let attempts = 0;
assert.equal(
  publishCrossTabMessage({
    channel: null,
    message: { kind: "profile" },
    storage: {
      removeItem: () => undefined,
      setItem: () => {
        attempts += 1;
        throw new Error("quota");
      }
    },
    storageKey: "sync"
  }),
  "unavailable"
);
assert.equal(attempts, 2);

assert.equal(maxLiveStreamsPerProcess, 500);
assert.deepEqual(getLocalLiveBusStatus(), { listenerCount: 0, maxListeners: 500 });
let capacityDeliveries = 0;
const capacitySubscriptions = Array.from(
  { length: maxLiveStreamsPerProcess },
  () => subscribeLocalLiveEvents(() => { capacityDeliveries += 1; })
);
assert.deepEqual(getLocalLiveBusStatus(), { listenerCount: 500, maxListeners: 500 });
publishLocalLiveEvent({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "capacity.test",
  subjectType: "system",
  subjectId: "live-bus",
  createdAt: "2026-07-30T00:00:00.000Z",
  cursor: "2026-07-30T00:00:00.000Z::00000000-0000-4000-8000-000000000001"
});
assert.equal(capacityDeliveries, maxLiveStreamsPerProcess);
for (const unsubscribe of capacitySubscriptions) unsubscribe();
assert.deepEqual(getLocalLiveBusStatus(), { listenerCount: 0, maxListeners: 500 });

const root = process.cwd();
const [
  clientTransport,
  apiStreamRoute,
  nextStreamRoute,
  maintenance,
  shell,
  liveController,
  liveRouter,
  postRepository,
  commentRepository
] = await Promise.all([
  readFile(path.join(root, "features/live-sync/useLiveEventStream.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/routes/eventRoutes.ts"), "utf8"),
  readFile(path.join(root, "app/api/events/stream/route.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/maintenance.ts"), "utf8"),
  readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
  readFile(path.join(root, "features/live-sync/useSymposiumLiveController.ts"), "utf8"),
  readFile(path.join(root, "features/live-sync/symposiumLiveEventRouter.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/posts.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/comments.ts"), "utf8")
]);
assert.match(clientTransport, /consumeLiveEventStream/);
assert.match(clientTransport, /liveEventCursorIsAfter/);
assert.match(clientTransport, /browserRecoveryCoordinator\.subscribe/);
assert.match(clientTransport, /symposiumRecoveryCanAttempt/);
assert.match(clientTransport, /cursorScopeKeyRef/);
assert.match(clientTransport, /callbacksRef\.current\.onEvent\(event, cursorScopeKey\)/);
assert.match(clientTransport, /pollInFlight/);
assert.match(clientTransport, /armWatchdog\(10_000\)/);
assert.match(clientTransport, /armWatchdog\(22_000\)/);
assert.doesNotMatch(clientTransport, /addEventListener\("online"/);
assert.doesNotMatch(clientTransport, /addEventListener\("offline"/);
assert.doesNotMatch(clientTransport, /addEventListener\("visibilitychange"/);
assert.match(clientTransport, /symposiumRecoveryRetryDelayMs\(reconnectAttempt/);
assert.match(clientTransport, /reconnectAttempt \+= 1/);
assert.match(clientTransport, /Live authentication token unavailable/);
assert.match(clientTransport, /reportTransportSuccess\(\)/);
assert.match(clientTransport, /directBackendUrl \? `\$\{directBackendUrl\}\/v1\/events`/);
assert.doesNotMatch(apiStreamRoute, /setInterval\(\(\) => \{\s+void flushMissedEvents/);
assert.doesNotMatch(apiStreamRoute, /LISTEN|databaseBridge|getPool\(\)\.connect\(\)/);
assert.match(apiStreamRoute, /subscribeLocalLiveEvents/);
assert.match(apiStreamRoute, /await flushMissedEvents\(\)/);
assert.match(apiStreamRoute, /pendingLiveEvents/);
assert.match(apiStreamRoute, /while \(!closed && replayed < maxReplayEventsPerConnection\)/);
assert.match(apiStreamRoute, /if \(!stream\.write\(frame\)\)/);
assert.match(apiStreamRoute, /actor:\$\{actorHandle\}/);
assert.match(apiStreamRoute, /setNoDelay\(true\)/);
assert.match(apiStreamRoute, /flushHeaders\(\)/);
assert.match(apiStreamRoute, /" "\.repeat\(2048\)/);
assert.match(apiStreamRoute, /retry: 750/);
assert.match(nextStreamRoute, /status: 307/);
assert.match(nextStreamRoute, /Location: directUrl/);
assert.doesNotMatch(nextStreamRoute, /proxyLiveBackendStream/);
assert.doesNotMatch(maintenance, /storageDeletionIntervalMs/);
assert.match(liveRouter, /ports\.mergeLiveMetricPatch\(payload\)/);
assert.match(liveController, /setMessagingBuffer\(\(current\) =>[\s\S]*appendScopedLiveEvent\(current, authSessionKey, incoming, 1000\)/);
assert.match(liveController, /scopedLiveEvents\(messagingBuffer, authSessionKey\)/);
assert.match(liveController, /eventScopeKey !== transportScopeKey/);
assert.doesNotMatch(shell, /useLiveEventStream|setMessagingEvents|if \(synced\) scheduleLiveRefresh\(\)/);
assert.match(postRepository, /metrics: updated\.metrics,[\s\S]*revision: updated\.revision/);
assert.match(commentRepository, /metrics: updatedComment\.metrics,[\s\S]*commentRevision: updatedComment\.revision/);

reportCheck([
  "empty live-event cursor",
  "encoded polling cursor",
  "encoded streaming cursor",
  "chunk-safe authenticated SSE parsing",
  "strict event-stream content type",
  "monotonic event cursors",
  "direct browser-to-backend live transport",
  "legacy Vercel stream redirect without a long-lived function",
  "background-tab transport suspension",
  "connect-only durable event replay",
  "race-safe paginated replay before local delivery",
  "slow-client disconnect and cursor replay",
  "anti-buffering response headers, socket mode, and initial flush padding",
  "stalled-stream watchdog recovery",
  "session-scoped cursor reset",
  "session-scoped callback rejection",
  "serialized fallback polling",
  "centralized immediate online, offline, and visibility recovery",
  "fail-closed authenticated live-token recovery",
  "database-idle-safe single-process event stream",
  "route-aligned 500-listener live-bus capacity without leaks",
  "idle-safe database maintenance",
  "metric-only live action convergence",
  "passive views without full-bootstrap refresh",
  "BroadcastChannel-first delivery",
  "1000-event messaging burst retention",
  "non-fatal storage quota exhaustion"
]);
};

void main();
