import assert from "node:assert/strict";
import { createInquiryActionReconciler } from "@/features/live-sync/inquiryActionReconciler";
import { inquiryItems } from "@/lib/mockData";
import { mutateItemForActor } from "@/lib/symposiumCore";

const actor = "@reconciliation-check";
const canonical = inquiryItems[0];
assert.ok(canonical);

const optimistic = mutateItemForActor(canonical, "signal", actor);
const reconciler = createInquiryActionReconciler();
const key = `${canonical.id}:signal:${actor}`;
const metricState = reconciler.actionMetricStateFromValues(canonical.metrics, optimistic.metrics, "signal");
reconciler.setProtectedDesiredActionState(key, true, metricState);

assert.equal(reconciler.itemActionActive(optimistic, "signal", actor), true);
assert.equal(
  reconciler.protectItemFromStaleActionState(canonical, optimistic, actor),
  optimistic,
  "stale canonical membership must not replace optimistic membership"
);

assert.deepEqual(
  reconciler.protectItemsFromStaleActionState([canonical], [optimistic], actor),
  [optimistic],
  "collection reconciliation must use the same item-level policy"
);

reconciler.settleFreshItemActionState(optimistic, actor);
assert.equal(
  reconciler.protectItemFromStaleActionState(canonical, optimistic, actor),
  canonical,
  "a fresh confirming snapshot must retire protection and allow later canonical state"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "optimistic membership protection",
        "metric direction protection",
        "collection reconciliation",
        "fresh snapshot convergence"
      ]
    },
    null,
    2
  )
);
