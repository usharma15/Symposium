import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROFILE_ACTIVITY_COUNTS_SQL,
  PROFILE_ACTIVITY_SQL,
  PROFILE_AUTHORED_COMMENTS_SQL
} from "@/apps/api/src/repository/actions";
import type { CanonicalActionActivityContract } from "@/packages/contracts/src";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import {
  applyProfileActivityActionTotalTransition,
  buildLegacyProfileAuthoredComments,
  itemMatchesProfilePostAction,
  mergeCanonicalActivities,
  profileActivityCounts,
  profileCommentsArePubliclyListable,
  profileItemIsPubliclyListable,
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
  postType: "thought",
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

const publicCommunity = {
  id: "public-community",
  name: "Public Community",
  field: "Profile verification",
  summary: "Public community profile activity verification.",
  visibility: "public" as const,
  online: 1,
  memberHandles: [person.handle],
  keywords: ["profile"],
  seedCounts: { papers: 0, thoughts: 1, opportunities: 0 },
  callStatus: "quiet" as const
};
const publicCommunityThought = { ...item, id: "public-community-thought", communityId: publicCommunity.id };
assert.equal(profileItemIsPubliclyListable(publicCommunityThought, [publicCommunity]), true);
assert.equal(profileCommentsArePubliclyListable(publicCommunityThought, [publicCommunity]), true);
assert.equal(profileItemIsPubliclyListable(publicCommunityThought, [{ ...publicCommunity, visibility: "private" }]), false);
const privateCommunityPaper = {
  ...item,
  id: "private-community-paper",
  kind: "paper" as const,
  postType: "paper" as const,
  room: "library" as const,
  communityId: publicCommunity.id
};
assert.equal(profileItemIsPubliclyListable(privateCommunityPaper, [{ ...publicCommunity, visibility: "private" }]), true);
assert.equal(profileCommentsArePubliclyListable(privateCommunityPaper, [{ ...publicCommunity, visibility: "private" }]), true);

assert.equal(itemMatchesProfilePostAction(item, person, "save", person.handle), true);
assert.equal(itemMatchesProfilePostAction(item, person, "signal"), true);
assert.equal(itemMatchesProfilePostAction(item, person, "fork"), true);
assert.equal(itemMatchesProfilePostAction({ ...item, deletedAt: new Date().toISOString() }, person, "save"), false);

const exactCounts = profileActivityCounts([
  item,
  {
    ...item,
    id: "other-work",
    author: "Grace Hopper",
    authorHandle: "@grace",
    comments: [{
      id: "ada-comment",
      author: person.name,
      authorHandle: person.handle,
      body: "A canonical profile comment.",
      stance: "Comment",
      replies: [],
      savedBy: [person.handle],
      signaledBy: [person.handle],
      forkedBy: []
    }]
  }
], person.handle);
assert.deepEqual(exactCounts, {
  all: 3,
  papers: 0,
  thoughts: 1,
  proposals: 0,
  opportunities: 0,
  comments: 1,
  reshares: 2,
  likes: 3,
  saved: 3
});

const quoteSnapshot = {
  sourceType: "post" as const,
  sourceId: "quoted-source",
  sourcePostId: "quoted-source",
  available: true,
  attachmentCount: 0
};
const quoteOnlyCounts = profileActivityCounts([
  {
    ...item,
    id: "authored-quote-only",
    quote: quoteSnapshot,
    saved: false,
    savedBy: [],
    signaledBy: [],
    forkedBy: []
  },
  {
    ...item,
    id: "comment-quote-host",
    author: "Grace Hopper",
    authorHandle: "@grace",
    saved: false,
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    comments: [{
      id: "authored-comment-quote-only",
      author: person.name,
      authorHandle: person.handle,
      body: "A quote is authored content, not a reshare action.",
      stance: "Comment",
      quote: quoteSnapshot,
      replies: [],
      savedBy: [],
      signaledBy: [],
      forkedBy: []
    }]
  }
], person.handle);
assert.deepEqual(quoteOnlyCounts, {
  all: 2,
  papers: 0,
  thoughts: 1,
  proposals: 0,
  opportunities: 0,
  comments: 1,
  reshares: 0,
  likes: 0,
  saved: 0
}, "Quoting content must not be classified or counted as a reshare action.");
assert.deepEqual(
  applyProfileActivityActionTotalTransition(exactCounts, "signal", true, false, false),
  { ...exactCounts, likes: 2 }
);

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
assert.deepEqual(
  reconcileProfileActivitySlots(
    [{ id: "older", recency: 10 }, { id: "newer", recency: 20 }],
    [{ id: "newer", recency: 20 }, { id: "older", recency: 10 }]
  ).map((entry) => entry.id),
  ["newer", "older"],
  "A canonical refresh must adopt the server's exact newest-first order."
);

const canonicalActivity = (
  subjectId: string,
  occurredAt: string,
  action: CanonicalActionActivityContract["action"] = "signal"
): CanonicalActionActivityContract => ({
  subjectType: "post",
  subjectId,
  postId: subjectId,
  actorHandle: person.handle,
  action,
  active: true,
  count: 1,
  revision: 1,
  occurredAt
});
assert.deepEqual(
  mergeCanonicalActivities([], [
    canonicalActivity("oldest", "2026-07-15T12:00:00.000Z"),
    canonicalActivity("newest", "2026-07-17T12:00:00.000Z"),
    canonicalActivity("tie-a", "2026-07-16T12:00:00.000Z"),
    canonicalActivity("tie-b", "2026-07-16T12:00:00.000Z")
  ]).map((entry) => entry.subjectId),
  ["newest", "tie-b", "tie-a", "oldest"]
);

const authoredCommentHost: InquiryItem = {
  ...item,
  id: "comment-host",
  comments: [
    {
      id: "older-comment",
      author: person.name,
      authorHandle: person.handle,
      body: "Older comment",
      stance: "Comment",
      createdAt: "2026-07-15T12:00:00.000Z",
      replies: []
    },
    {
      id: "newer-comment",
      author: person.name,
      authorHandle: person.handle,
      body: "Newer comment",
      stance: "Comment",
      createdAt: "2026-07-17T12:00:00.000Z",
      quote: {
        sourceType: "post",
        sourceId: "quoted-source",
        sourcePostId: "quoted-source",
        available: true,
        attachmentCount: 0
      },
      replies: []
    }
  ]
};
const authoredComments = buildLegacyProfileAuthoredComments([authoredCommentHost], person.handle);
assert.deepEqual(authoredComments.map((entry) => entry.commentId), ["newer-comment", "older-comment"]);

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
assert.deepEqual(
  selectProfileActivitySlots("@ada:all:1:loading", "@ada:all:1:canonical", allSlots, savedSlots),
  savedSlots
);

const profileViews = readFileSync(path.join(process.cwd(), "features/profiles/ProfileViews.tsx"), "utf8");
assert.match(profileViews, /aria-busy={!canonicalActivityLoaded}/);
assert.match(profileViews, /canonicalActivityTotals\s+\? activityTotals\[tab\.id\]/);
assert.match(profileViews, /canonicalActivityComplete \? "" : "\+"/);
assert.match(profileViews, /!canonicalActivityComplete \|\| !authoredActivityComplete/);
assert.match(profileViews, /InfiniteFeedBoundary/);
assert.match(profileViews, /onLoadMore=\{onLoadMoreActivity\}/);
assert.match(profileViews, /Counts and post order will appear together when they are authoritative\./);
assert.match(profileViews, /canonicalActivityError \? \(/);
assert.match(profileViews, /canonicalPostActivity\(item, action\)\?\.occurredAt/);
assert.doesNotMatch(
  profileViews,
  /quotedPostEntries|quotedCommentEntries/,
  "The Reshares tab must be sourced only from canonical fork actions."
);
assert.doesNotMatch(
  profileViews,
  /canonicalActivityLoaded && !tabs\.some/,
  "Canonical profile routes must survive the authenticated identity transition."
);

const profileShell = readFileSync(path.join(process.cwd(), "components/SymposiumV0.tsx"), "utf8");
assert.match(
  profileShell,
  /const reconcileBoundedReadItem =[\s\S]*?current\?\.detailLoaded && !incoming\.detailLoaded[\s\S]*?comments: mergeSparseProfileComments\(current\.comments, incoming\.comments \?\? \[\]\)/,
  "A cached detail response must retain sparse comments selected by canonical profile activity."
);
assert.match(
  profileShell,
  /const normalizedItems =[\s\S]*?return reconcileBoundedReadItem\(incoming, current, nextProfile\.handle\);/,
  "A bounded bootstrap refresh must retain sparse comments already hydrated by profile activity."
);
for (const scopedPagingBoundary of [
  "commentsCursor",
  "includeComments",
  "actions: requestedActions.join(\",\")",
  "const requestKey = `${clean}:${scope}`"
]) {
  assert.ok(
    profileShell.includes(scopedPagingBoundary),
    `Profile activity paging must retain ${scopedPagingBoundary}.`
  );
}

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
assert.ok(
  PROFILE_ACTIVITY_SQL.includes("$8::boolean OR post.community_id IS NULL"),
  "A profile owner must receive their complete private-community activity ledger."
);
for (const authoredCommentBoundary of [
  "comment.author_handle = $1",
  "(comment.created_at, comment.id) <",
  "ORDER BY comment.created_at DESC, comment.id DESC",
  "post.post_type = 'paper' OR community.visibility = 'public'"
]) {
  assert.ok(
    PROFILE_AUTHORED_COMMENTS_SQL.includes(authoredCommentBoundary),
    `Authored comment paging must retain ${authoredCommentBoundary}.`
  );
}
assert.doesNotMatch(
  PROFILE_ACTIVITY_COUNTS_SQL,
  /quote\s+IS\s+NOT\s+NULL/i,
  "Exact reshare totals must come only from active fork ledger rows."
);
for (const exactCountBoundary of [
  "totalAll",
  "totalPapers",
  "totalComments",
  "totalReshares",
  "totalLikes",
  "totalSaved",
  "hiddenAll"
]) {
  assert.ok(
    PROFILE_ACTIVITY_COUNTS_SQL.includes(exactCountBoundary),
    `Profile activity must project ${exactCountBoundary} independently of cursor pagination.`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "self-authored profile actions",
        "quote and reshare semantic separation",
        "authored comment paging and hydration",
        "activity deduplication",
        "persisted action-timestamp ordering",
        "deterministic equal-timestamp ordering",
        "live slot reconciliation",
        "rapid profile-filter request isolation",
        "loading-to-canonical first-frame replacement",
        "detail-loaded sparse profile comment hydration",
        "bounded bootstrap sparse profile comment retention",
        "authoritative profile count and order loading boundary",
        "cursor-independent exact activity totals",
        "instant optimistic total transitions",
        "independent authored-post and action-ledger pagination",
        "profile tab isolation",
        "public-community authored post visibility",
        "private-community paper discussion visibility",
        "unambiguous live activity query",
        "private-community profile visibility boundary"
      ]
    },
    null,
    2
  )
);

export {};
