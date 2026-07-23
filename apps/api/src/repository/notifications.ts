import { TRPCError } from "@trpc/server";
import {
  markNotificationInputSchema,
  notificationListQuerySchema,
  updateNotificationPreferencesInputSchema,
  type NotificationContract,
  type NotificationPageContract,
  type NotificationPreferencesContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { runAtomic } from "../services/transactions";
import {
  actionRequiredNotificationKinds,
  defaultNotificationPreferences,
  groupedNotificationTitle,
  importantNotificationKinds,
  notificationActionLabel,
  notificationActorHandle,
  notificationDestination,
  notificationPriority
} from "../services/notificationAggregation";
import { actorHandle, ensureLiveData } from "./foundation";

type NotificationCursor = { attentionRank: number; createdAt: string; groupKey: string };
type NotificationRow = {
  id: string | null;
  groupKey: string | null;
  groupCount: number | null;
  actorCount: number | null;
  kind: string | null;
  title: string | null;
  body: string | null;
  href: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string | null;
  readAt: Date | string | null;
  resolvedAt: Date | string | null;
  attentionRank: number | null;
};

type NotificationPreferencesRow = {
  activityEnabled: boolean;
  likes: boolean;
  commentsAndReplies: boolean;
  reshares: boolean;
  newFollowers: boolean;
  workspaceActivity: boolean;
  revision: number;
  updatedAt: Date | string;
};

type PresentNotificationRow = Omit<NotificationRow, "id" | "kind" | "title" | "body" | "createdAt"> & {
  id: string;
  groupKey: string;
  groupCount: number;
  actorCount: number;
  kind: string;
  title: string;
  body: string;
  createdAt: Date | string;
};

const encodeCursor = (row: Pick<PresentNotificationRow, "attentionRank" | "createdAt" | "groupKey">) =>
  Buffer.from(JSON.stringify({
    attentionRank: row.attentionRank ?? 0,
    createdAt: new Date(row.createdAt).toISOString(),
    groupKey: row.groupKey
  } satisfies NotificationCursor)).toString("base64url");

const decodeCursor = (cursor?: string | null): NotificationCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<NotificationCursor>;
    if (
      !value.createdAt ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      !value.groupKey ||
      value.groupKey.length > 500
    ) return null;
    const attentionRank = typeof value.attentionRank === "number" && Number.isInteger(value.attentionRank)
      ? Math.max(0, Math.min(2, value.attentionRank))
      : 0;
    return { attentionRank, createdAt: new Date(value.createdAt).toISOString(), groupKey: value.groupKey };
  } catch {
    return null;
  }
};

const projectNotification = (
  row: PresentNotificationRow,
  actorHandles: string[],
  actorNames: string[],
  profileHandle: string
): NotificationContract => {
  const resolvedAt = row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const href = notificationDestination({
    kind: row.kind,
    href: row.href ?? null,
    metadata,
    profileHandle,
    resolvedAt
  });
  return {
    id: row.id,
    groupKey: row.groupKey,
    groupCount: row.groupCount,
    actorHandles,
    priority: notificationPriority(row.kind),
    actionLabel: notificationActionLabel(row.kind, href, resolvedAt),
    kind: row.kind,
    title: groupedNotificationTitle(row, actorNames, row.actorCount),
    body: row.body,
    href,
    readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    resolvedAt,
    createdAt: new Date(row.createdAt).toISOString(),
    metadata
  };
};

const projectNotificationPreferences = (
  row: NotificationPreferencesRow
): NotificationPreferencesContract => ({
  activityEnabled: row.activityEnabled,
  likes: row.likes,
  commentsAndReplies: row.commentsAndReplies,
  reshares: row.reshares,
  newFollowers: row.newFollowers,
  workspaceActivity: row.workspaceActivity,
  revision: row.revision,
  updatedAt: new Date(row.updatedAt).toISOString()
});

const notificationPreferencesSelect = `
  activity_enabled AS "activityEnabled",
  likes,
  comments_and_replies AS "commentsAndReplies",
  reshares,
  new_followers AS "newFollowers",
  workspace_activity AS "workspaceActivity",
  revision,
  updated_at AS "updatedAt"
`;

export const getNotificationPreferences = async (actor: Actor): Promise<NotificationPreferencesContract> => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return defaultNotificationPreferences();
  await ensureLiveData();
  const result = await getPool().query<NotificationPreferencesRow>(
    `SELECT ${notificationPreferencesSelect}
     FROM notification_preferences
     WHERE profile_handle = $1`,
    [handle]
  );
  return result.rows[0]
    ? projectNotificationPreferences(result.rows[0])
    : defaultNotificationPreferences();
};

