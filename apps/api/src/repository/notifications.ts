import { TRPCError } from "@trpc/server";
import {
  markNotificationInputSchema,
  notificationListQuerySchema,
  type NotificationContract,
  type NotificationPageContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { runAtomic } from "../services/transactions";
import { groupedNotificationTitle, notificationActorHandle } from "../services/notificationAggregation";
import { actorHandle, ensureLiveData } from "./foundation";

type NotificationCursor = { createdAt: string; groupKey: string };
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

const encodeCursor = (row: Pick<PresentNotificationRow, "createdAt" | "groupKey">) =>
  Buffer.from(JSON.stringify({
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
    return { createdAt: new Date(value.createdAt).toISOString(), groupKey: value.groupKey };
  } catch {
    return null;
  }
};

const projectNotification = (
  row: PresentNotificationRow,
  actorHandles: string[],
  actorNames: string[]
): NotificationContract => ({
  id: row.id,
  groupKey: row.groupKey,
  groupCount: row.groupCount,
  actorHandles,
  kind: row.kind,
  title: groupedNotificationTitle(row, actorNames, row.actorCount),
  body: row.body,
  href: row.href ?? null,
  readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
  createdAt: new Date(row.createdAt).toISOString(),
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
});

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

  const values: unknown[] = [handle];
  const cursorCondition = cursor
    ? `WHERE ("createdAt", "groupKey") < ($2::timestamptz, $3::text)`
    : "";
  if (cursor) values.push(cursor.createdAt, cursor.groupKey);
  values.push(query.limit + 1);
  const result = await getPool().query<NotificationRow & { unreadTotal: number }>(
    `WITH grouped AS (
       SELECT
         COALESCE(aggregation_key, 'notification:' || id::text) AS "groupKey",
         count(*)::int AS "groupCount",
         count(DISTINCT COALESCE(
           metadata ->> 'actorHandle',
           metadata ->> 'followerHandle',
           metadata ->> 'requesterHandle',
           metadata ->> 'applicantHandle'
         ))::int AS "actorCount",
         max(created_at) AS "createdAt",
         bool_or(read_at IS NULL) AS unread,
         CASE WHEN bool_or(read_at IS NULL) THEN NULL ELSE max(read_at) END AS "readAt"
       FROM notifications
       WHERE profile_handle = $1 AND kind <> 'message'
       GROUP BY COALESCE(aggregation_key, 'notification:' || id::text)
     ),
     page AS (
       SELECT *
       FROM grouped
       ${cursorCondition}
       ORDER BY "createdAt" DESC, "groupKey" DESC
       LIMIT $${values.length}
     ),
     unread AS (
       SELECT count(*)::int AS total
       FROM grouped
       WHERE unread
     )
     SELECT latest.id::text, page."groupKey", page."groupCount", page."actorCount", latest.kind,
       latest.title, latest.body, latest.href, page."readAt", latest.metadata,
       page."createdAt", unread.total AS "unreadTotal"
     FROM unread
     LEFT JOIN page ON true
     LEFT JOIN LATERAL (
       SELECT id, kind, title, body, href, metadata
       FROM notifications notification
       WHERE notification.profile_handle = $1
         AND COALESCE(notification.aggregation_key, 'notification:' || notification.id::text) = page."groupKey"
       ORDER BY notification.created_at DESC, notification.id DESC
       LIMIT 1
     ) latest ON true
     ORDER BY page."createdAt" DESC NULLS LAST, page."groupKey" DESC NULLS LAST`,
    values
  );
  const rowsWithNotifications = result.rows.filter(
    (row): row is PresentNotificationRow & { unreadTotal: number } =>
      Boolean(row.id && row.groupKey && row.groupCount && row.kind && row.title && row.body !== null && row.createdAt)
  );
  const hasMore = rowsWithNotifications.length > query.limit;
  const rows = rowsWithNotifications.slice(0, query.limit);
  const groupKeys = rows.map((row) => row.groupKey);
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
         )
         SELECT "groupKey", metadata
         FROM ranked
         WHERE position <= 80
         ORDER BY "groupKey", position`,
        [handle, groupKeys]
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
      return projectNotification(row, actors.handles, actors.names);
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
