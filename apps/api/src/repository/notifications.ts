import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
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
type NotificationRow = Omit<NotificationContract, "createdAt" | "readAt"> & {
  createdAt: Date | string;
  readAt: Date | string | null;
};

const encodeCursor = (row: Pick<NotificationRow, "createdAt" | "id">) =>
  Buffer.from(JSON.stringify({
    createdAt: new Date(row.createdAt).toISOString(),
    id: row.id
  } satisfies NotificationCursor)).toString("base64url");

const decodeCursor = (cursor?: string | null): NotificationCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<NotificationCursor>;
    if (!value.createdAt || Number.isNaN(Date.parse(value.createdAt)) || !value.id || value.id.length > 80) return null;
    return { createdAt: new Date(value.createdAt).toISOString(), id: value.id };
  } catch {
    return null;
  }
};

const projectNotification = (row: NotificationRow): NotificationContract => ({
  ...row,
  href: row.href ?? null,
  readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
  createdAt: new Date(row.createdAt).toISOString(),
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
});

type CreateNotificationInput = {
  profileHandle: string;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

export const createNotifications = async (client: PoolClient, inputs: CreateNotificationInput[]) => {
  const eligibleInputs = inputs.filter((input) => input.kind !== "message");
  if (!eligibleInputs.length) return [];
  const result = await client.query<NotificationRow>(
    `INSERT INTO notifications (profile_handle, kind, title, body, href, dedupe_key, metadata)
     SELECT input.profile_handle, input.kind, input.title, input.body, input.href, input.dedupe_key, input.metadata
     FROM jsonb_to_recordset($1::jsonb) AS input(
       profile_handle text, kind text, title text, body text, href text, dedupe_key text, metadata jsonb
     )
     ON CONFLICT (profile_handle, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id::text, kind, title, body, href, read_at AS "readAt", metadata, created_at AS "createdAt"`,
    [JSON.stringify(eligibleInputs.map((input) => ({
      profile_handle: input.profileHandle,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      dedupe_key: input.dedupeKey,
      metadata: input.metadata ?? {}
    })))]
  );
  return result.rows.map(projectNotification);
};

export const createNotification = async (client: PoolClient, input: CreateNotificationInput) =>
  (await createNotifications(client, [input]))[0] ?? null;

export const listNotifications = async (rawQuery: unknown, actor: Actor): Promise<NotificationPageContract> => {
  const handle = actorHandle(actor);
  const query = notificationListQuerySchema.parse(rawQuery ?? {});
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid notification cursor." });
  if (!hasDatabase()) return { notifications: [], unreadCount: 0, nextCursor: null };
  await ensureLiveData();

  const values: unknown[] = [handle];
  const cursorCondition = cursor
    ? `AND (created_at, id::text) < ($2::timestamptz, $3::text)`
    : "";
  if (cursor) values.push(cursor.createdAt, cursor.id);
  values.push(query.limit + 1);
  const result = await getPool().query<NotificationRow>(
    `SELECT id::text, kind, title, body, href, read_at AS "readAt", metadata, created_at AS "createdAt"
     FROM notifications
     WHERE profile_handle = $1
       AND kind <> 'message'
       ${cursorCondition}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length}`,
    values
  );
  const unread = await getPool().query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM notifications
     WHERE profile_handle = $1 AND kind <> 'message' AND read_at IS NULL`,
    [handle]
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    notifications: rows.map(projectNotification),
    unreadCount: unread.rows[0]?.total ?? 0,
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
        `UPDATE notifications SET read_at = now() WHERE profile_handle = $1 AND read_at IS NULL RETURNING id`,
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
       WHERE id = $1 AND profile_handle = $2
       FOR UPDATE`,
      [input.notificationId, handle]
    );
    const existing = notification.rows[0];
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
    const value = { notificationId: input.notificationId ?? null, all: false, read: true };
    if (existing.readAt) return { value };
    await client.query("UPDATE notifications SET read_at = now() WHERE id = $1", [input.notificationId]);
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
