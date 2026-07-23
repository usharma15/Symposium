import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import {
  archiveNotificationInputSchema,
  markNotificationInputSchema,
  notificationListQuerySchema,
  notificationPreferencesSchema,
  notificationSchema,
  updateNotificationPreferencesInputSchema,
  type NotificationPreferencesContract,
  type NotificationContract
} from "@/packages/contracts/src";
import {
  applyNotificationLiveEvent,
  archiveNotificationGroup,
  archiveReadNotifications,
  compactNotificationLimit,
  compactNotificationCount,
  latestNotificationEventKey,
  mergeNotificationPage,
  notificationCanArchive,
  notificationAttentionRank,
  partitionNotificationInbox
} from "@/features/notifications/notificationState";
import {
  contentMentionHandles,
  mentionHandleChanges,
  quoteNotificationInput,
  sameQuoteSource
} from "@/apps/api/src/services/contentNotifications";
import {
  defaultNotificationPreferences,
  inferNotificationAggregationKey,
  notificationAllowedByPreferences,
  notificationActionLabel,
  notificationDestination,
  notificationPreferenceCategory,
  notificationPriority
} from "@/apps/api/src/services/notificationAggregation";
import { notificationRelationshipKey } from "@/apps/api/src/services/notificationDelivery";
import {
  hasNotificationPreferenceChanges,
  notificationPreferenceChanges,
  notificationPreferenceKeys,
  notificationPreferencesFromLiveEvent
} from "@/features/notifications/notificationPreferences";
import {
  isPersistentSyncStatus,
  syncStatusAfterNavigation,
  syncStatusExpiryMs
} from "@/features/shell/syncStatusState";

const notification = (
  id: string,
  createdAt: string,
  readAt: string | null = null,
  groupKey = `notification:${id}`,
  groupCount = 1
): NotificationContract => ({
  id,
  groupKey,
  groupCount,
  actorHandles: ["@researcher"],
  priority: "activity",
  actionLabel: "View comments",
  kind: "post_comment",
  title: "A comment arrived",
  body: "A durable notification",
  href: "/posts/post-1",
  readAt,
  resolvedAt: null,
  metadata: { postId: "post-1" },
  createdAt
});

const permutations = <T,>(values: T[]): T[][] => {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)])
      .map((tail) => [value, ...tail])
  );
};

