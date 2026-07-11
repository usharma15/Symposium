import assert from "node:assert/strict";
import {
  beginItemMutation,
  captureItemMutationSnapshot,
  completeItemMutation,
  createItemMutationGuard,
  itemMutationIsPending,
  reconcileItemsAgainstMutations,
  touchItemMutation
} from "@/features/live-sync/itemMutationGuard";

type Item = { id: string; body: string };

const guard = createItemMutationGuard();
const initial: Item[] = [{ id: "post-1", body: "before" }];
const beforeMutation = captureItemMutationSnapshot(guard);

beginItemMutation(guard, "post-1");
assert.equal(itemMutationIsPending(guard, "post-1"), true);

const optimistic: Item[] = [{ id: "post-1", body: "optimistic edit" }];
assert.deepEqual(
  reconcileItemsAgainstMutations([{ id: "post-1", body: "stale bootstrap" }], optimistic, guard, beforeMutation),
  optimistic
);

const duringMutation = captureItemMutationSnapshot(guard);
completeItemMutation(guard, "post-1");
assert.equal(itemMutationIsPending(guard, "post-1"), false);

const committed: Item[] = [{ id: "post-1", body: "committed edit" }];
assert.deepEqual(
  reconcileItemsAgainstMutations([{ id: "post-1", body: "late stale bootstrap" }], committed, guard, duringMutation),
  committed
);

const afterMutation = captureItemMutationSnapshot(guard);
assert.deepEqual(
  reconcileItemsAgainstMutations([{ id: "post-1", body: "fresh canonical edit" }], committed, guard, afterMutation),
  [{ id: "post-1", body: "fresh canonical edit" }]
);

const beforeCreate = captureItemMutationSnapshot(guard);
beginItemMutation(guard, "post-2");
const withOptimisticCreate = [...committed, { id: "post-2", body: "optimistic comment container" }];
assert.deepEqual(
  reconcileItemsAgainstMutations(committed, withOptimisticCreate, guard, beforeCreate),
  withOptimisticCreate
);
completeItemMutation(guard, "post-2");

const beforeCrossTabChange = captureItemMutationSnapshot(guard);
touchItemMutation(guard, "post-1");
assert.deepEqual(
  reconcileItemsAgainstMutations(
    [{ id: "post-1", body: "in-flight stale bootstrap" }],
    committed,
    guard,
    beforeCrossTabChange
  ),
  committed
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pending mutation protection",
        "late bootstrap request protection",
        "fresh canonical convergence",
        "optimistic entity preservation",
        "cross-tab epoch invalidation"
      ]
    },
    null,
    2
  )
);

export {};