export const updateNotificationPreferences = async (rawInput: unknown, actor: Actor) => {
  const input = updateNotificationPreferencesInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) {
    return {
      ...defaultNotificationPreferences(),
      ...input.changes,
      revision: input.expectedRevision + 1,
      updatedAt: new Date().toISOString()
    } satisfies NotificationPreferencesContract;
  }
  await ensureLiveData();
  return runAtomic<NotificationPreferencesContract>(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('symposium:notification-preferences:' || $1, 0))",
      [handle]
    );
    const existingResult = await client.query<NotificationPreferencesRow>(
      `SELECT ${notificationPreferencesSelect}
       FROM notification_preferences
       WHERE profile_handle = $1
       FOR UPDATE`,
      [handle]
    );
    const existing = existingResult.rows[0]
      ? projectNotificationPreferences(existingResult.rows[0])
      : defaultNotificationPreferences();
    if (existing.revision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Notification settings changed on another device. Review the latest settings and try again."
      });
    }
    const next = {
      ...existing,
      ...input.changes
    };
    const unchanged = (
      next.activityEnabled === existing.activityEnabled
      && next.likes === existing.likes
      && next.commentsAndReplies === existing.commentsAndReplies
      && next.reshares === existing.reshares
      && next.newFollowers === existing.newFollowers
      && next.workspaceActivity === existing.workspaceActivity
    );
    if (unchanged) return { value: existing };
    const updated = await client.query<NotificationPreferencesRow>(
      `INSERT INTO notification_preferences (
         profile_handle, activity_enabled, likes, comments_and_replies,
         reshares, new_followers, workspace_activity, revision, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 2, now())
       ON CONFLICT (profile_handle) DO UPDATE SET
         activity_enabled = EXCLUDED.activity_enabled,
         likes = EXCLUDED.likes,
         comments_and_replies = EXCLUDED.comments_and_replies,
         reshares = EXCLUDED.reshares,
         new_followers = EXCLUDED.new_followers,
         workspace_activity = EXCLUDED.workspace_activity,
         revision = notification_preferences.revision + 1,
         updated_at = now()
       RETURNING ${notificationPreferencesSelect}`,
      [
        handle,
        next.activityEnabled,
        next.likes,
        next.commentsAndReplies,
        next.reshares,
        next.newFollowers,
        next.workspaceActivity
      ]
    );
    const value = projectNotificationPreferences(updated.rows[0]!);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "notification.preferences.update",
      subjectType: "profile",
      subjectId: handle,
      metadata: { changed: Object.keys(input.changes), revision: value.revision }
    });
    const event = await stageEvent(client, {
      kind: "notification.preferences.updated",
      actorHandle: handle,
      subjectType: "profile",
      subjectId: handle,
      visibility: "private",
      audienceHandles: [handle],
      payload: { preferences: value }
    });
    return { value, events: [event] };
  });
};

export const getUnreadNotificationCount = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { unreadCount: 0 };
  await ensureLiveData();
  const result = await getPool().query<{ unreadCount: number }>(
    `SELECT count(*)::int AS "unreadCount"
     FROM (
       SELECT COALESCE(aggregation_key, 'notification:' || id::text)
       FROM notifications
       WHERE profile_handle = $1 AND kind <> 'message'
       GROUP BY COALESCE(aggregation_key, 'notification:' || id::text)
       HAVING bool_or(read_at IS NULL)
     ) unread_groups`,
    [handle]
  );
  return { unreadCount: result.rows[0]?.unreadCount ?? 0 };
};

