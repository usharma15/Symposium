import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendScopedLiveEvent,
  isLiveInquiryItem,
  isLiveResearchProfile,
  resetScopedLiveEventBuffer,
  routeSymposiumLiveEvent,
  scopedLiveEvents,
  type SymposiumLiveEvent,
  type SymposiumLiveRoutingPorts
} from "@/features/live-sync/symposiumLiveEventRouter";
import {
  inquiryItems,
  profile,
  type InquiryItem
} from "@/lib/mockData";
import { reportCheck } from "@/scripts/checkReport";

const liveItem = {
  ...inquiryItems[0]!,
  id: "live-routing-item",
  authorHandle: "@viewer"
} satisfies InquiryItem;

const event = (
  kind: string,
  payload: SymposiumLiveEvent["payload"] = {},
  overrides: Partial<SymposiumLiveEvent> = {}
): SymposiumLiveEvent => ({
  id: `event:${kind}`,
  cursor: `cursor:${kind}`,
  kind,
  actorHandle: "@viewer",
  subjectType: "post",
  subjectId: liveItem.id,
  payload,
  createdAt: "2026-07-30T12:34:56.000Z",
  ...overrides
});

const recorder = ({
  acceptCanonical = true,
  acceptProjection = true
}: {
  acceptCanonical?: boolean;
  acceptProjection?: boolean;
} = {}) => {
  const calls: string[] = [];
  const ports: SymposiumLiveRoutingPorts = {
    acceptCanonicalActivity: () => {
      calls.push("accept-canonical");
      return acceptCanonical;
    },
    acceptLiveActionProjection: ({ commentId }) => {
      calls.push(commentId ? `accept-comment:${commentId}` : "accept-post");
      return acceptProjection;
    },
    appendAssistantEvent: () => calls.push("assistant"),
    appendMessagingEvent: () => calls.push("messaging"),
    appendNotificationEvent: () => calls.push("notification"),
    closeCommentEditor: (commentId) => calls.push(`close-comment:${commentId}`),
    closeCommentEditorsForPost: (itemId) => calls.push(`close-post-comments:${itemId}`),
    closePostEditor: (itemId) => calls.push(`close-post:${itemId}`),
    currentActorHandle: () => "@viewer",
    dispatchAnalyticsInvalidation: () => calls.push("analytics"),
    dispatchOpportunityApplicationsChange: () => calls.push("opportunity"),
    dispatchScribbleChange: (revision) => calls.push(`scribble:${revision ?? "none"}`),
    dispatchWorkspaceChange: () => calls.push("workspace"),
    invalidateQuotedSource: ({ sourceType, sourceId, sourcePostId }) =>
      calls.push(`invalidate:${sourceType}:${sourceId}:${sourcePostId}`),
    mergeLiveFollow: (_follow, following) => calls.push(`follow:${following}`),
    mergeLiveItem: (itemValue) => calls.push(`item:${itemValue.id}`),
    mergeLiveMetricPatch: () => calls.push("metrics"),
    mergeLiveProfile: (person) => calls.push(`profile:${person.handle}`),
    refreshActivity: () => calls.push("refresh-activity"),
    refreshAll: () => calls.push("refresh-all"),
    touchCommentActivity: (_itemId, commentId) =>
      calls.push(`touch-comment:${commentId}`),
    touchPostActivity: (itemId) => calls.push(`touch-post:${itemId}`)
  };
  return { calls, ports };
};

const route = (
  incoming: SymposiumLiveEvent,
  options?: Parameters<typeof recorder>[0]
) => {
  const recorded = recorder(options);
  routeSymposiumLiveEvent(incoming, recorded.ports);
  return recorded.calls;
};

assert.equal(isLiveInquiryItem(liveItem), true);
assert.equal(isLiveInquiryItem({ id: "partial" }), false);
assert.equal(isLiveResearchProfile(profile), true);
assert.equal(isLiveResearchProfile({ handle: "@partial" }), false);

