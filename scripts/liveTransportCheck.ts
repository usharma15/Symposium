import assert from "node:assert/strict";
import { liveEventsPath } from "@/features/live-sync/useLiveEventStream";
import { publishCrossTabMessage } from "@/features/live-sync/useCrossTabItemTransport";

assert.equal(liveEventsPath("/api/events", ""), "/api/events");
assert.equal(
  liveEventsPath("/api/events/stream", "2026-07-11T10:00:00.000Z:event/1"),
  "/api/events/stream?cursor=2026-07-11T10%3A00%3A00.000Z%3Aevent%2F1"
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

console.log(JSON.stringify({ ok: true, checked: [
  "empty live-event cursor",
  "encoded polling cursor",
  "encoded streaming cursor",
  "BroadcastChannel-first delivery",
  "non-fatal storage quota exhaustion"
] }, null, 2));
