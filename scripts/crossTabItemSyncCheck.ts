import assert from "node:assert/strict";
import { createCrossTabItemSync } from "@/features/live-sync/crossTabItemSync";

type Item = { id: string; value: string };
let time = 1_000;
const now = () => time;
const first = createCrossTabItemSync<Item>({ now, protectionWindowMs: 100, sourceId: "tab-a" });
const second = createCrossTabItemSync<Item>({ now, protectionWindowMs: 100, sourceId: "tab-b" });

const optimistic = first.publish({ id: "post-1", value: "optimistic action" });
assert.equal(second.accept(optimistic), true);
assert.deepEqual(
  second.protectIncomingItems(
    [{ id: "post-1", value: "stale bootstrap" }],
    [{ id: "post-1", value: "optimistic action" }]
  ),
  [{ id: "post-1", value: "optimistic action" }]
);

const committed = first.publish({ id: "post-1", value: "committed action" });
assert.equal(second.accept(committed), true);
assert.equal(second.accept(optimistic), false);
const immediateSecondTabAction = second.publish({ id: "post-1", value: "immediate second-tab action" });
assert.equal(first.accept(immediateSecondTabAction), true);
assert.deepEqual(
  second.protectIncomingItem(
    { id: "post-1", value: "stale live event" },
    { id: "post-1", value: "immediate second-tab action" }
  ),
  { id: "post-1", value: "immediate second-tab action" }
);

const created = first.publish({ id: "post-2", value: "new post or comment container" });
assert.equal(second.accept(created), true);
assert.deepEqual(
  second.protectIncomingItems([], []).find((item) => item.id === created.item.id),
  created.item
);

time += 101;
assert.deepEqual(
  second.protectIncomingItem(
    { id: "post-1", value: "newer canonical" },
    { id: "post-1", value: "committed action" }
  ),
  { id: "post-1", value: "newer canonical" }
);

const edit = first.publish({ id: "post-3", value: "edit" });
const deletion = first.publish({ id: "post-3", value: "deleted tombstone" });
assert.equal(second.accept(edit), true);
assert.equal(second.accept(deletion), true);
assert.equal(second.accept(edit), false);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "immediate cross-tab optimistic state",
        "monotonic commit and rollback ordering",
        "stale bootstrap and live-event rejection",
        "creation preservation",
        "edit and delete ordering",
        "canonical convergence after protection window"
      ]
    },
    null,
    2
  )
);
