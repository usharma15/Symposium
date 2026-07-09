import assert from "node:assert/strict";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import {
  itemMatchesProfilePostAction,
  reconcileProfileActivitySlots,
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

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: ["self-authored profile actions", "activity deduplication", "live slot reconciliation"]
    },
    null,
    2
  )
);

export {};
