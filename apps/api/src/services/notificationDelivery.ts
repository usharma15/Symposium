import type { PoolClient } from "pg";
import type { NotificationContract } from "../../../../packages/contracts/src";
import { stageEvent, type StoredLiveEvent } from "./events";

type CreatedNotificationRow = {
  id: string;
  profileHandle: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string;
};

export type CreateNotificationInput = {
  profileHandle: string;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

export type CreatedNotifications = {
  notifications: NotificationContract[];
  events: StoredLiveEvent[];
};

const truncateNotificationText = (value: string, maximum: number) =>
  Array.from(value).slice(0, maximum).join("");

const projectNotification = (row: CreatedNotificationRow): NotificationContract => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  href: row.href ?? null,
  readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
  createdAt: new Date(row.createdAt).toISOString(),
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
});

export const notificationActorName = async (client: PoolClient, handle: string) => {
  const result = await client.query<{ name: string }>(
    "SELECT name FROM profiles WHERE handle = $1",
    [handle]
  );
  return result.rows[0]?.name?.trim() || handle;
};

export const createNotifications = async (
  client: PoolClient,
  inputs: CreateNotificationInput[]
): Promise<CreatedNotifications> => {
  const eligibleInputs = inputs
    .filter((input) => input.kind !== "message")
    .map((input) => ({
      ...input,
      kind: truncateNotificationText(input.kind.trim(), 80),
      title: truncateNotificationText(input.title.trim(), 200),
      body: truncateNotificationText(input.body, 1000),
      href: input.href ? truncateNotificationText(input.href, 500) : input.href
    }))
    .filter((input) => input.kind && input.title);
  if (!eligibleInputs.length) return { notifications: [], events: [] };
  const result = await client.query<CreatedNotificationRow>(
    `INSERT INTO notifications (profile_handle, kind, title, body, href, dedupe_key, metadata)
     SELECT input.profile_handle, input.kind, input.title, input.body, input.href, input.dedupe_key, input.metadata
     FROM jsonb_to_recordset($1::jsonb) AS input(
       profile_handle text, kind text, title text, body text, href text, dedupe_key text, metadata jsonb
     )
     ON CONFLICT (profile_handle, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id::text, profile_handle AS "profileHandle", kind, title, body, href,
       read_at AS "readAt", metadata, created_at AS "createdAt"`,
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
  const notifications = result.rows.map(projectNotification);
  const events: StoredLiveEvent[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index]!;
    const notification = notifications[index]!;
    events.push(await stageEvent(client, {
      kind: "notification.created",
      subjectType: "notification",
      subjectId: notification.id,
      visibility: "private",
      audienceHandles: [row.profileHandle],
      payload: { notification }
    }));
  }
  return { notifications, events };
};

export const createNotification = async (client: PoolClient, input: CreateNotificationInput) =>
  createNotifications(client, [input]);