const firstViewerBuffer = appendScopedLiveEvent(
  { scopeKey: "actor:first", events: [] as string[] },
  "actor:first",
  "private:first",
  2
);
assert.deepEqual(
  scopedLiveEvents(firstViewerBuffer, "actor:second"),
  [],
  "a new viewer must never render the previous viewer's buffered live events"
);
assert.deepEqual(
  resetScopedLiveEventBuffer(firstViewerBuffer, "actor:second"),
  { scopeKey: "actor:second", events: [] },
  "an authenticated scope transition must retire the previous private buffer"
);
const secondViewerBuffer = appendScopedLiveEvent(
  firstViewerBuffer,
  "actor:second",
  "private:second",
  2
);
assert.deepEqual(
  scopedLiveEvents(secondViewerBuffer, "actor:second"),
  ["private:second"],
  "the first event in a new scope must atomically replace the old private buffer"
);
assert.deepEqual(
  appendScopedLiveEvent(
    appendScopedLiveEvent(secondViewerBuffer, "actor:second", "newer", 2),
    "actor:second",
    "newest",
    2
  ).events,
  ["newer", "newest"],
  "session buffers must retain only their configured bounded tail"
);

assert.deepEqual(
  route(event("assistant.thread.updated")),
  ["analytics", "assistant"],
  "Assistant events must enter only the bounded Assistant buffer"
);
assert.deepEqual(
  route(event("message.sent")),
  ["analytics", "messaging"],
  "message events must enter only the bounded messaging buffer"
);
assert.deepEqual(
  route(event("profile.blocked")),
  ["analytics", "messaging"],
  "profile block events must retain their messaging refresh contract"
);
assert.deepEqual(
  route(event("notification.created", { item: liveItem })),
  ["analytics", "notification", `item:${liveItem.id}`, "refresh-activity"],
  "notification delivery must not suppress a canonical inquiry projection"
);
assert.deepEqual(
  route(event("post.action.updated", {
    action: "signal",
    itemId: liveItem.id,
    metrics: liveItem.metrics,
    revision: 4
  })),
  ["analytics", "metrics"],
  "metric-only events must converge without a full refresh"
);

assert.deepEqual(
  route(event("post.deleted", { item: liveItem })),
  [
    "analytics",
    `invalidate:post:${liveItem.id}:${liveItem.id}`,
    `item:${liveItem.id}`,
    `close-post:${liveItem.id}`,
    `close-post-comments:${liveItem.id}`,
    "refresh-activity"
  ],
  "canonical post deletion must invalidate quotes, editors, inquiry, and activity"
);
assert.deepEqual(
  route(event("post.deleted", { itemId: liveItem.id })),
  [
    "analytics",
    `invalidate:post:${liveItem.id}:${liveItem.id}`,
    "refresh-all",
    "refresh-activity"
  ],
  "sparse post deletion must fall back to the authoritative refresh"
);
assert.deepEqual(
  route(event("comment.deleted", {
    commentId: "comment-1",
    item: liveItem
  }, { subjectType: "comment", subjectId: "comment-1" })),
  [
    "analytics",
    `invalidate:comment:comment-1:${liveItem.id}`,
    "close-comment:comment-1",
    `item:${liveItem.id}`,
    "refresh-activity"
  ],
  "comment deletion must invalidate its quote and editor before convergence"
);

assert.deepEqual(
  route(event("profile.followed", { follow: {
    followerHandle: "@viewer",
    followingHandle: "@target",
    revision: 2
  } })),
  ["analytics", "follow:true", "refresh-all"],
  "follow events must update the relationship coordinator and bounded refresh"
);
assert.deepEqual(
  route(event("profile.unfollowed")),
  ["analytics", "follow:false", "refresh-all"],
  "sparse unfollow events must preserve the authoritative relationship fallback"
);
assert.deepEqual(
  route(event("profile.updated", { profile })),
  ["analytics", `profile:${profile.handle}`],
  "canonical profiles must merge without a global refresh"
);
assert.deepEqual(
  route(event("profile.updated", { profile: { handle: "@partial" } })),
  ["analytics", "refresh-all"],
  "malformed profile projections must fail over to refresh"
);