const main = async () => {
  assert.equal(compactNotificationCount(1), "1");
  assert.equal(compactNotificationCount(99), "99");
  assert.equal(compactNotificationCount(100), "99+");
  assert.equal(notificationPriority("community_join_request"), "action");
  assert.equal(notificationPriority("workspace_access_granted"), "important");
  assert.equal(notificationPriority("post_signal"), "activity");
  assert.equal(notificationActionLabel("community_join_request", "/communities/community-1"), "Review requests");
  assert.equal(notificationActionLabel("post_signal", "/posts/post-1?analytics=likes"), "View likes");
  assert.equal(notificationActionLabel("community_join_request", "/communities/community-1", "2026-07-23T00:00:00.000Z"), "Open community");
  assert.equal(notificationActionLabel("opportunity_application_received", "/posts/post-1/applications", "2026-07-23T00:00:00.000Z"), "View applications");
  assert.equal(notificationActionLabel("post_signal", "/posts/post-1", "2026-07-23T00:00:00.000Z"), null);
  assert.equal(notificationActionLabel("unknown", null), null);
  assert.equal(notificationDestination({
    kind: "profile_followed",
    href: "/profiles/follower",
    metadata: { followerHandle: "@follower" },
    profileHandle: "@owner"
  }), "/profiles/owner/followers");
  assert.equal(notificationDestination({
    kind: "community_join_request",
    href: "/communities/community-1?requests=pending",
    metadata: { communityId: "community-1" },
    profileHandle: "@owner",
    resolvedAt: "2026-07-23T00:00:00.000Z"
  }), "/communities/community-1");
  assert.equal(notificationDestination({
    kind: "opportunity_application_received",
    href: "/posts/post-1/applications?application=application-1",
    metadata: { postId: "post-1" },
    profileHandle: "@owner",
    resolvedAt: "2026-07-23T00:00:00.000Z"
  }), "/posts/post-1/applications");
  assert.equal(notificationDestination({
    kind: "post_signal",
    href: "/posts/post-1?analytics=likes",
    metadata: { postId: "post-1" },
    profileHandle: "@owner",
    resolvedAt: "2026-07-23T00:00:00.000Z"
  }), null);
  assert.equal(notificationDestination({
    kind: "opportunity_application_received",
    href: "/posts/post-1/applications",
    metadata: { postId: "post-1", resolution: "source_post_deleted" },
    profileHandle: "@owner",
    resolvedAt: "2026-07-23T00:00:00.000Z"
  }), null);
  assert.equal(notificationDestination({
    kind: "profile_followed",
    href: "/profiles/owner/followers",
    metadata: { followerHandle: "@former-follower", resolution: "profile_unfollowed" },
    profileHandle: "@owner",
    resolvedAt: "2026-07-23T00:00:00.000Z"
  }), null);
  const notificationKindMatrix = [
    ["comment_mention", "activity", "View mention"],
    ["comment_quote", "activity", "View quotes"],
    ["comment_reply", "activity", "View reply"],
    ["comment_reshare", "activity", "View reshares"],
    ["comment_signal", "activity", "View likes"],
    ["community_join_request", "action", "Review requests"],
    ["community_member_removed", "important", "Open community"],
    ["community_request_approved", "important", "Open community"],
    ["community_request_declined", "important", "Open community"],
    ["community_role_updated", "important", "Open community"],
    ["group_added", "important", "Open messages"],
    ["group_removed", "important", "Open messages"],
    ["group_role_updated", "important", "Open messages"],
    ["opportunity_application_closed", "important", "View opportunity"],
    ["opportunity_application_received", "action", "Review applications"],
    ["opportunity_application_shortlisted", "important", "View opportunity"],
    ["opportunity_application_status", "important", "View opportunity"],
    ["post_comment", "activity", "View comments"],
    ["post_mention", "activity", "View mention"],
    ["post_quote", "activity", "View quotes"],
    ["post_reshare", "activity", "View reshares"],
    ["post_signal", "activity", "View likes"],
    ["profile_followed", "activity", "View followers"],
    ["workspace_access_granted", "important", "Open workspace"],
    ["workspace_access_revoked", "important", "Open workspace"],
    ["workspace_access_updated", "important", "Open workspace"],
    ["workspace_comment", "activity", "Open comment"],
    ["workspace_comment_reply", "activity", "View reply"],
    ["workspace_comment_signal", "activity", "View likes"],
    ["workspace_mention", "activity", "View mention"]
  ] as const;
  for (const [kind, expectedPriority, expectedAction] of notificationKindMatrix) {
    assert.equal(notificationPriority(kind), expectedPriority, `${kind} priority`);
    assert.equal(notificationActionLabel(kind, "/destination"), expectedAction, `${kind} action`);
  }
  assert.equal(notificationPreferenceCategory("post_reshare"), "reshares");
  assert.equal(notificationPreferenceCategory("comment_reshare"), "reshares");
  assert.equal(notificationPreferenceCategory("post_quote"), "quotes");
  assert.equal(notificationPreferenceCategory("comment_quote"), "quotes");
  assert.equal(notificationPreferenceCategory("post_mention"), "commentsAndReplies");
  assert.equal(notificationPreferenceCategory("comment_mention"), "commentsAndReplies");
  assert.equal(notificationPreferenceCategory("workspace_mention"), "workspaceActivity");
  const postReshareGroup = inferNotificationAggregationKey("post_reshare", { postId: "post-1" });
  const postQuoteGroup = inferNotificationAggregationKey("post_quote", { sourceId: "post-1" });
  const commentReshareGroup = inferNotificationAggregationKey("comment_reshare", { commentId: "comment-1" });
  const commentQuoteGroup = inferNotificationAggregationKey("comment_quote", { sourceId: "comment-1" });
  assert.equal(postReshareGroup, "post_reshare:post:post-1");
  assert.equal(postQuoteGroup, "post_quote:post:post-1");
  assert.notEqual(postReshareGroup, postQuoteGroup);
  assert.equal(commentReshareGroup, "comment_reshare:comment:comment-1");
  assert.equal(commentQuoteGroup, "comment_quote:comment:comment-1");
  assert.notEqual(commentReshareGroup, commentQuoteGroup);

  const mentionDocument = {
    version: 1 as const,
    nodes: [{
      id: "paragraph-1",
      type: "paragraph" as const,
      content: [
        { text: "@Grace", mentionHandle: "@Grace" },
        { text: " and @linus" }
      ],
      align: "left" as const,
      indent: 0
    }]
  };
  assert.deepEqual(
    contentMentionHandles({
      body: "Ask @Ada, @q and @ada, but not researcher@example.com.",
      document: mentionDocument
    }),
    ["@ada", "@grace", "@linus", "@q"]
  );
  assert.deepEqual(
    mentionHandleChanges(
      { body: "@ada @grace" },
      { body: "@grace @linus" }
    ),
    { added: ["@linus"], removed: ["@ada"] }
  );
  const quote = {
    sourceType: "post" as const,
    sourceId: "source-post",
    sourcePostId: "source-post",
    available: true,
    author: "Source owner",
    authorHandle: "@source",
    attachmentCount: 0
  };
  assert.equal(sameQuoteSource(quote, { ...quote, sourceRevision: 2 }), true);
  assert.equal(sameQuoteSource(quote, { ...quote, sourceId: "other" }), false);
  const quoteInput = quoteNotificationInput({
    quote,
    quoteOwnerType: "comment",
    quoteOwnerId: "quote-comment",
    quoteOwnerPostId: "quote-post",
    actorHandle: "@actor",
    actorName: "Actor",
    body: "Host post",
    recipientCanRead: true
  });
  assert.equal(quoteInput?.kind, "post_quote");
  assert.equal(quoteInput?.profileHandle, "@source");
  assert.equal(quoteInput?.href, "/posts/source-post?analytics=quotes");
  assert.equal(quoteInput?.metadata?.analyticsView, "quotes");
  assert.equal(quoteNotificationInput({
    quote,
    quoteOwnerType: "post",
    quoteOwnerId: "quote-post",
    quoteOwnerPostId: "quote-post",
    actorHandle: "@actor",
    actorName: "Actor",
    body: "Private host",
    recipientCanRead: false
  }), null);
  const relationshipHandles = Array.from({ length: 64 }, (_, index) => `@person-${index}`);
  const relationshipKeys = new Set<string>();
  for (const left of relationshipHandles) {
    for (const right of relationshipHandles) {
      assert.equal(
        notificationRelationshipKey(left, right),
        notificationRelationshipKey(right, left),
        "Block filtering must be symmetric."
      );
      if (left !== right) relationshipKeys.add(notificationRelationshipKey(left, right));
    }
  }
  assert.equal(
    relationshipKeys.size,
    relationshipHandles.length * (relationshipHandles.length - 1) / 2,
    "Every unordered profile relationship must retain a unique block-filter key."
  );
  const preferenceScenarios: NotificationPreferencesContract[] = Array.from(
    { length: 2 ** notificationPreferenceKeys.length },
    (_, mask) => ({
      ...defaultNotificationPreferences("2026-07-23T00:00:00.000Z"),
      ...Object.fromEntries(notificationPreferenceKeys.map((key, index) => [
        key,
        Boolean(mask & (1 << index))
      ]))
    })
  );
  for (const [scenarioIndex, preferences] of preferenceScenarios.entries()) {
    assert.equal(notificationPreferencesSchema.safeParse(preferences).success, true);
    for (const [kind, priority] of notificationKindMatrix) {
      const category = notificationPreferenceCategory(kind);
      if (priority === "activity") {
        assert.ok(category, `${kind} must map to an activity preference`);
      } else {
        assert.equal(category, null, `${kind} must remain an always-on alert`);
      }
      const expected = category
        ? preferences.activityEnabled && preferences[category]
        : true;
      assert.equal(
        notificationAllowedByPreferences(kind, preferences),
        expected,
        `preference scenario ${scenarioIndex}, ${kind}`
      );
    }
    assert.equal(
      notificationAllowedByPreferences("future_required_notification", preferences),
      true,
      "Unknown future notifications fail open instead of silently disappearing."
    );
  }
  for (const canonical of preferenceScenarios) {
    for (const desired of preferenceScenarios) {
      const changes = notificationPreferenceChanges(canonical, desired);
      const expectedChangedKeys = notificationPreferenceKeys.filter(
        (key) => canonical[key] !== desired[key]
      );
      assert.deepEqual(Object.keys(changes), expectedChangedKeys);
      assert.equal(
        hasNotificationPreferenceChanges(canonical, desired),
        expectedChangedKeys.length > 0
      );
    }
  }
  const allDisabled = {
    ...defaultNotificationPreferences("2026-07-23T00:00:00.000Z"),
    ...Object.fromEntries(notificationPreferenceKeys.map((key) => [key, false]))
  } as NotificationPreferencesContract;
  for (const order of permutations([...notificationPreferenceKeys])) {
    const toggled = order.reduce<NotificationPreferencesContract>(
      (current, key) => ({ ...current, [key]: true }),
      allDisabled
    );
    assert.ok(notificationPreferenceKeys.every((key) => toggled[key]), `toggle order ${order.join(",")}`);
  }
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    actorHandle: "@researcher",
    expectedRevision: 1,
    changes: { likes: false, commentsAndReplies: false }
  }).success, true);
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    expectedRevision: 1,
    changes: {}
  }).success, false);
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    expectedRevision: 0,
    changes: { likes: false }
  }).success, false);
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    expectedRevision: 2_147_483_648,
    changes: { likes: false }
  }).success, false);
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    expectedRevision: 1,
    changes: { likes: false, inventedCategory: false }
  }).success, false);
  assert.equal(updateNotificationPreferencesInputSchema.safeParse({
    expectedRevision: 1,
    changes: { likes: false },
    inventedTransportField: true
  }).success, false);
  const livePreferenceUpdate = {
    id: "preferences-event",
    kind: "notification.preferences.updated",
    subjectId: "@viewer",
    payload: {
      preferences: {
        ...defaultNotificationPreferences("2026-07-23T10:00:00.000Z"),
        likes: false,
        revision: 2
      }
    }
  };
  assert.equal(notificationPreferencesFromLiveEvent(livePreferenceUpdate)?.likes, false);
  assert.equal(notificationPreferencesFromLiveEvent({
    ...livePreferenceUpdate,
    payload: { preferences: { likes: false } }
  }), null);
  assert.equal(isPersistentSyncStatus("Live data connected"), true);
  assert.equal(syncStatusExpiryMs("Live data connected"), null);
  assert.equal(syncStatusExpiryMs("Post detail could not load"), 6_500);
  assert.equal(syncStatusExpiryMs("Saving profile settings"), 30_000);
  assert.equal(syncStatusExpiryMs("Post saved"), 3_500);
  assert.equal(
    syncStatusAfterNavigation("Post detail could not load", "Live updates reconnecting"),
    "Live updates reconnecting"
  );
  assert.equal(
    syncStatusAfterNavigation("Live data connected", "Live updates reconnecting"),
    "Live data connected"
  );
  const legacyNotification = notificationSchema.parse({
    id: "00000000-0000-4000-8000-000000000000",
    kind: "legacy_kind",
    title: "An older API response",
    body: "",
    href: null,
    readAt: null,
    metadata: {},
    createdAt: "2026-07-20T10:00:00.000Z"
  });
  assert.equal(legacyNotification.priority, "activity");
  assert.equal(legacyNotification.actionLabel, null);
  assert.equal(legacyNotification.resolvedAt, null);

  const lifecycleTimestamp = "2026-07-23T12:00:00.000Z";
  for (const [kind, priority] of notificationKindMatrix) {
    for (const readAt of [null, lifecycleTimestamp]) {
      for (const resolvedAt of [null, lifecycleTimestamp]) {
        const lifecycleNotification = {
          ...notification(
            "00000000-0000-4000-8000-000000000099",
            "2026-07-23T11:00:00.000Z",
            readAt,
            `${kind}:lifecycle`
          ),
          kind,
          priority,
          resolvedAt
        };
        const expectedRank = resolvedAt
          ? 0
          : priority === "action"
            ? 2
            : priority === "important" && !readAt
              ? 1
              : 0;
        assert.equal(
          notificationAttentionRank(lifecycleNotification),
          expectedRank,
          `${kind}, read=${Boolean(readAt)}, resolved=${Boolean(resolvedAt)}`
        );
        const lifecyclePartition = partitionNotificationInbox([lifecycleNotification], true);
        assert.equal(lifecyclePartition.needsAttention.length, Number(expectedRank > 0));
        assert.equal(lifecyclePartition.recent.length, Number(expectedRank === 0));
      }
    }
  }

  const older = notification("00000000-0000-4000-8000-000000000001", "2026-07-20T10:00:00.000Z");
  const newer = notification("00000000-0000-4000-8000-000000000002", "2026-07-21T10:00:00.000Z");
  assert.deepEqual(mergeNotificationPage([older], [newer, older]).map((entry) => entry.id), [newer.id, older.id]);

  const createdEvent = {
    id: "event-created",
    kind: "notification.created",
    subjectId: newer.id,
    createdAt: "2026-07-21T10:00:00.100Z",
    payload: { notification: newer }
  };
  const created = applyNotificationLiveEvent({ notifications: [older], unreadCount: 1 }, createdEvent);
  assert.deepEqual(created.notifications.map((entry) => entry.id), [newer.id, older.id]);
  assert.equal(created.unreadCount, 2);
  assert.equal(applyNotificationLiveEvent(created, createdEvent).unreadCount, 2);

  const groupedNewer = notification(
    "00000000-0000-4000-8000-000000000003",
    "2026-07-22T10:00:00.000Z",
    null,
    older.groupKey,
    2
  );
  const grouped = applyNotificationLiveEvent(created, {
    id: "event-grouped",
    kind: "notification.created",
    subjectId: groupedNewer.id,
    payload: { notification: groupedNewer }
  });
  assert.equal(grouped.notifications.length, 2);
  assert.equal(grouped.notifications.find((entry) => entry.groupKey === older.groupKey)?.groupCount, 2);
  assert.equal(grouped.unreadCount, 2);

  const previouslyRead = {
    ...notification(
      "00000000-0000-4000-8000-000000000004",
      "2026-07-20T11:00:00.000Z",
      "2026-07-20T11:05:00.000Z",
      "post_signal:post:reactivated"
    ),
    kind: "post_signal",
    actionLabel: "View likes"
  };
  const reactivated = applyNotificationLiveEvent(
    { notifications: [previouslyRead], unreadCount: 0 },
    {
      id: "event-reactivated",
      kind: "notification.created",
      subjectId: "00000000-0000-4000-8000-000000000005",
      createdAt: "2026-07-23T10:00:00.000Z",
      payload: {
        notification: {
          ...previouslyRead,
          id: "00000000-0000-4000-8000-000000000005",
          groupCount: 1,
          readAt: null,
          createdAt: "2026-07-23T10:00:00.000Z"
        }
      }
    }
  );
  assert.equal(reactivated.unreadCount, 1);
  assert.equal(reactivated.notifications[0]?.groupCount, 1);

  const massActivity = Array.from({ length: 500 }, (_, index) => notification(
    `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    new Date(Date.UTC(2026, 6, 23, 12, 0, 0) - index * 1_000).toISOString()
  ));
  const olderAttention = {
    ...notification(
      "00000000-0000-4000-8000-999999999999",
      "2026-07-20T10:00:00.000Z"
    ),
    priority: "action" as const,
    actionLabel: "Review requests"
  };
  const compact = partitionNotificationInbox([...massActivity, olderAttention]);
  assert.equal(compact.needsAttention[0]?.id, olderAttention.id);
  assert.equal(compact.needsAttention.length + compact.recent.length, compactNotificationLimit);
  assert.equal(compact.hiddenCount, massActivity.length + 1 - compactNotificationLimit);
  const expanded = partitionNotificationInbox([...massActivity, olderAttention], true);
  assert.equal(expanded.needsAttention.length, 1);
  assert.equal(expanded.recent.length, massActivity.length);
  assert.equal(expanded.hiddenCount, 0);
  const attentionFlood = Array.from({ length: compactNotificationLimit + 20 }, (_, index) => ({
    ...notification(
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      new Date(Date.UTC(2026, 6, 23, 12, 0, 0) - index * 1_000).toISOString()
    ),
    priority: "important" as const,
    actionLabel: "Open workspace"
  }));
  const compactAttentionFlood = partitionNotificationInbox([...massActivity, ...attentionFlood]);
  assert.equal(compactAttentionFlood.needsAttention.length, compactNotificationLimit);
  assert.equal(compactAttentionFlood.recent.length, 0);
  assert.equal(
    new Set([
      ...compactAttentionFlood.needsAttention,
      ...compactAttentionFlood.recent
    ].map((entry) => entry.groupKey)).size,
    compactNotificationLimit
  );

  const readAction = {
    ...olderAttention,
    readAt: "2026-07-23T12:05:00.000Z"
  };
  assert.equal(partitionNotificationInbox([readAction], true).needsAttention.length, 1);
  const resolvedAction = {
    ...readAction,
    resolvedAt: "2026-07-23T12:06:00.000Z"
  };
  assert.equal(partitionNotificationInbox([resolvedAction], true).needsAttention.length, 0);
  assert.equal(partitionNotificationInbox([resolvedAction], true).recent.length, 1);
  assert.equal(notificationCanArchive(readAction), false);
  assert.equal(notificationCanArchive(resolvedAction), true);
  assert.equal(notificationCanArchive(older), true);
  const archivedUnread = archiveNotificationGroup(
    { notifications: [older, newer], unreadCount: 2 },
    older.groupKey
  );
  assert.deepEqual(archivedUnread.notifications, [newer]);
  assert.equal(archivedUnread.unreadCount, 1);
  assert.deepEqual(
    archiveNotificationGroup(
      { notifications: [readAction], unreadCount: 0 },
      readAction.groupKey
    ).notifications,
    [readAction],
    "Open requests cannot be archived."
  );
  const readActivity = { ...older, readAt: lifecycleTimestamp };
  const clearableResolvedAction = { ...resolvedAction, groupKey: "resolved-action" };
  const clearedRead = archiveReadNotifications({
    notifications: [readActivity, newer, readAction, clearableResolvedAction],
    unreadCount: 1
  });
  assert.deepEqual(
    clearedRead.notifications.map((entry) => entry.groupKey),
    [newer.groupKey, readAction.groupKey]
  );
  assert.equal(clearedRead.unreadCount, 1);
  assert.deepEqual(
    applyNotificationLiveEvent(
      { notifications: [older, newer], unreadCount: 2 },
      {
        id: "event-archive",
        kind: "notification.archived",
        subjectId: older.id,
        payload: { groupKey: older.groupKey }
      }
    ).notifications,
    [newer]
  );

  const resolutionSource = {
    ...notification(
      "20000000-0000-4000-8000-000000000001",
      "2026-07-23T12:10:00.000Z",
      null,
      "community_join_request:community:community-1"
    ),
    kind: "community_join_request",
    priority: "action" as const,
    actionLabel: "Review requests"
  };
  const resolutionCanonical = {
    ...resolutionSource,
    readAt: "2026-07-23T12:11:00.000Z",
    resolvedAt: "2026-07-23T12:11:00.000Z",
    href: "/communities/community-1",
    actionLabel: "Open community"
  };
  const resolvedLive = applyNotificationLiveEvent(
    { notifications: [resolutionSource], unreadCount: 1 },
    {
      id: "event-resolved",
      kind: "notification.resolved",
      subjectId: resolutionCanonical.id,
      createdAt: "2026-07-23T12:11:00.000Z",
      payload: { notification: resolutionCanonical, reason: "community_request_approved" }
    }
  );
  assert.equal(resolvedLive.unreadCount, 0);
  assert.deepEqual(resolvedLive.notifications, [resolutionCanonical]);
  assert.equal(partitionNotificationInbox(resolvedLive.notifications, true).needsAttention.length, 0);
  assert.equal(applyNotificationLiveEvent(resolvedLive, {
    id: "event-resolved",
    kind: "notification.resolved",
    subjectId: resolutionCanonical.id,
    payload: { notification: resolutionCanonical }
  }).unreadCount, 0);

  let lifecycleState = { notifications: [] as NotificationContract[], unreadCount: 0 };
  const lifecycleExpected = new Map<string, NotificationContract>();
  let lifecycleSeed = 0x5eed1234;
  let lifecycleId = 1_000;
  const nextRandom = () => {
    lifecycleSeed = (Math.imul(lifecycleSeed, 1_664_525) + 1_013_904_223) >>> 0;
    return lifecycleSeed;
  };
  for (let step = 0; step < 60_000; step += 1) {
    const matrixEntry = notificationKindMatrix[nextRandom() % notificationKindMatrix.length]!;
    const groupIndex = nextRandom() % 96;
    const groupKey = `${matrixEntry[0]}:state-machine:${groupIndex}`;
    const existing = lifecycleExpected.get(groupKey);
    const operation = nextRandom() % 9;
    if (!existing || operation <= 2) {
      lifecycleId += 1;
      const createdAt = new Date(Date.UTC(2026, 6, 23, 12, 0, 0) + step).toISOString();
      const next = {
        ...notification(
          `30000000-0000-4000-8000-${String(lifecycleId).padStart(12, "0")}`,
          createdAt,
          null,
          groupKey,
          1 + (nextRandom() % 200)
        ),
        kind: matrixEntry[0],
        priority: matrixEntry[1],
        actionLabel: matrixEntry[2],
        resolvedAt: null
      };
      lifecycleState = applyNotificationLiveEvent(lifecycleState, {
        id: `state-created-${step}`,
        kind: "notification.created",
        subjectId: next.id,
        createdAt,
        payload: { notification: next }
      });
      lifecycleExpected.set(groupKey, next);
    } else if (operation <= 4) {
      const readAt = new Date(Date.UTC(2026, 6, 23, 13, 0, 0) + step).toISOString();
      lifecycleState = applyNotificationLiveEvent(lifecycleState, {
        id: `state-read-${step}`,
        kind: "notification.read",
        subjectId: existing.id,
        createdAt: readAt,
        payload: { groupKey }
      });
      lifecycleExpected.set(groupKey, existing.readAt ? existing : { ...existing, readAt });
    } else if (operation <= 6) {
      const resolvedAt = new Date(Date.UTC(2026, 6, 23, 14, 0, 0) + step).toISOString();
      const canonical = {
        ...existing,
        readAt: existing.readAt ?? resolvedAt,
        resolvedAt,
        actionLabel: existing.priority === "action" ? "Open" : null,
        href: existing.priority === "action" ? existing.href : null
      };
      lifecycleState = applyNotificationLiveEvent(lifecycleState, {
        id: `state-resolved-${step}`,
        kind: "notification.resolved",
        subjectId: canonical.id,
        createdAt: resolvedAt,
        payload: { notification: canonical }
      });
      lifecycleExpected.set(groupKey, canonical);
    } else if (operation === 7) {
      lifecycleState = applyNotificationLiveEvent(lifecycleState, {
        id: `state-archived-${step}`,
        kind: "notification.archived",
        subjectId: existing.id,
        createdAt: new Date(Date.UTC(2026, 6, 23, 15, 0, 0) + step).toISOString(),
        payload: { groupKey }
      });
      if (notificationCanArchive(existing)) lifecycleExpected.delete(groupKey);
    } else {
      lifecycleState = applyNotificationLiveEvent(lifecycleState, {
        id: `state-clear-read-${step}`,
        kind: "notification.archived",
        subjectId: "@viewer",
        createdAt: new Date(Date.UTC(2026, 6, 23, 16, 0, 0) + step).toISOString(),
        payload: { clearRead: true }
      });
      for (const [candidateGroupKey, candidate] of lifecycleExpected) {
        if (candidate.readAt && notificationCanArchive(candidate)) {
          lifecycleExpected.delete(candidateGroupKey);
        }
      }
    }
    if (step % 97 === 0) {
      assert.equal(
        lifecycleState.unreadCount,
        [...lifecycleExpected.values()].filter((entry) => !entry.readAt).length,
        `Unread reconciliation at state-machine step ${step}`
      );
      assert.equal(lifecycleState.notifications.length, lifecycleExpected.size);
      const partitioned = partitionNotificationInbox(lifecycleState.notifications, true);
      assert.ok(partitioned.needsAttention.every((entry) => notificationAttentionRank(entry) > 0));
      assert.ok(partitioned.recent.every((entry) => notificationAttentionRank(entry) === 0));
    }
  }
  assert.equal(
    lifecycleState.unreadCount,
    [...lifecycleExpected.values()].filter((entry) => !entry.readAt).length
  );

  const read = applyNotificationLiveEvent(created, {
    id: "event-read",
    kind: "notification.read",
    subjectId: newer.id,
    createdAt: "2026-07-21T10:01:00.000Z"
  });
  assert.equal(read.unreadCount, 1);
  assert.ok(read.notifications.find((entry) => entry.id === newer.id)?.readAt);

  const readAll = applyNotificationLiveEvent(read, {
    id: "event-read-all",
    kind: "notification.read",
    subjectId: "@viewer",
    createdAt: "2026-07-21T10:02:00.000Z",
    payload: { all: true }
  });
  assert.equal(readAll.unreadCount, 0);
  assert.ok(readAll.notifications.every((entry) => entry.readAt));
  assert.equal(
    latestNotificationEventKey([
      { kind: "post.created", subjectId: "post-1" },
      createdEvent,
      { kind: "notification.read", id: "latest", subjectId: newer.id }
    ]),
    "latest"
  );

  assert.equal(notificationListQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(markNotificationInputSchema.safeParse({}).success, false);
  assert.equal(markNotificationInputSchema.safeParse({ all: true }).success, true);
  assert.equal(archiveNotificationInputSchema.safeParse({}).success, false);
  assert.equal(archiveNotificationInputSchema.safeParse({ clearRead: true }).success, true);
  assert.equal(archiveNotificationInputSchema.safeParse({ groupKey: "post:1" }).success, true);
  assert.equal(archiveNotificationInputSchema.safeParse({
    groupKey: "post:1",
    clearRead: true
  }).success, false);

  const repository = readFileSync("apps/api/src/repository/notifications.ts", "utf8");
  const delivery = readFileSync("apps/api/src/services/notificationDelivery.ts", "utf8");
  const panel = readFileSync("features/notifications/NotificationsPanel.tsx", "utf8");
  const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
  const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
  const schema = readFileSync("apps/api/src/db/schema.ts", "utf8");
  const workspaceAccess = readFileSync("apps/api/src/repository/workspaceAccess.ts", "utf8");
  const conversations = readFileSync("apps/api/src/repository/conversations.ts", "utf8");
  const comments = readFileSync("apps/api/src/repository/comments.ts", "utf8");
  const profiles = readFileSync("apps/api/src/repository/profiles.ts", "utf8");
  const communities = readFileSync("apps/api/src/repository/communities.ts", "utf8");
  const communityRequests = readFileSync("apps/api/src/repository/communityRequests.ts", "utf8");
  const opportunityApplications = readFileSync("apps/api/src/repository/opportunityApplications.ts", "utf8");
  const contentNotifications = readFileSync("apps/api/src/services/contentNotifications.ts", "utf8");
  const maintenance = readFileSync("apps/api/src/services/maintenance.ts", "utf8");
  const messageRoutes = readFileSync("apps/api/src/routes/messageRoutes.ts", "utf8");
  const posts = readFileSync("apps/api/src/repository/posts.ts", "utf8");
  const workspaceComments = readFileSync("apps/api/src/repository/workspaceComments.ts", "utf8");
  const notificationProducerSources = [
    workspaceAccess,
    conversations,
    comments,
    profiles,
    communities,
    communityRequests,
    opportunityApplications,
    posts,
    workspaceComments
  ].join("\n");
  const knownKinds = new Set(notificationKindMatrix.map(([kind]) => kind));
  const staticNotificationKinds = [...notificationProducerSources.matchAll(/kind:\s*"([a-z]+(?:_[a-z]+)+)"/g)]
    .map((match) => match[1]!)
    .filter((kind, index, values) => values.indexOf(kind) === index);
  assert.deepEqual(
    staticNotificationKinds.filter((kind) => !knownKinds.has(kind as typeof notificationKindMatrix[number][0])),
    [],
    "Every statically declared notification kind needs an explicit priority and primary action."
  );

  assert.match(delivery, /ON CONFLICT \(profile_handle, dedupe_key\)[\s\S]*?DO NOTHING/);
  assert.match(delivery, /FROM notification_preferences/);
  assert.match(delivery, /notificationAllowedByPreferences/);
  assert.match(delivery, /kind: "notification\.created"/);
  assert.match(delivery, /kind: "notification\.resolved"/);
  assert.match(delivery, /"post_quote"/);
  assert.match(delivery, /"workspace_mention"/);
  assert.match(delivery, /audienceHandles: \[row\.profileHandle\]/);
  assert.match(delivery, /FROM profile_blocks/);
  assert.match(delivery, /jsonb_array_elements/);
  assert.match(delivery, /resolved_at = now\(\)/);
  assert.match(repository, /WITH grouped AS/);
  assert.match(repository, /"attentionRank"/);
  assert.match(repository, /kind = ANY\(\$2::text\[\]\)/);
  assert.match(repository, /count\(\*\) FILTER \(WHERE read_at IS NULL\)/);
  assert.match(repository, /activeGroupKeys/);
  assert.match(repository, /COALESCE\(aggregation_key, 'notification:' \|\| id::text\)/);
  assert.match(repository, /LEFT JOIN page ON true/);
  assert.match(repository, /AND COALESCE\(aggregation_key, 'notification:' \|\| id::text\) = \$2/);
  assert.match(repository, /export const getUnreadNotificationCount/);
  assert.match(repository, /profile_handle = \$1 AND kind <> 'message'/);
  assert.match(repository, /groupKey/);
  assert.match(repository, /export const getNotificationPreferences/);
  assert.match(repository, /export const updateNotificationPreferences/);
  assert.match(repository, /export const archiveNotifications/);
  assert.match(repository, /archived_at IS NULL/);
  assert.match(repository, /Resolve this request before archiving it/);
  assert.match(repository, /kind: "notification\.archived"/);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /kind: "notification\.preferences\.updated"/);
  assert.match(repository, /audienceHandles: \[handle\]/);
  assert.doesNotMatch(workspaceAccess, /INSERT INTO notifications/);
  assert.match(workspaceAccess, /workspace_access_updated/);
  assert.match(conversations, /\.\.\.createdNotifications\.events/);
  assert.match(comments, /kind: "comment_reply"/);
  assert.match(comments, /kind: "post_comment"/);
  assert.match(comments, /reason: "source_comment_deleted"/);
  assert.match(profiles, /kind: "profile_followed"/);
  assert.match(profiles, /reason: "profile_unfollowed"/);
  assert.match(communities, /kind: "community_join_request"/);
  assert.match(communities, /\?requests=pending/);
  assert.match(communities, /reason: "community_request_withdrawn"/);
  assert.match(communityRequests, /community_request_\$\{input\.decision\}/);
  assert.match(opportunityApplications, /kind: "opportunity_application_received"/);
  assert.match(opportunityApplications, /reason: "opportunity_application_reviewed"/);
  assert.match(conversations, /reason: "profile_relationship_blocked"/);
  assert.match(contentNotifications, /contentMentionNotificationInputs/);
  assert.match(contentNotifications, /quoteNotificationInput/);
  assert.match(contentNotifications, /recipientCanRead/);
  assert.match(contentNotifications, /dedupeKey: `mention:/);
  assert.match(contentNotifications, /dedupeKey: `quote:/);
  assert.match(posts, /kind[s]?: \["post_mention"\]/);
  assert.match(posts, /quoteNotificationInput/);
  assert.match(comments, /kind[s]?: \["comment_mention"\]/);
  assert.match(comments, /quoteNotificationInput/);
  assert.match(workspaceComments, /kind[s]?: \["workspace_mention"\]/);
  assert.match(workspaceAccess, /reason: "workspace_access_revoked"/);
  assert.match(communities, /reason: "community_access_removed"/);

  assert.match(panel, /requestEpochRef/);
  assert.match(panel, /retryTimerRef/);
  assert.match(panel, /\/api\/notifications\/unread/);
  assert.match(panel, /window\.addEventListener\("focus", refreshWhenActive\)/);
  assert.match(panel, /window\.addEventListener\("online", refreshWhenActive\)/);
  assert.match(panel, /document\.addEventListener\("visibilitychange", refreshWhenActive\)/);
  assert.match(panel, /applyNotificationLiveEvent/);
  assert.match(panel, /data-unread-state=\{loadState\}/);
  assert.match(panel, /keepalive: true/);
  assert.match(panel, /View all notifications/);
  assert.match(panel, /notification\.actionLabel/);
  assert.match(panel, /partitionNotificationInbox/);
  assert.match(panel, /Notification settings/);
  assert.match(panel, /Important and actionable alerts/);
  assert.match(panel, /role="switch"/);
  assert.match(panel, /notificationPreferencesFromLiveEvent/);
  assert.match(panel, /Clear read notifications/);
  assert.match(panel, /Archive notification/);
  assert.match(panel, /notificationCanArchive/);
  assert.doesNotMatch(panel, /window\.location\.assign/);
  assert.match(shell, /setNotificationEvents\(\(current\) => \[\.\.\.current, event\]\.slice\(-1000\)\)/);
  assert.match(shell, /parseCanonicalRoute\(url\.pathname, url\.search\)/);
  assert.match(shell, /symposium:pending-community-requests/);
  assert.match(shell, /symposium:open-community-requests/);
  assert.match(shell, /syncStatusExpiryMs/);
  assert.match(shell, /dismissTransientSyncStatus\(\)/);
  assert.match(shell, /role="status"/);

  assert.match(migration, /0043_notification_aggregation/);
  assert.match(migration, /0044_notification_preferences/);
  assert.match(migration, /0045_notification_resolution/);
  assert.match(migration, /0046_notification_inbox_hygiene/);
  assert.match(migration, /0048_quote_notification_preference/);
  assert.match(migration, /SET quotes = reshares/);
  assert.match(migration, /kind IN \('post_quote', 'comment_quote'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS archived_at/);
  assert.match(migration, /migrated_source_inactive/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_preferences/);
  assert.match(migration, /notifications_profile_page_idx/);
  assert.match(migration, /notifications_profile_unread_idx/);
  assert.match(schema, /notifications_profile_page_idx/);
  assert.match(schema, /notifications_profile_unread_idx/);
  assert.match(schema, /notifications_profile_aggregation_idx/);
  assert.match(schema, /notifications_profile_open_action_idx/);
  assert.match(schema, /resolvedAt: timestamp\("resolved_at"/);
  assert.match(schema, /archivedAt: timestamp\("archived_at"/);
  assert.match(schema, /notifications_archived_retention_idx/);
  assert.match(schema, /export const notificationPreferences/);
  assert.match(maintenance, /archived_at < now\(\) - interval '30 days'/);
  assert.match(maintenance, /kind IN \('community_join_request', 'opportunity_application_received'\)/);
  assert.match(messageRoutes, /\/v1\/notifications\/archive/);
  assert.match(panel, /key: "reshares",\s+label: "Reshares"/);
  assert.match(panel, /key: "quotes",\s+label: "Quotes"/);
  assert.doesNotMatch(panel, /Reshares & quotes/);
  assert.match(delivery, /quotes,/);
  assert.match(delivery, /quotes: row\.quotes/);

  const app = await buildApp({ logger: false });
  try {
    const page = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { "x-symposium-handle": "@notification-boundary" }
    });
    assert.equal(page.statusCode, 200);
    assert.deepEqual(page.json(), { notifications: [], unreadCount: 0, nextCursor: null });

    const unread = await app.inject({
      method: "GET",
      url: "/v1/notifications/unread",
      headers: { "x-symposium-handle": "@notification-boundary" }
    });
    assert.equal(unread.statusCode, 200);
    assert.deepEqual(unread.json(), { unreadCount: 0 });

    const defaultPreferences = await app.inject({
      method: "GET",
      url: "/v1/notifications/preferences",
      headers: { "x-symposium-handle": "@notification-boundary" }
    });
    assert.equal(defaultPreferences.statusCode, 200);
    assert.deepEqual(
      defaultPreferences.json(),
      defaultNotificationPreferences()
    );

    const updatedPreferences = await app.inject({
      method: "PATCH",
      url: "/v1/notifications/preferences",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: {
        expectedRevision: 1,
        changes: {
          activityEnabled: false,
          likes: false,
          commentsAndReplies: false,
          reshares: false,
          quotes: false,
          newFollowers: false,
          workspaceActivity: false
        }
      }
    });
    assert.equal(updatedPreferences.statusCode, 200);
    const updatedPreferenceBody = notificationPreferencesSchema.parse(updatedPreferences.json());
    assert.equal(updatedPreferenceBody.revision, 2);
    assert.ok(notificationPreferenceKeys.every((key) => !updatedPreferenceBody[key]));

    const invalidPreferences = await app.inject({
      method: "PATCH",
      url: "/v1/notifications/preferences",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: { expectedRevision: 1, changes: {} }
    });
    assert.equal(invalidPreferences.statusCode, 400);

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/v1/notifications?cursor=invalid",
      headers: { "x-symposium-handle": "@notification-boundary" }
    });
    assert.equal(invalidCursor.statusCode, 400);

    const invalidRead = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: {}
    });
    assert.equal(invalidRead.statusCode, 400);

    const markAll = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: { all: true }
    });
    assert.equal(markAll.statusCode, 200);
    assert.deepEqual(markAll.json(), { notificationId: null, all: true, read: true });

    const invalidArchive = await app.inject({
      method: "POST",
      url: "/v1/notifications/archive",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: {}
    });
    assert.equal(invalidArchive.statusCode, 400);

    const clearRead = await app.inject({
      method: "POST",
      url: "/v1/notifications/archive",
      headers: {
        "content-type": "application/json",
        "x-symposium-handle": "@notification-boundary"
      },
      payload: { clearRead: true }
    });
    assert.equal(clearRead.statusCode, 200);
    assert.deepEqual(clearRead.json(), {
      notificationId: null,
      groupKey: null,
      clearRead: true,
      archivedCount: 0
    });
  } finally {
    await app.close();
  }

  console.log("SYMPOSIUM notification delivery checks passed.");
};

void main();
