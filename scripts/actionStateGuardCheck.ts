import assert from "node:assert/strict";
import {
  clearActionStateProtection,
  createActionStateGuard,
  protectActionState,
  protectedActionState
} from "@/features/live-sync/actionStateGuard";

type MetricState = { metric: "signal"; value: string; mode: "floor" | "ceiling" };

const guard = createActionStateGuard<MetricState>();
const key = "post-1:signal:@actor";
const metric = { metric: "signal", value: "4", mode: "floor" } as const;

protectActionState(guard, key, true, metric);
assert.deepEqual(protectedActionState(guard, key), { desired: true, metric });

// Protection is convergence-driven: reading it cannot age it out or mutate it.
for (let index = 0; index < 10_000; index += 1) {
  assert.equal(protectedActionState(guard, key)?.desired, true);
}

protectActionState(guard, key, false, { ...metric, value: "3", mode: "ceiling" });
assert.deepEqual(protectedActionState(guard, key), {
  desired: false,
  metric: { metric: "signal", value: "3", mode: "ceiling" }
});

clearActionStateProtection(guard, key);
assert.equal(protectedActionState(guard, key), undefined);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "clock-independent protection",
        "newer optimistic intent replacement",
        "explicit canonical convergence cleanup"
      ]
    },
    null,
    2
  )
);