const canonicalActivity = {
  subjectType: "post" as const,
  subjectId: liveItem.id,
  postId: liveItem.id,
  actorHandle: "@viewer",
  action: "signal" as const,
  active: true,
  count: 1,
  revision: 2,
  occurredAt: "2026-07-30T12:34:56.000Z"
};
assert.deepEqual(
  route(event("post.action.updated", {
    action: "signal",
    activity: canonicalActivity,
    item: liveItem
  }), { acceptCanonical: false }),
  ["analytics", "accept-canonical"],
  "a stale canonical activity must not mutate the inquiry projection"
);
assert.deepEqual(
  route(event("post.action.updated", {
    action: "signal",
    item: liveItem
  })),
  [
    "analytics",
    "accept-post",
    `touch-post:${liveItem.id}`,
    `item:${liveItem.id}`,
    "refresh-activity"
  ],
  "the current actor's accepted post action must update activity and inquiry"
);
assert.deepEqual(
  route(event("comment.action.updated", {
    action: "save",
    commentId: "comment-1",
    item: liveItem
  }, { subjectType: "comment", subjectId: "comment-1" })),
  [
    "analytics",
    "accept-comment:comment-1",
    "touch-comment:comment-1",
    `item:${liveItem.id}`,
    "refresh-activity"
  ],
  "the current actor's accepted comment action must update both authorities"
);
assert.deepEqual(
  route(event("post.action.updated", {
    action: "signal",
    item: liveItem
  }), { acceptProjection: false }),
  ["analytics", "accept-post"],
  "protected optimistic intent must reject a stale live action projection"
);
assert.deepEqual(
  route(event("post.action.updated", {
    action: "signal",
    item: liveItem
  }, { actorHandle: "@another-viewer" })),
  ["analytics", `item:${liveItem.id}`, "refresh-activity"],
  "another actor's action must not touch the current profile's local activity"
);
assert.deepEqual(
  route(event("post.read", { action: "read", item: liveItem })),
  ["analytics", `item:${liveItem.id}`],
  "passive read events must merge without scheduling an expensive refresh"
);

assert.deepEqual(
  route(event("note.updated")),
  ["analytics", "workspace", "refresh-all"]
);
assert.deepEqual(
  route(event("scribble.updated", { revision: 17 })),
  ["analytics", "scribble:17", "refresh-all"]
);
assert.deepEqual(
  route(event("opportunity.application.updated")),
  ["analytics", "opportunity", "refresh-all"]
);
assert.deepEqual(
  route(event("unrelated.event")),
  ["analytics"],
  "unknown events must not manufacture a refresh"
);

const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const controller = readFileSync(
  "features/live-sync/useSymposiumLiveController.ts",
  "utf8"
);
const router = readFileSync(
  "features/live-sync/symposiumLiveEventRouter.ts",
  "utf8"
);
assert.match(shell, /useSymposiumLiveController\(\{/);
assert.doesNotMatch(shell, /useLiveEventStream|useCrossTabItemTransport/);
assert.doesNotMatch(
  shell,
  /event\.kind\.startsWith\("(?:notification|assistant|message|conversation|post|comment|profile|community|note|scribble)\./
);
assert.match(controller, /useLiveEventStream<SymposiumLiveEvent>/);
assert.match(controller, /useCrossTabItemTransport<ContentAnalyticsInvalidation>/);
assert.match(controller, /appendScopedLiveEvent\(current, authSessionKey, incoming, 1000\)/);
assert.match(controller, /scopedLiveEvents\(messagingBuffer, authSessionKey\)/);
assert.match(controller, /eventScopeKey !== transportScopeKey/);
assert.match(router, /routeSymposiumLiveEvent/);
assert.match(router, /ports\.acceptLiveActionProjection/);
assert.match(router, /ports\.invalidateQuotedSource/);
assert.match(router, /ports\.dispatchWorkspaceChange/);

reportCheck([
  "single typed global live-event routing authority",
  "viewer-scoped private event buffers",
  "canonical inquiry and profile projection validation",
  "metric-only and passive-read convergence",
  "optimistic action protection",
  "current-viewer activity isolation",
  "post and comment deletion invalidation",
  "profile and follow convergence",
  "bounded Assistant, messaging, and notification delivery",
  "Workspace, Scribble, opportunity, and analytics invalidation",
  "unknown-event no-op policy",
  "shell live-policy retirement"
]);
