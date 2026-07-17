import assert from "node:assert/strict";
import { compareEntityRevisions, incomingEntityIsStale } from "@/features/live-sync/entityRevision";
import { createItemMutationCoordinator } from "@/features/mutations/itemMutationCoordinator";
import { inquiryItemSchema, profileFollowSchema, researchProfileSchema } from "@/packages/contracts/src";

type Item = { id: string; revision?: number; value: string };

assert.equal(compareEntityRevisions({ revision: 7 }, { revision: 6 }), 1);
assert.equal(compareEntityRevisions({ revision: 6 }, { revision: 6 }), 0);
assert.equal(compareEntityRevisions({}, { revision: 6 }), null);
assert.equal(incomingEntityIsStale({ revision: 5 }, { revision: 6 }), true);
assert.equal(researchProfileSchema.pick({ revision: true }).parse({ revision: 3 }).revision, 3);
assert.equal(profileFollowSchema.parse({
  followerHandle: "@ada",
  followingHandle: "@grace",
  status: "none",
  revision: 4
}).revision, 4);
assert.throws(() => inquiryItemSchema.shape.revision.parse(0));

const first = createItemMutationCoordinator<Item>();
const second = createItemMutationCoordinator<Item>();
const initial = [{ id: "post-1", revision: 5, value: "canonical five" }];

first.begin("post-1");
const optimistic = [{ id: "post-1", revision: 5, value: "optimistic edit" }];
const [optimisticMessage] = first.publishChanges(optimistic, initial);
assert.ok(optimisticMessage);
const receivedOptimistic = second.receive(optimisticMessage, initial);
assert.equal(receivedOptimistic.accepted, true);
assert.deepEqual(receivedOptimistic.items, optimistic);

const staleDevice = createItemMutationCoordinator<Item>();
const staleMessage = staleDevice.publishChanges(
  [{ id: "post-1", revision: 4, value: "older device snapshot" }],
  [{ id: "post-1", revision: 4, value: "older device state" }],
  ["post-1"]
)[0];
assert.equal(second.receive(staleMessage, receivedOptimistic.items).accepted, false);

const beforeCanonical = second.capture();
const canonicalSix = [{ id: "post-1", revision: 6, value: "canonical six" }];
assert.deepEqual(second.reconcileRefresh(canonicalSix, receivedOptimistic.items, beforeCanonical), canonicalSix);
const pendingSnapshot = first.capture();
assert.deepEqual(first.reconcileRefresh(canonicalSix, optimistic, pendingSnapshot), canonicalSix);

const afterCanonical = second.capture();
assert.deepEqual(
  second.reconcileRefresh(
    [{ id: "post-1", revision: 5, value: "late event" }],
    canonicalSix,
    afterCanonical
  ),
  canonicalSix
);

first.complete("post-1");

const equalRevisionCurrent = { id: "post-2", revision: 3, value: "stable" };
const equalRevisionIncoming = { ...equalRevisionCurrent };
const stableRefresh = first.reconcileRefresh(
  [equalRevisionIncoming],
  [equalRevisionCurrent],
  first.capture()
);
assert.equal(stableRefresh[0], equalRevisionCurrent);

const projectionAware = createItemMutationCoordinator<Item>({
  equalRevisionProjectionChanged: (incoming, current) => incoming.value !== current.value
});
const equalRevisionProjection = projectionAware.reconcileRefresh(
  [{ id: "post-3", revision: 4, value: "new viewer projection" }],
  [{ id: "post-3", revision: 4, value: "cached viewer projection" }],
  projectionAware.capture()
);
assert.equal(equalRevisionProjection[0]?.value, "new viewer projection");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "authoritative revision comparison",
        "revision contract validation",
        "optimistic cross-tab propagation",
        "older-device message rejection",
        "newer canonical immediate convergence",
        "newer canonical pending-mutation convergence",
        "late server-event rejection",
        "equal-revision referential stability",
        "equal-revision viewer projection convergence"
      ]
    },
    null,
    2
  )
);
