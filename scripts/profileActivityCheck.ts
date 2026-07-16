import assert from "node:assert/strict";
import { PROFILE_ACTIVITY_SQL } from "@/apps/api/src/repository/actions";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import {
  itemMatchesProfilePostAction,
  reconcileProfileActivitySlots,
  selectProfileActivitySlots,
  uniqueProfileActivityEntries
} from "@/lib/profileActivity";

const person: ResearchProfile = {
  name: "Ada Lovelace",
  handle: "@ada",
  role: "Researcher",
  location: "London",
  bio: "Profile activity verification.",
  fields: ["Computing"]
};

const item: InquiryItem = {
  id: "self-authored",
  kind: "thought",
  room: "symposium",
  title: "Self-authored work",
  author: person.name,
  authorHandle: person.handle,
  affiliation: "Independent",
  date: "Now",
  status: "Open",
  metrics: { signal: "1", critiques: "0", forks: "1", saves: "1", reads: "1" },
  gatheringReason: "Verification",
  excerpt: "Verification",
  body: "Verification",
  tags: [],
  signals: [],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  comments: [],
  saved: true,
  savedBy: [person.handle],
  signaledBy: [person.handle],
  forkedBy: [person.handle]
};

assert.equal(itemMatchesProfilePostAction(item, person, "save", person.handle), true);
assert.equal(itemMatchesProfilePostAction(item, person, "signal"), true);
assert.equal(itemMatchesProfilePostAction(item, person, "fork"), true);
assert.equal(itemMatchesProfilePostAction({ ...item, deletedAt: new Date().toISOString() }, person, "save"), false);

const unique = uniqueProfileActivityEntries(
  [
    { id: "authored", contentId: item.id, recency: 10 },
    { id: "reshared", contentId: item.id, recency: 20 },
    { id: "other", contentId: "other", recency: 15 }
  ],
  (entry) => entry.contentId
);
assert.deepEqual(
  unique.map((entry) => entry.id),
  ["reshared", "other"]
);

const reconciled = reconcileProfileActivitySlots(
  [
    { id: "existing-a", recency: 10 },
    { id: "removed", recency: 8 }
  ],
  [
    { id: "added", recency: 20 },
    { id: "existing-a", recency: 12 }
  ]
);
assert.deepEqual(reconciled, [
  { id: "added", recency: 20 },
  { id: "existing-a", recency: 12 }
]);

const allSlots = [
  { id: "authored", recency: 12 },
  { id: "comment", recency: 10 }
];
const savedSlots = [{ id: "saved", recency: 20 }];

assert.deepEqual(
  selectProfileActivitySlots("@ada:all:1", "@ada:saved:2", allSlots, savedSlots),
  savedSlots
);
assert.deepEqual(
  selectProfileActivitySlots("@ada:saved:2", "@ada:saved:2", savedSlots, allSlots),
  savedSlots
);

for (const qualifiedReference of [
  "post_action.revision",
  "post_action.updated_at",
  "comment_action.revision",
  "comment_action.updated_at"
]) {
  assert.ok(
    PROFILE_ACTIVITY_SQL.includes(qualifiedReference),
    `Profile activity joins must qualify ${qualifiedReference}.`
  );
}
assert.ok(PROFILE_ACTIVITY_SQL.includes("FROM post_actions AS post_action"));
assert.ok(PROFILE_ACTIVITY_SQL.includes("FROM comment_actions AS comment_action"));
assert.ok(
  PROFILE_ACTIVITY_SQL.includes("post.post_type = 'paper' OR community.visibility = 'public'"),
  "Profile activity rows must hide current private-community activity while retaining papers."
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "self-authored profile actions",
        "activity deduplication",
        "live slot reconciliation",
        "profile tab isolation",
        "unambiguous live activity query",
        "private-community profile visibility boundary"
      ]
    },
    null,
    2
  )
);

export {};
