import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPostInputSchema,
  inquiryItemSchema,
  postDesignAssignmentSchema
} from "@/packages/contracts/src";
import {
  BOTTOM_CARICATURE_IDS,
  PAPER_MUSE_IDS,
  THOUGHT_MUSE_IDS,
  deterministicPostDesignAssignment,
  postDesignAssignmentIsEligible,
  randomPostDesignAssignment,
  resolvePostDesignAssignment
} from "@/lib/postDesign";

const basePost = {
  kind: "thought" as const,
  postType: "thought" as const,
  room: "symposium" as const,
  body: "A titleless thought.",
  attachmentIds: []
};

const main = async () => {
  assert.deepEqual(PAPER_MUSE_IDS, ["calliope", "urania"]);
  assert.deepEqual(THOUGHT_MUSE_IDS, ["erato", "thalia"]);
  assert.deepEqual(BOTTOM_CARICATURE_IDS, [
    "resting-warrior",
    "flute-girl",
    "discus-thrower",
    "harp-girl",
    "wanderer",
    "lovers",
    "chariot"
  ]);

  assert.equal(createPostInputSchema.safeParse({ ...basePost, title: "" }).success, true);
  assert.equal(createPostInputSchema.safeParse({ ...basePost, title: "Hidden title" }).success, false);
  assert.equal(
    createPostInputSchema.safeParse({ ...basePost, kind: "paper", postType: "paper", room: "library", title: "" }).success,
    false
  );
  assert.equal(
    createPostInputSchema.safeParse({ ...basePost, kind: "paper", postType: "paper", room: "library", title: "Required paper title" }).success,
    true
  );

  const paper = deterministicPostDesignAssignment("paper", "stable-id");
  const repeatPaper = deterministicPostDesignAssignment("paper", "stable-id");
  const thought = deterministicPostDesignAssignment("thought", "stable-id");
  assert.deepEqual(paper, repeatPaper, "Compatibility backfill must be stable.");
  assert.deepEqual(paper, {
    schemaVersion: 1,
    museId: "urania",
    bottomCaricatureId: "resting-warrior"
  }, "Compatibility assignment must stay byte-exact with the PostgreSQL FNV-1a backfill.");
  assert.equal(postDesignAssignmentIsEligible("paper", paper), true);
  assert.equal(postDesignAssignmentIsEligible("thought", thought), true);
  assert.equal(postDesignAssignmentIsEligible("paper", thought), false);
  assert.equal(postDesignAssignmentIsEligible("thought", paper), false);

  assert.deepEqual(randomPostDesignAssignment("paper", () => 0), {
    schemaVersion: 1,
    museId: "calliope",
    bottomCaricatureId: "resting-warrior"
  });
  assert.deepEqual(randomPostDesignAssignment("thought", (maximum) => maximum - 1), {
    schemaVersion: 1,
    museId: "thalia",
    bottomCaricatureId: "chariot"
  });
  assert.throws(() => randomPostDesignAssignment("paper", (maximum) => maximum));
  assert.deepEqual(
    resolvePostDesignAssignment({ postType: "paper", assignment: paper, identity: "stable-id" }),
    paper
  );
  assert.throws(() =>
    resolvePostDesignAssignment({
      postType: "paper",
      assignment: { schemaVersion: 1, museId: "thalia", bottomCaricatureId: "chariot" },
      identity: "invalid"
    })
  );
  assert.equal(resolvePostDesignAssignment({ postType: "proposal", assignment: undefined, identity: "none" }), undefined);
  assert.throws(() =>
    resolvePostDesignAssignment({ postType: "proposal", assignment: paper, identity: "forbidden" })
  );

  const invalidProposal = inquiryItemSchema.safeParse({
    id: "proposal-1",
    revision: 1,
    kind: "paper",
    postType: "proposal",
    room: "hall",
    communityId: null,
    title: "Proposal",
    author: "Ada",
    date: "Now",
    status: "open",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: "",
    excerpt: "Proposal",
    body: "Proposal",
    tags: [],
    signals: [],
    claims: [],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    saved: false,
    comments: [],
    designAssignment: paper
  });
  assert.equal(invalidProposal.success, false, "Non-artifact post types must reject assignments.");
  assert.equal(postDesignAssignmentSchema.safeParse({ ...paper, theme: "night" }).success, false);

  const root = process.cwd();
  const migration = await readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8");
  const posts = await readFile(path.join(root, "apps/api/src/repository/posts.ts"), "utf8");
  const foundation = await readFile(path.join(root, "apps/api/src/repository/foundation.ts"), "utf8");
  const projection = await readFile(path.join(root, "apps/api/src/repository/inquiryProjection.ts"), "utf8");
  const localStore = await readFile(path.join(root, "lib/dataStore.ts"), "utf8");
  assert.match(migration, /0064_authored_artifact_design_assignments/);
  assert.match(migration, /design_assignment JSONB/);
  assert.match(migration, /symposium_posts_design_fnv1a_32\(id \|\| ':muse:v1'\) % 2/);
  assert.match(migration, /symposium_posts_design_fnv1a_32\(id \|\| ':bottom:v1'\) % 7/);
  assert.match(migration, /DROP FUNCTION symposium_posts_design_fnv1a_32\(TEXT\)/);
  assert.match(migration, /posts_design_assignment_check/);
  assert.match(migration, /post_type = 'paper'\s+AND design_assignment IS NOT NULL/);
  assert.match(migration, /post_type = 'thought'\s+AND design_assignment IS NOT NULL/);
  assert.match(posts, /randomPostDesignAssignment/);
  assert.match(posts, /design_assignment/);
  assert.match(foundation, /postSelectColumns/);
  assert.match(projection, /design_assignment AS "designAssignment"/);
  assert.match(localStore, /designAssignment:/);
  assert.doesNotMatch(localStore, /design_assignment|symposium_items_design_fnv1a_32/);
  assert.doesNotMatch(localStore, /deterministicPostDesignAssignment/);
  assert.match(localStore, /randomPostDesignAssignment/);
  assert.match(localStore, /resolvePostDesignAssignment/);
  assert.doesNotMatch([migration, posts, foundation, projection, localStore].join("\n"), /design_assignment[^\\n]*(day|night)|theme[^\\n]*design_assignment/i);

  console.log("Post design assignment contracts and persistence boundaries verified.");
};

void main();
