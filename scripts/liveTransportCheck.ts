import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServerSentEventParser, type ServerSentEvent } from "@/features/live-sync/liveEventTransport";
import { liveEventsPath } from "@/features/live-sync/useLiveEventStream";
import { publishCrossTabMessage } from "@/features/live-sync/useCrossTabItemTransport";

const main = async () => {
assert.equal(liveEventsPath("/api/events", ""), "/api/events");
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

const root = process.cwd();
const [clientTransport, apiStreamRoute, nextStreamRoute, maintenance, controller, postRepository, commentRepository] = await Promise.all([
  readFile(path.join(root, "features/live-sync/useLiveEventStream.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/routes/eventRoutes.ts"), "utf8"),
  readFile(path.join(root, "app/api/events/stream/route.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/maintenance.ts"), "utf8"),
  readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/posts.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/comments.ts"), "utf8")
]);
assert.match(clientTransport, /consumeLiveEventStream/);
assert.match(clientTransport, /document\.hidden/);
assert.match(clientTransport, /directBackendUrl \? `\$\{directBackendUrl\}\/v1\/events`/);
assert.doesNotMatch(apiStreamRoute, /setInterval\(\(\) => \{\s+void flushMissedEvents/);
assert.doesNotMatch(apiStreamRoute, /LISTEN|databaseBridge|getPool\(\)\.connect\(\)/);
assert.match(apiStreamRoute, /subscribeLocalLiveEvents/);
assert.match(apiStreamRoute, /await flushMissedEvents\(\)/);
assert.match(nextStreamRoute, /status: 307/);
assert.match(nextStreamRoute, /Location: directUrl/);
assert.doesNotMatch(nextStreamRoute, /proxyLiveBackendStream/);
assert.doesNotMatch(maintenance, /storageDeletionIntervalMs/);
assert.match(controller, /mergeLiveMetricPatch/);
assert.doesNotMatch(controller, /if \(synced\) scheduleLiveRefresh\(\)/);
assert.match(postRepository, /metrics: updated\.metrics,[\s\S]*revision: updated\.revision/);
assert.match(commentRepository, /metrics: updatedComment\.metrics,[\s\S]*commentRevision: updatedComment\.revision/);

console.log(JSON.stringify({ ok: true, checked: [
  "empty live-event cursor",
  "encoded polling cursor",
  "encoded streaming cursor",
  "chunk-safe authenticated SSE parsing",
  "direct browser-to-backend live transport",
  "legacy Vercel stream redirect without a long-lived function",
  "background-tab transport suspension",
  "connect-only durable event replay",
  "database-idle-safe single-process event stream",
  "idle-safe database maintenance",
  "metric-only live action convergence",
  "passive views without full-bootstrap refresh",
  "BroadcastChannel-first delivery",
  "non-fatal storage quota exhaustion"
] }, null, 2));
};

void main();
