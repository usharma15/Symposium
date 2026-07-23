import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import {
  markNotificationInputSchema,
  notificationListQuerySchema,
  type NotificationContract
} from "@/packages/contracts/src";
import {
  applyNotificationLiveEvent,
  compactNotificationCount,
  latestNotificationEventKey,
  mergeNotificationPage
} from "@/features/notifications/notificationState";

const notification = (
  id: string,
  createdAt: string,
  readAt: string | null = null
): NotificationContract => ({
  id,
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
  const opportunityApplications = readFileSync("apps/api/src/repository/opportunityApplications.ts", "utf8");

  assert.match(delivery, /ON CONFLICT \(profile_handle, dedupe_key\)[\s\S]*?DO NOTHING/);
  assert.match(delivery, /kind: "notification\.created"/);
  assert.match(delivery, /audienceHandles: \[row\.profileHandle\]/);
  assert.match(repository, /WITH page AS/);
  assert.match(repository, /LEFT JOIN page ON true/);
  assert.match(repository, /AND \(created_at, id\) < \(\$2::timestamptz, \$3::uuid\)/);
  assert.match(repository, /export const getUnreadNotificationCount/);
  assert.match(repository, /profile_handle = \$1 AND kind <> 'message'/);
  assert.match(repository, /profile_handle = \$2 AND kind <> 'message'/);
  assert.doesNotMatch(workspaceAccess, /INSERT INTO notifications/);
  assert.match(workspaceAccess, /workspace_access_updated/);
  assert.match(conversations, /\.\.\.createdNotifications\.events/);
  assert.match(comments, /kind: "comment_reply"/);
  assert.match(comments, /kind: "post_comment"/);
  assert.match(profiles, /kind: "profile_followed"/);
  assert.match(communities, /kind: "community_join_request"/);
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
  assert.doesNotMatch(panel, /window\.location\.assign/);
  assert.match(shell, /setNotificationEvents\(\(current\) => \[\.\.\.current, event\]\.slice\(-1000\)\)/);
  assert.match(shell, /parseCanonicalRoute\(url\.pathname, url\.search\)/);

  assert.match(migration, /0042_notification_delivery_indexes/);
  assert.match(migration, /notifications_profile_page_idx/);
  assert.match(migration, /notifications_profile_unread_idx/);
  assert.match(schema, /notifications_profile_page_idx/);
  assert.match(schema, /notifications_profile_unread_idx/);

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
