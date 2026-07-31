import type {
  NotificationPageContract,
  NotificationPreferencesContract,
  NotificationUnreadCountContract
} from "@/packages/contracts/src";
import {
  symposiumApi,
  type SymposiumApiRequestOptions
} from "@/features/api/symposiumApiClient";
import type {
  NotificationPreferenceChanges
} from "@/features/notifications/notificationPreferences";

type Request = <T>(path: string, options?: SymposiumApiRequestOptions) => Promise<T>;

/**
 * The single browser-side transport authority for Notifications. Presentation,
 * optimistic state, live reconciliation, and recovery consume these domain
 * operations without constructing routes or request bodies themselves.
 */
export const createNotificationGateway = (request: Request) => ({
  list: (actorHandle: string, limit: number, cursor?: string | null) => {
    const parameters = new URLSearchParams({ actorHandle, limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    return request<NotificationPageContract>(
      `/api/notifications?${parameters.toString()}`,
      { cache: "no-store" }
    );
  },

  getUnreadCount: (actorHandle: string) => {
    const parameters = new URLSearchParams({ actorHandle });
    return request<NotificationUnreadCountContract>(
      `/api/notifications/unread?${parameters.toString()}`,
      { cache: "no-store" }
    );
  },

  getPreferences: (actorHandle: string) => {
    const parameters = new URLSearchParams({ actorHandle });
    return request<NotificationPreferencesContract>(
      `/api/notifications/preferences?${parameters.toString()}`,
      { cache: "no-store" }
    );
  },

  updatePreferences: (
    actorHandle: string,
    expectedRevision: number,
    changes: NotificationPreferenceChanges
  ) => request<NotificationPreferencesContract>("/api/notifications/preferences", {
    method: "PATCH",
    body: { actorHandle, expectedRevision, changes }
  }),

  markRead: (
    actorHandle: string,
    notificationId: string,
    groupKey: string
  ) => request<void>("/api/notifications/read", {
    method: "POST",
    keepalive: true,
    body: { actorHandle, notificationId, groupKey }
  }),

  markAllRead: (actorHandle: string) => request<void>("/api/notifications/read", {
    method: "POST",
    body: { actorHandle, all: true }
  }),

  archive: (
    actorHandle: string,
    notificationId: string,
    groupKey: string
  ) => request<void>("/api/notifications/archive", {
    method: "POST",
    body: { actorHandle, notificationId, groupKey }
  }),

  clearRead: (actorHandle: string) => request<void>("/api/notifications/archive", {
    method: "POST",
    body: { actorHandle, clearRead: true }
  })
});

export const notificationGateway = createNotificationGateway(symposiumApi.request);
