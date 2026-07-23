import {
  notificationPreferencesSchema,
  type NotificationPreferencesContract,
  type UpdateNotificationPreferencesInputContract
} from "@/packages/contracts/src";
import type { NotificationLiveEvent } from "@/features/notifications/notificationState";

export const notificationPreferenceKeys = [
  "activityEnabled",
  "likes",
  "commentsAndReplies",
  "reshares",
  "newFollowers",
  "workspaceActivity"
] as const;

export type NotificationPreferenceKey = typeof notificationPreferenceKeys[number];
export type NotificationPreferenceChanges =
  UpdateNotificationPreferencesInputContract["changes"];

export const notificationPreferenceChanges = (
  canonical: NotificationPreferencesContract,
  desired: NotificationPreferencesContract
) => Object.fromEntries(
  notificationPreferenceKeys.flatMap((key) =>
    canonical[key] === desired[key] ? [] : [[key, desired[key]]]
  )
) as NotificationPreferenceChanges;

export const hasNotificationPreferenceChanges = (
  canonical: NotificationPreferencesContract | null,
  desired: NotificationPreferencesContract | null
) => Boolean(
  canonical
  && desired
  && notificationPreferenceKeys.some((key) => canonical[key] !== desired[key])
);

export const notificationPreferencesFromLiveEvent = (
  event: NotificationLiveEvent
) => {
  if (event.kind !== "notification.preferences.updated") return null;
  const parsed = notificationPreferencesSchema.safeParse(event.payload?.preferences);
  return parsed.success ? parsed.data : null;
};
