import assert from "node:assert/strict";
import { createFollowMutationCoordinator } from "@/features/live-sync/followMutationCoordinator";

const main = () => {
  const coordinator = createFollowMutationCoordinator();
  const relation = { followerHandle: "@ada", followingHandle: "@grace" };
  assert.equal(coordinator.observe({ ...relation, status: "none", revision: 3 }), true);

  const follow = coordinator.begin("@ada", "@grace", true);
  assert.deepEqual(coordinator.protectFollowing("@ada", []), ["@grace"]);
  assert.equal(coordinator.observe({ ...relation, status: "none", revision: 3 }), false);
  assert.deepEqual(coordinator.protectFollowing("@ada", []), ["@grace"]);
  assert.equal(coordinator.complete(follow, { ...relation, status: "active", revision: 4 }), true);
  assert.equal(coordinator.revisionFor("@ada", "@grace"), 4);

  const unfollow = coordinator.begin("@ada", "@grace", false);
  assert.deepEqual(coordinator.protectFollowers("@grace", ["@ada"]), []);
  assert.equal(coordinator.observe({ ...relation, status: "active", revision: 4 }), false);
  assert.equal(coordinator.complete(unfollow, { ...relation, status: "none", revision: 5 }), true);
  assert.equal(coordinator.observe({ ...relation, status: "active", revision: 4 }), false);

  const first = coordinator.begin("@ada", "@grace", true);
  const second = coordinator.begin("@ada", "@grace", false);
  assert.equal(coordinator.fail(first), false);
  assert.deepEqual(coordinator.protectFollowing("@ada", ["@grace"]), []);
  assert.equal(coordinator.fail(second), true);

  const external = coordinator.begin("@ada", "@grace", true);
  assert.equal(coordinator.observe({ ...relation, status: "none", revision: 6 }), true);
  assert.equal(coordinator.fail(external), false);
  assert.equal(coordinator.revisionFor("@ada", "@grace"), 6);

  console.log(JSON.stringify({ ok: true, checked: [
    "pending follow protection without timers",
    "pending unfollow protection without timers",
    "authoritative revision commitment",
    "stale follow rejection",
    "superseded rollback rejection",
    "newer external mutation convergence"
  ] }, null, 2));
};

main();