export const listNotifications = async (rawQuery: unknown, actor: Actor): Promise<NotificationPageContract> => {
  const handle = actorHandle(actor);
  const query = notificationListQuerySchema.parse(rawQuery ?? {});
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid notification cursor." });
  if (!hasDatabase()) return { notifications: [], unreadCount: 0, nextCursor: null };
  await ensureLiveData();

  const values: unknown[] = [
    handle,
    actionRequiredNotificationKinds,
    importantNotificationKinds
  ];
  const cursorCondition = cursor
    ? `WHERE ("attentionRank", "createdAt", "groupKey") < ($4::int, $5::timestamptz, $6::text)`
    : "";
  if (cursor) values.push(cursor.attentionRank, cursor.createdAt, cursor.groupKey);
  values.push(query.limit + 1);
  const result = await getPool().query<NotificationRow & { unreadTotal: number }>(
    `WITH grouped AS (
       SELECT
         COALESCE(aggregation_key, 'notification:' || id::text) AS "groupKey",
         CASE
           WHEN bool_or(kind = ANY($2::text[]) AND resolved_at IS NULL)
             THEN (count(*) FILTER (
               WHERE kind = ANY($2::text[]) AND resolved_at IS NULL
             ))::int
           WHEN bool_or(read_at IS NULL)
             THEN (count(*) FILTER (WHERE read_at IS NULL))::int
           WHEN bool_or(resolved_at IS NULL)
             THEN (count(*) FILTER (WHERE resolved_at IS NULL))::int
           ELSE count(*)::int
         END AS "groupCount",
         CASE
           WHEN bool_or(kind = ANY($2::text[]) AND resolved_at IS NULL)
             THEN count(DISTINCT CASE
               WHEN kind = ANY($2::text[]) AND resolved_at IS NULL THEN COALESCE(
                 metadata ->> 'actorHandle',
                 metadata ->> 'followerHandle',
                 metadata ->> 'requesterHandle',
                 metadata ->> 'applicantHandle'
               )
             END)::int
           WHEN bool_or(read_at IS NULL)
             THEN count(DISTINCT CASE
               WHEN read_at IS NULL THEN COALESCE(
                 metadata ->> 'actorHandle',
                 metadata ->> 'followerHandle',
                 metadata ->> 'requesterHandle',
                 metadata ->> 'applicantHandle'
               )
             END)::int
           WHEN bool_or(resolved_at IS NULL)
             THEN count(DISTINCT CASE
               WHEN resolved_at IS NULL THEN COALESCE(
                 metadata ->> 'actorHandle',
                 metadata ->> 'followerHandle',
                 metadata ->> 'requesterHandle',
                 metadata ->> 'applicantHandle'
               )
             END)::int
           ELSE count(DISTINCT COALESCE(
               metadata ->> 'actorHandle',
               metadata ->> 'followerHandle',
               metadata ->> 'requesterHandle',
               metadata ->> 'applicantHandle'
           ))::int
         END AS "actorCount",
         COALESCE(
           max(created_at) FILTER (WHERE resolved_at IS NULL),
           max(created_at)
         ) AS "createdAt",
         bool_or(read_at IS NULL) AS unread,
         CASE
           WHEN bool_or(kind = ANY($2::text[]) AND resolved_at IS NULL) THEN 2
           WHEN bool_or(read_at IS NULL AND kind = ANY($3::text[])) THEN 1
           ELSE 0
         END AS "attentionRank",
         CASE WHEN bool_or(read_at IS NULL) THEN NULL ELSE max(read_at) END AS "readAt",
         CASE WHEN bool_or(resolved_at IS NULL) THEN NULL ELSE max(resolved_at) END AS "resolvedAt"
       FROM notifications
       WHERE profile_handle = $1 AND kind <> 'message'
       GROUP BY COALESCE(aggregation_key, 'notification:' || id::text)
     ),
     page AS (
       SELECT *
       FROM grouped
       ${cursorCondition}
       ORDER BY "attentionRank" DESC, "createdAt" DESC, "groupKey" DESC
       LIMIT $${values.length}
     ),
     unread AS (
       SELECT count(*)::int AS total
       FROM grouped
       WHERE unread
     )
     SELECT latest.id::text, page."groupKey", page."groupCount", page."actorCount",
       page."attentionRank", latest.kind,
       latest.title, latest.body, latest.href, page."readAt", page."resolvedAt", latest.metadata,
       page."createdAt", unread.total AS "unreadTotal"
     FROM unread
     LEFT JOIN page ON true
     LEFT JOIN LATERAL (
       SELECT id, kind, title, body, href, metadata
       FROM notifications notification
       WHERE notification.profile_handle = $1
         AND COALESCE(notification.aggregation_key, 'notification:' || notification.id::text) = page."groupKey"
       ORDER BY (notification.resolved_at IS NULL) DESC,
         notification.created_at DESC, notification.id DESC
       LIMIT 1
     ) latest ON true
     ORDER BY page."attentionRank" DESC NULLS LAST,
       page."createdAt" DESC NULLS LAST, page."groupKey" DESC NULLS LAST`,
    values
  );
  const rowsWithNotifications = result.rows.filter(
    (row): row is PresentNotificationRow & { unreadTotal: number } =>
      Boolean(row.id && row.groupKey && row.groupCount && row.kind && row.title && row.body !== null && row.createdAt)
  );
  const hasMore = rowsWithNotifications.length > query.limit;
  const rows = rowsWithNotifications.slice(0, query.limit);
  const groupKeys = rows.map((row) => row.groupKey);
  const activeGroupKeys = rows.filter((row) => !row.resolvedAt).map((row) => row.groupKey);
  const actorRows = groupKeys.length
    ? await getPool().query<{
        groupKey: string;
        metadata: Record<string, unknown> | null;
      }>(
        `WITH ranked AS (
           SELECT
             COALESCE(aggregation_key, 'notification:' || id::text) AS "groupKey",
             metadata,
             row_number() OVER (
               PARTITION BY COALESCE(aggregation_key, 'notification:' || id::text)
               ORDER BY created_at DESC, id DESC
             ) AS position
           FROM notifications
           WHERE profile_handle = $1
             AND kind <> 'message'
             AND COALESCE(aggregation_key, 'notification:' || id::text) = ANY($2::text[])
             AND (
               NOT (COALESCE(aggregation_key, 'notification:' || id::text) = ANY($3::text[]))
               OR resolved_at IS NULL
             )
         )
         SELECT "groupKey", metadata
         FROM ranked
         WHERE position <= 80
         ORDER BY "groupKey", position`,
        [handle, groupKeys, activeGroupKeys]
      )
    : { rows: [] };
  const actorsByGroup = new Map<string, { handles: string[]; names: string[] }>();
  for (const actorRow of actorRows.rows) {
    const metadata = actorRow.metadata ?? {};
    const actor = notificationActorHandle(metadata);
    if (!actor) continue;
    const group = actorsByGroup.get(actorRow.groupKey) ?? { handles: [], names: [] };
    if (group.handles.includes(actor)) continue;
    if (group.handles.length >= 24) continue;
    group.handles.push(actor);
    group.names.push(typeof metadata.actorName === "string" ? metadata.actorName : actor);
    actorsByGroup.set(actorRow.groupKey, group);
  }
  const last = rows.at(-1);
  return {
    notifications: rows.map((row) => {
      const actors = actorsByGroup.get(row.groupKey) ?? { handles: [], names: [] };
      return projectNotification(row, actors.handles, actors.names, handle);
    }),
    unreadCount: result.rows[0]?.unreadTotal ?? 0,
    nextCursor: hasMore && last ? encodeCursor(last) : null
  };
};

