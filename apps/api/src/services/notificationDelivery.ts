import type { PoolClient } from "pg";
import type { NotificationContract } from "../../../../packages/contracts/src";
import { stageEvent, type StoredLiveEvent } from "./events";
import {
  defaultNotificationPreferences,
  inferNotificationAggregationKey,
  notificationAllowedByPreferences,
  notificationActorHandle,
  notificationPreferenceCategory,
  projectNotificationGroup
} from "./notificationAggregation";

type CreatedNotificationRow = {
  id: string;
  profileHandle: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  aggregationKey: string | null;
  readAt: Date | string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string;
};

type NotificationPreferenceRow = {
  profileHandle: string;
  activityEnabled: boolean;
  likes: boolean;
  commentsAndReplies: boolean;
  reshares: boolean;
  newFollowers: boolean;
  workspaceActivity: boolean;
  revision: number;
  updatedAt: Date | string;
};

export type CreateNotificationInput = {
  profileHandle: string;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  dedupeKey: string;
  aggregationKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreatedNotifications = {
  notifications: NotificationContract[];
  events: StoredLiveEvent[];
};

const truncateNotificationText = (value: string, maximum: number) =>
  Array.from(value).slice(0, maximum).join("");

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
  const normalizedInputs = inputs
    .filter((input) => input.kind !== "message")
    .map((input) => ({
      ...input,
      kind: truncateNotificationText(input.kind.trim(), 80),
      title: truncateNotificationText(input.title.trim(), 200),
      body: truncateNotificationText(input.body, 1000),
      href: input.href ? truncateNotificationText(input.href, 500) : input.href,
      aggregationKey: input.aggregationKey
        ?? inferNotificationAggregationKey(input.kind, input.metadata)
    }))
    .filter((input) => input.kind && input.title);
  const configurableRecipients = [...new Set(normalizedInputs
    .filter((input) => notificationPreferenceCategory(input.kind))
    .map((input) => input.profileHandle))];
  const preferenceRows = configurableRecipients.length
    ? await client.query<NotificationPreferenceRow>(
        `SELECT
           profile_handle AS "profileHandle",
           activity_enabled AS "activityEnabled",
           likes,
           comments_and_replies AS "commentsAndReplies",
           reshares,
           new_followers AS "newFollowers",
           workspace_activity AS "workspaceActivity",
           revision,
           updated_at AS "updatedAt"
         FROM notification_preferences
         WHERE profile_handle = ANY($1::text[])`,
        [configurableRecipients]
      )
    : { rows: [] };
  const preferencesByHandle = new Map(preferenceRows.rows.map((row) => [
    row.profileHandle,
    {
      activityEnabled: row.activityEnabled,
      likes: row.likes,
      commentsAndReplies: row.commentsAndReplies,
      reshares: row.reshares,
      newFollowers: row.newFollowers,
      workspaceActivity: row.workspaceActivity,
      revision: row.revision,
      updatedAt: new Date(row.updatedAt).toISOString()
    }
  ]));
  const preferenceEligibleInputs = normalizedInputs.filter((input) =>
    notificationAllowedByPreferences(
      input.kind,
      preferencesByHandle.get(input.profileHandle) ?? defaultNotificationPreferences()
    )
  );
  const actorHandles = [...new Set(preferenceEligibleInputs
    .map((input) => notificationActorHandle(input.metadata))
    .filter((handle): handle is string => Boolean(handle)))];
  const actorNames = actorHandles.length
    ? await client.query<{ handle: string; name: string }>(
        "SELECT handle, name FROM profiles WHERE handle = ANY($1::text[])",
        [actorHandles]
      )
    : { rows: [] };
  const actorNameByHandle = new Map(actorNames.rows.map((row) => [row.handle, row.name]));
  const eligibleInputs = preferenceEligibleInputs.map((input) => {
    const actorHandle = notificationActorHandle(input.metadata);
    return {
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        ...(actorHandle ? { actorName: actorNameByHandle.get(actorHandle) ?? actorHandle } : {})
      }
    };
  });
  if (!eligibleInputs.length) return { notifications: [], events: [] };
  const result = await client.query<CreatedNotificationRow>(
    `INSERT INTO notifications (profile_handle, kind, title, body, href, dedupe_key, aggregation_key, metadata)
     SELECT input.profile_handle, input.kind, input.title, input.body, input.href,
       input.dedupe_key, input.aggregation_key, input.metadata
     FROM jsonb_to_recordset($1::jsonb) AS input(
       profile_handle text, kind text, title text, body text, href text,
       dedupe_key text, aggregation_key text, metadata jsonb
     )
     ON CONFLICT (profile_handle, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id::text, profile_handle AS "profileHandle", kind, title, body, href,
       aggregation_key AS "aggregationKey", read_at AS "readAt", metadata, created_at AS "createdAt"`,
    [JSON.stringify(eligibleInputs.map((input) => ({
      profile_handle: input.profileHandle,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
      dedupe_key: input.dedupeKey,
      aggregation_key: input.aggregationKey
        ? truncateNotificationText(input.aggregationKey, 500)
        : null,
      metadata: input.metadata ?? {}
    })))]
  );
  const notifications: NotificationContract[] = [];
  const events: StoredLiveEvent[] = [];
  for (const row of result.rows) {
    const groupKey = row.aggregationKey
      ?? inferNotificationAggregationKey(row.kind, row.metadata ?? undefined)
      ?? `notification:${row.id}`;
    const notification = await projectNotificationGroup(client, row.profileHandle, groupKey);
    if (!notification) continue;
    notifications.push(notification);
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
