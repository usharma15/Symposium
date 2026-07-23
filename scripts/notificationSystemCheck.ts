import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import {
  markNotificationInputSchema,
  notificationListQuerySchema,
  notificationSchema,
  type NotificationContract
} from "@/packages/contracts/src";
import {
  applyNotificationLiveEvent,
  compactNotificationLimit,
  compactNotificationCount,
  latestNotificationEventKey,
  mergeNotificationPage,
  partitionNotificationInbox
} from "@/features/notifications/notificationState";
import {
  notificationActionLabel,
  notificationPriority
} from "@/apps/api/src/services/notificationAggregation";

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
  metadata: { postId: "post-1" },
  createdAt
});

const main = async () => {
  assert.equal(compactNotificationCount(1), "1");
  assert.equal(compactNotificationCount(99), "99");
  assert.equal(compactNotificationCount(100), "99+");
  assert.equal(notificationPriority("community_join_request"), "action");
  assert.equal(notificationPriority("workspace_access_granted"), "important");
  assert.equal(notificationPriority("post_signal"), "activity");
  assert.equal(notificationActionLabel("community_join_request", "/communities/community-1"), "Review requests");
  assert.equal(notificationActionLabel("post_signal", "/posts/post-1?analytics=likes"), "View likes");
  assert.equal(notificationActionLabel("unknown", null), null);
  const notificationKindMatrix = [
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
    ["post_reshare", "activity", "View reshares"],
    ["post_signal", "activity", "View likes"],
    ["profile_followed", "activity", "View profile"],
    ["workspace_access_granted", "important", "Open workspace"],
    ["workspace_access_revoked", "important", "Open workspace"],
    ["workspace_access_updated", "important", "Open workspace"],
    ["workspace_comment", "activity", "Open comment"],
    ["workspace_comment_reply", "activity", "View reply"],
    ["workspace_comment_signal", "activity", "View likes"]
  ] as const;
  for (const [kind, expectedPriority, expectedAction] of notificationKindMatrix) {
    assert.equal(notificationPriority(kind), expectedPriority, `${kind} priority`);
    assert.equal(notificationActionLabel(kind, "/destination"), expectedAction, `${kind} action`);
  }
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
  const notificationProducerSources = [
    workspaceAccess,
    conversations,
    comments,
    profiles,
    communities,
    communityRequests,
    opportunityApplications,
    readFileSync("apps/api/src/repository/posts.ts", "utf8"),
    readFileSync("apps/api/src/repository/workspaceComments.ts", "utf8")
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
  assert.match(delivery, /kind: "notification\.created"/);
  assert.match(delivery, /audienceHandles: \[row\.profileHandle\]/);
  assert.match(repository, /WITH grouped AS/);
  assert.match(repository, /"attentionRank"/);
  assert.match(repository, /kind = ANY\(\$2::text\[\]\)/);
  assert.match(repository, /count\(\*\) FILTER \(WHERE read_at IS NULL\)/);
  assert.match(repository, /unreadGroupKeys/);
  assert.match(repository, /COALESCE\(aggregation_key, 'notification:' \|\| id::text\)/);
  assert.match(repository, /LEFT JOIN page ON true/);
  assert.match(repository, /AND COALESCE\(aggregation_key, 'notification:' \|\| id::text\) = \$2/);
  assert.match(repository, /export const getUnreadNotificationCount/);
  assert.match(repository, /profile_handle = \$1 AND kind <> 'message'/);
  assert.match(repository, /groupKey/);
  assert.doesNotMatch(workspaceAccess, /INSERT INTO notifications/);
  assert.match(workspaceAccess, /workspace_access_updated/);
  assert.match(conversations, /\.\.\.createdNotifications\.events/);
  assert.match(comments, /kind: "comment_reply"/);
  assert.match(comments, /kind: "post_comment"/);
  assert.match(profiles, /kind: "profile_followed"/);
  assert.match(communities, /kind: "community_join_request"/);
  assert.match(communities, /\?requests=pending/);
  assert.match(opportunityApplications, /kind: "opportunity_application_received"/);

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
  assert.doesNotMatch(panel, /window\.location\.assign/);
  assert.match(shell, /setNotificationEvents\(\(current\) => \[\.\.\.current, event\]\.slice\(-1000\)\)/);
  assert.match(shell, /parseCanonicalRoute\(url\.pathname, url\.search\)/);
  assert.match(shell, /symposium:pending-community-requests/);
  assert.match(shell, /symposium:open-community-requests/);

  assert.match(migration, /0043_notification_aggregation/);
  assert.match(migration, /notifications_profile_page_idx/);
  assert.match(migration, /notifications_profile_unread_idx/);
  assert.match(schema, /notifications_profile_page_idx/);
  assert.match(schema, /notifications_profile_unread_idx/);
  assert.match(schema, /notifications_profile_aggregation_idx/);

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
  } finally {
    await app.close();
  }

  console.log("SYMPOSIUM notification delivery checks passed.");
};

void main();
