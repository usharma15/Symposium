import assert from "node:assert/strict";
import type { InquiryComment, InquiryItem } from "@/lib/mockData";
import {
  appendCommentToTree,
  commentActionActive,
  commentMetricsFallback,
  countComments,
  findCommentInTree,
  mapCommentTree,
  mutateCommentForActor,
  tombstoneCommentInItem
} from "@/lib/symposiumCore";

const root: InquiryComment = {
  id: "root",
  author: "Ada",
  authorHandle: "@ada",
  stance: "Comment",
  body: "Root comment",
  metrics: { ...commentMetricsFallback },
  replies: [
    {
      id: "child",
      parentId: "root",
      author: "Grace",
      authorHandle: "@grace",
      stance: "Reply",
      body: "Child comment",
      metrics: { ...commentMetricsFallback },
      replies: []
    }
  ]
};

const topLevel = appendCommentToTree([root], {
  id: "new-root",
  author: "Katherine",
  authorHandle: "@katherine",
  stance: "Comment",
  body: "Another root",
  metrics: { ...commentMetricsFallback },
  replies: []
});
assert.equal(topLevel.inserted, true);
assert.equal(topLevel.comments.length, 2);

const nested = appendCommentToTree([root], {
  id: "grandchild",
  parentId: "child",
  author: "Dorothy",
  authorHandle: "@dorothy",
  stance: "Reply",
  body: "Nested reply",
  metrics: { ...commentMetricsFallback },
  replies: []
});
assert.equal(nested.inserted, true);
assert.equal(findCommentInTree(nested.comments, "grandchild")?.parentId, "child");

const rejected = appendCommentToTree([root], {
  id: "orphan",
  parentId: "missing",
  author: "Orphan",
  authorHandle: "@orphan",
  stance: "Reply",
  body: "Should not insert",
  metrics: { ...commentMetricsFallback },
  replies: []
});
assert.equal(rejected.inserted, false);
assert.equal(findCommentInTree(rejected.comments, "orphan"), null);

const saved = mutateCommentForActor(root, "save", "@ada", true);
assert.equal(saved.metrics?.saves, "1");
assert.equal(commentActionActive(saved, "save", "@ada"), true);

const unsaved = mutateCommentForActor(saved, "save", "@ada", false);
assert.equal(unsaved.metrics?.saves, "0");
assert.equal(commentActionActive(unsaved, "save", "@ada"), false);

const mapped = mapCommentTree([root], "child", (comment) => ({
  ...comment,
  body: "Updated child"
}));
assert.equal(mapped.updated?.id, "child");
assert.equal(findCommentInTree(mapped.comments, "child")?.body, "Updated child");

const deleted: InquiryComment = {
  ...root,
  deletedAt: "2026-07-07T00:00:00.000Z",
  savedBy: [],
  metrics: { ...commentMetricsFallback }
};
const deletedAfterAction = mutateCommentForActor(deleted, "save", "@ada", true);
assert.deepEqual(deletedAfterAction, deleted);

const item: InquiryItem = {
  id: "post",
  kind: "thought",
  room: "symposium",
  title: "Deletion projection",
  author: "Ada",
  authorHandle: "@ada",
  affiliation: "Test",
  date: "Now",
  status: "Active",
  metrics: { signal: "0", critiques: "2", forks: "0", saves: "0", reads: "0" },
  gatheringReason: "Test",
  excerpt: "Test",
  body: "Test",
  tags: [],
  signals: [{ label: "Critiques", value: "2" }],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  comments: [root],
  attachments: [],
  savedBy: [],
  signaledBy: [],
  forkedBy: []
};
const deletion = tombstoneCommentInItem(item, "root", "2026-07-10T00:00:00.000Z");
assert.equal(deletion.deletedComment?.id, "root");
assert.equal(deletion.item.metrics.critiques, "1");
assert.equal(deletion.item.signals[0]?.value, "1");
assert.equal(countComments(deletion.item.comments), 1);
assert.equal(deletion.item.comments[0]?.replies?.[0]?.id, "child");
assert.deepEqual(tombstoneCommentInItem(deletion.item, "root").item, deletion.item);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: ["comment tree helpers", "deleted-comment count projection", "idempotent tombstones"]
    },
    null,
    2
  )
);

export {};
