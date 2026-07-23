import {
  notificationSchema,
  type NotificationContract
} from "@/packages/contracts/src";

export type NotificationLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  subjectId: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export type NotificationState = {
  notifications: NotificationContract[];
  unreadCount: number;
};

export const compactNotificationLimit = 12;

const eventKey = (event: NotificationLiveEvent) =>
  event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}:${event.createdAt ?? ""}`;

export const latestNotificationEventKey = (events: NotificationLiveEvent[]) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind.startsWith("notification.")) return eventKey(event);
  }
  return null;
};

export const compactNotificationCount = (count: number) => count > 99 ? "99+" : String(count);

export const normalizeNotifications = (notifications: unknown[]) =>
  notifications.flatMap((notification) => {
    const parsed = notificationSchema.safeParse(notification);
    return parsed.success ? [parsed.data] : [];
  });

export const mergeNotificationPage = (
  current: NotificationContract[],
  incoming: NotificationContract[]
) => {
  const byGroup = new Map(current.map((notification) => [notification.groupKey, notification]));
  for (const notification of incoming) byGroup.set(notification.groupKey, notification);
  return [...byGroup.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  );
};

export const partitionNotificationInbox = (
  notifications: NotificationContract[],
  expanded = false,
  limit = compactNotificationLimit
) => {
  const needsAttention = notifications.filter((notification) =>
    !notification.readAt && notification.priority !== "activity"
  );
  const recent = notifications.filter((notification) =>
    notification.readAt || notification.priority === "activity"
  );
  if (expanded) {
    return { needsAttention, recent, hiddenCount: 0 };
  }
  const visibleAttention = needsAttention.slice(0, limit);
  const visibleRecent = recent.slice(0, Math.max(0, limit - visibleAttention.length));
  return {
    needsAttention: visibleAttention,
    recent: visibleRecent,
    hiddenCount: notifications.length - visibleAttention.length - visibleRecent.length
  };
};

export const applyNotificationLiveEvent = (
  state: NotificationState,
  event: NotificationLiveEvent
): NotificationState => {
  if (event.kind === "notification.created") {
    const parsed = notificationSchema.safeParse(event.payload?.notification);
    if (!parsed.success) return state;
    const notification = parsed.data;
    const existing = state.notifications.find((entry) => entry.groupKey === notification.groupKey);
    return {
      notifications: mergeNotificationPage(state.notifications, [notification]),
      unreadCount: notification.readAt || existing?.readAt === null
        ? state.unreadCount
        : state.unreadCount + 1
    };
  }

  if (event.kind !== "notification.read") return state;
  if (event.payload?.all === true) {
    return {
      notifications: state.notifications.map((notification) =>
        notification.readAt
          ? notification
          : { ...notification, readAt: event.createdAt ?? new Date().toISOString() }
      ),
      unreadCount: 0
    };
  }

  const groupKey = typeof event.payload?.groupKey === "string" ? event.payload.groupKey : null;
  const existing = state.notifications.find((notification) =>
    groupKey ? notification.groupKey === groupKey : notification.id === event.subjectId
  );
  return {
    notifications: state.notifications.map((notification) =>
      (groupKey ? notification.groupKey === groupKey : notification.id === event.subjectId) && !notification.readAt
        ? { ...notification, readAt: event.createdAt ?? new Date().toISOString() }
        : notification
    ),
    unreadCount: Math.max(0, state.unreadCount - (existing?.readAt ? 0 : 1))
  };
};