export const markNotificationRead = async (rawInput: unknown, actor: Actor) => {
  const input = markNotificationInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { notificationId: input.notificationId ?? null, all: input.all, read: true };
  await ensureLiveData();
  return runAtomic<{
    notificationId: string | null;
    groupKey?: string;
    all: boolean;
    read: boolean;
  }>(async (client) => {
    if (input.all) {
      const updated = await client.query(
        `UPDATE notifications SET read_at = now()
         WHERE profile_handle = $1 AND kind <> 'message' AND read_at IS NULL
         RETURNING id`,
        [handle]
      );
      if (!updated.rowCount) return { value: { notificationId: null, all: true, read: true } };
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "notification.read_all",
        subjectType: "notification",
        subjectId: handle,
        metadata: { count: updated.rowCount }
      });
      const event = await stageEvent(client, {
        kind: "notification.read",
        actorHandle: handle,
        subjectType: "notification",
        subjectId: handle,
        visibility: "private",
        audienceHandles: [handle],
        payload: { all: true }
      });
      return { value: { notificationId: null, all: true, read: true }, events: [event] };
    }

    const requestedGroupKey = input.groupKey ?? `notification:${input.notificationId}`;
    const notification = await client.query<{ id: string; unread: boolean }>(
      `SELECT
         max(id::text) AS id,
         bool_or(read_at IS NULL) AS unread
       FROM notifications
       WHERE profile_handle = $1
         AND kind <> 'message'
         AND COALESCE(aggregation_key, 'notification:' || id::text) = $2
       HAVING count(*) > 0`,
      [handle, requestedGroupKey]
    );
    const existing = notification.rows[0];
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
    const notificationId = input.notificationId ?? existing.id;
    const value = {
      notificationId,
      groupKey: requestedGroupKey,
      all: false,
      read: true
    };
    if (!existing.unread) return { value };
    await client.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE profile_handle = $1
         AND kind <> 'message'
         AND COALESCE(aggregation_key, 'notification:' || id::text) = $2`,
      [handle, requestedGroupKey]
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "notification.read",
      subjectType: "notification",
      subjectId: notificationId
    });
    const event = await stageEvent(client, {
      kind: "notification.read",
      actorHandle: handle,
      subjectType: "notification",
      subjectId: notificationId,
      visibility: "private",
      audienceHandles: [handle],
      payload: { groupKey: requestedGroupKey }
    });
    return { value, events: [event] };
  });
};
