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
import { actorHandle, ensureLiveData } from "./foundation";

type NotificationCursor = { createdAt: string; id: string };
type NotificationRow = {
  id: string | null;
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
  kind: string;
  title: string;
  body: string;
  createdAt: Date | string;
};

const encodeCursor = (row: Pick<PresentNotificationRow, "createdAt" | "id">) =>
  Buffer.from(JSON.stringify({
    createdAt: new Date(row.createdAt).toISOString(),
    id: row.id
  } satisfies NotificationCursor)).toString("base64url");

const decodeCursor = (cursor?: string | null): NotificationCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<NotificationCursor>;
    if (
      !value.createdAt ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      !value.id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    ) return null;
    return { createdAt: new Date(value.createdAt).toISOString(), id: value.id };
  } catch {
    return null;
  }
};

const projectNotification = (row: PresentNotificationRow): NotificationContract => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
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
     FROM notifications
     WHERE profile_handle = $1 AND kind <> 'message' AND read_at IS NULL`,
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
    ? `AND (created_at, id) < ($2::timestamptz, $3::uuid)`
    : "";
  if (cursor) values.push(cursor.createdAt, cursor.id);
  values.push(query.limit + 1);
  const result = await getPool().query<NotificationRow & { unreadTotal: number }>(
    `WITH page AS (
       SELECT id, kind, title, body, href, read_at, metadata, created_at
       FROM notifications
       WHERE profile_handle = $1 AND kind <> 'message'
       ${cursorCondition}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length}
     ),
     unread AS (
       SELECT count(*)::int AS total
       FROM notifications
       WHERE profile_handle = $1 AND kind <> 'message' AND read_at IS NULL
     )
     SELECT page.id::text, page.kind, page.title, page.body, page.href,
       page.read_at AS "readAt", page.metadata, page.created_at AS "createdAt",
       unread.total AS "unreadTotal"
     FROM unread
     LEFT JOIN page ON true
     ORDER BY page.created_at DESC NULLS LAST, page.id DESC NULLS LAST`,
    values
  );
  const rowsWithNotifications = result.rows.filter(
    (row): row is PresentNotificationRow & { unreadTotal: number } =>
      Boolean(row.id && row.kind && row.title && row.body !== null && row.createdAt)
  );
  const hasMore = rowsWithNotifications.length > query.limit;
  const rows = rowsWithNotifications.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    notifications: rows.map(projectNotification),
    unreadCount: result.rows[0]?.unreadTotal ?? 0,
    nextCursor: hasMore && last ? encodeCursor(last) : null
  };
};

export const markNotificationRead = async (rawInput: unknown, actor: Actor) => {
  const input = markNotificationInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { notificationId: input.notificationId ?? null, all: input.all, read: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
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

    const notification = await client.query<{ readAt: Date | null }>(
      `SELECT read_at AS "readAt" FROM notifications
       WHERE id = $1 AND profile_handle = $2 AND kind <> 'message'
       FOR UPDATE`,
      [input.notificationId, handle]
    );
    const existing = notification.rows[0];
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
    const value = { notificationId: input.notificationId ?? null, all: false, read: true };
    if (existing.readAt) return { value };
    await client.query(
      "UPDATE notifications SET read_at = now() WHERE id = $1 AND profile_handle = $2",
      [input.notificationId, handle]
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "notification.read",
      subjectType: "notification",
      subjectId: input.notificationId!
    });
    const event = await stageEvent(client, {
      kind: "notification.read",
      actorHandle: handle,
      subjectType: "notification",
      subjectId: input.notificationId!,
      visibility: "private",
      audienceHandles: [handle]
    });
    return { value, events: [event] };
  });
};
