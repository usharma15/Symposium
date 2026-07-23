"use client";

import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Settings2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NotificationContract,
  NotificationPageContract,
  NotificationPreferencesContract,
  NotificationUnreadCountContract
} from "@/packages/contracts/src";
import { notificationPreferencesSchema } from "@/packages/contracts/src";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  applyNotificationLiveEvent,
  compactNotificationCount,
  latestNotificationEventKey,
  mergeNotificationPage,
  normalizeNotifications,
  partitionNotificationInbox,
  type NotificationLiveEvent,
  type NotificationState
} from "@/features/notifications/notificationState";
import {
  notificationPreferencesFromLiveEvent,
  type NotificationPreferenceKey
} from "@/features/notifications/notificationPreferences";

type NotificationLoadState = "loading" | "loaded" | "error";

const retryDelayMs = 2_000;
const maximumRetryDelayMs = 30_000;

const activityPreferenceRows: {
  key: Exclude<NotificationPreferenceKey, "activityEnabled">;
  label: string;
  detail: string;
}[] = [
  { key: "likes", label: "Likes", detail: "Likes on your posts and comments." },
  {
    key: "commentsAndReplies",
    label: "Comments and replies",
    detail: "New discussion on your posts and replies to your comments."
  },
  { key: "reshares", label: "Reshares", detail: "Reshares of your posts and comments." },
  { key: "newFollowers", label: "New followers", detail: "People who begin following you." },
  {
    key: "workspaceActivity",
    label: "Workspace discussion",
    detail: "Comments, replies and likes on your shared drafts."
  }
];

const displayNotificationTime = (value: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};

const liveEventKey = (event: NotificationLiveEvent) =>
  event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}:${event.createdAt ?? ""}`;

export function NotificationsControl({
  actorHandle,
  liveEvents,
  onOpenConversation,
  onNavigate
}: {
  actorHandle: string;
  liveEvents: NotificationLiveEvent[];
  onOpenConversation: (conversationId: string) => void;
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationState>({ notifications: [], unreadCount: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<NotificationLoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferencesContract | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesStatus, setPreferencesStatus] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const requestEpochRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const preferencesRequestEpochRef = useRef(0);
  const pendingReadGroupsRef = useRef(new Set<string>());
  const processedEventKeysRef = useRef(new Set<string>());
  const latestEventKey = useMemo(() => latestNotificationEventKey(liveEvents), [liveEvents]);

  const clearRetry = () => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  const loadPreferences = useCallback(async () => {
    const requestEpoch = preferencesRequestEpochRef.current + 1;
    preferencesRequestEpochRef.current = requestEpoch;
    setPreferencesLoading(true);
    setPreferencesStatus("");
    try {
      const parameters = new URLSearchParams({ actorHandle });
      const response = await symposiumApi.request<NotificationPreferencesContract>(
        `/api/notifications/preferences?${parameters}`,
        { cache: "no-store" }
      );
      const next = notificationPreferencesSchema.parse(response);
      if (requestEpoch !== preferencesRequestEpochRef.current) return;
      setPreferences(next);
    } catch {
      if (requestEpoch !== preferencesRequestEpochRef.current) return;
      setPreferencesStatus("Notification settings could not load.");
    } finally {
      if (requestEpoch === preferencesRequestEpochRef.current) setPreferencesLoading(false);
    }
  }, [actorHandle]);

  const updatePreference = async (key: NotificationPreferenceKey, value: boolean) => {
    if (!preferences || preferencesSaving || preferences[key] === value) return;
    const previous = preferences;
    const optimistic = { ...previous, [key]: value };
    setPreferences(optimistic);
    setPreferencesSaving(true);
    setPreferencesStatus("Saving…");
    try {
      const response = await symposiumApi.request<NotificationPreferencesContract>(
        "/api/notifications/preferences",
        {
          method: "PATCH",
          body: {
            actorHandle,
            expectedRevision: previous.revision,
            changes: { [key]: value }
          }
        }
      );
      const canonical = notificationPreferencesSchema.parse(response);
      setPreferences(canonical);
      setPreferencesStatus("Saved");
    } catch {
      setPreferences(previous);
      setPreferencesStatus("Settings changed elsewhere or could not save. Reloading…");
      await loadPreferences();
    } finally {
      setPreferencesSaving(false);
    }
  };

  const load = useCallback(async (append = false) => {
    const cursor = append ? nextCursorRef.current : null;
    if (append && !cursor) return;
    clearRetry();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    if (append) setLoadingMore(true);
    else setLoadState((current) => current === "loaded" ? current : "loading");
    try {
      const parameters = new URLSearchParams({ actorHandle, limit: "50" });
      if (cursor) parameters.set("cursor", cursor);
      const page = await symposiumApi.request<NotificationPageContract>(
        `/api/notifications?${parameters}`,
        { cache: "no-store" }
      );
      if (requestEpoch !== requestEpochRef.current) return;
      setState((current) => ({
        notifications: append
          ? mergeNotificationPage(current.notifications, normalizeNotifications(page.notifications))
          : normalizeNotifications(page.notifications),
        unreadCount: page.unreadCount
      }));
      nextCursorRef.current = page.nextCursor;
      setNextCursor(page.nextCursor);
      setLoadState("loaded");
      retryAttemptRef.current = 0;
    } catch {
      if (requestEpoch !== requestEpochRef.current) return;
      setLoadState("error");
      if (!append && document.visibilityState === "visible" && navigator.onLine) {
        const delay = Math.min(
          retryDelayMs * 2 ** retryAttemptRef.current,
          maximumRetryDelayMs
        );
        retryAttemptRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void load(false);
        }, delay);
      }
    } finally {
      if (requestEpoch === requestEpochRef.current) setLoadingMore(false);
    }
  }, [actorHandle]);

  const loadUnreadCount = useCallback(async () => {
    clearRetry();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    setLoadState((current) => current === "loaded" ? current : "loading");
    try {
      const parameters = new URLSearchParams({ actorHandle });
      const result = await symposiumApi.request<NotificationUnreadCountContract>(
        `/api/notifications/unread?${parameters}`,
        { cache: "no-store" }
      );
      if (requestEpoch !== requestEpochRef.current) return;
      setState((current) => ({ ...current, unreadCount: result.unreadCount }));
      setLoadState("loaded");
      retryAttemptRef.current = 0;
    } catch {
      if (requestEpoch !== requestEpochRef.current) return;
      setLoadState("error");
      if (document.visibilityState === "visible" && navigator.onLine) {
        const delay = Math.min(
          retryDelayMs * 2 ** retryAttemptRef.current,
          maximumRetryDelayMs
        );
        retryAttemptRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void loadUnreadCount();
        }, delay);
      }
    }
  }, [actorHandle]);

  const refresh = useCallback(() =>
    openRef.current ? load(false) : loadUnreadCount(),
  [load, loadUnreadCount]);

  useEffect(() => {
    requestEpochRef.current += 1;
    preferencesRequestEpochRef.current += 1;
    clearRetry();
    nextCursorRef.current = null;
    retryAttemptRef.current = 0;
    pendingReadGroupsRef.current.clear();
    processedEventKeysRef.current = new Set(
      liveEvents.filter((event) => event.kind.startsWith("notification.")).map(liveEventKey)
    );
    setState({ notifications: [], unreadCount: 0 });
    setNextCursor(null);
    setLoadState("loading");
    setLoadingMore(false);
    setMarkingAll(false);
    setExpanded(false);
    setSettingsOpen(false);
    setPreferences(null);
    setPreferencesLoading(false);
    setPreferencesSaving(false);
    setPreferencesStatus("");
    openRef.current = false;
    setOpen(false);
    void loadUnreadCount();
    return () => {
      requestEpochRef.current += 1;
      clearRetry();
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [actorHandle, loadUnreadCount]); // live event history is intentionally excluded from actor reset

  useEffect(() => {
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (!latestEventKey) return;
    const unseen = liveEvents.filter((event) => {
      if (!event.kind.startsWith("notification.")) return false;
      const key = liveEventKey(event);
      if (processedEventKeysRef.current.has(key)) return false;
      processedEventKeysRef.current.add(key);
      return true;
    });
    if (!unseen.length) return;
    setState((current) => unseen.reduce(applyNotificationLiveEvent, current));
    const livePreferences = unseen
      .map(notificationPreferencesFromLiveEvent)
      .filter((value): value is NotificationPreferencesContract => Boolean(value))
      .at(-1);
    if (livePreferences) {
      setPreferences((current) =>
        !current || livePreferences.revision >= current.revision ? livePreferences : current
      );
      setPreferencesStatus("Settings synced");
    }
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 0);
  }, [latestEventKey, liveEvents, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        openRef.current = false;
        setOpen(false);
        setExpanded(false);
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        openRef.current = false;
        setOpen(false);
        setExpanded(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const followNotification = (notification: NotificationContract) => {
    const conversationId = typeof notification.metadata.conversationId === "string"
      ? notification.metadata.conversationId
      : null;
    if (conversationId) {
      openRef.current = false;
      setOpen(false);
      setExpanded(false);
      setSettingsOpen(false);
      onOpenConversation(conversationId);
      return true;
    }
    if (notification.href) {
      openRef.current = false;
      setOpen(false);
      setExpanded(false);
      setSettingsOpen(false);
      onNavigate(notification.href);
      return true;
    }
    return false;
  };

  const markRead = (notification: NotificationContract) => {
    if (!notification.readAt && !pendingReadGroupsRef.current.has(notification.groupKey)) {
      pendingReadGroupsRef.current.add(notification.groupKey);
      setState((current) => ({
        notifications: current.notifications.map((entry) =>
          entry.groupKey === notification.groupKey ? { ...entry, readAt: new Date().toISOString() } : entry
        ),
        unreadCount: Math.max(0, current.unreadCount - 1)
      }));
      void symposiumApi.request("/api/notifications/read", {
        method: "POST",
        keepalive: true,
        body: {
          actorHandle,
          notificationId: notification.id,
          groupKey: notification.groupKey
        }
      }).catch(() => void refresh()).finally(() => {
        pendingReadGroupsRef.current.delete(notification.groupKey);
      });
    }
    followNotification(notification);
  };

  const markAllRead = async () => {
    if (markingAll || !state.unreadCount) return;
    setMarkingAll(true);
    setState((current) => ({
      notifications: current.notifications.map((entry) =>
        entry.readAt ? entry : { ...entry, readAt: new Date().toISOString() }
      ),
      unreadCount: 0
    }));
    try {
      await symposiumApi.request("/api/notifications/read", {
        method: "POST",
        body: { actorHandle, all: true }
      });
    } catch {
      await refresh();
    } finally {
      setMarkingAll(false);
    }
  };

  const title = loadState === "error"
    ? "Notifications · reconnecting"
    : state.unreadCount
      ? `Notifications · ${state.unreadCount} unread`
      : "Notifications";
  const { needsAttention, recent, hiddenCount } = partitionNotificationInbox(
    state.notifications,
    expanded
  );
  const panelLabel = settingsOpen
    ? "Notification settings"
    : expanded
      ? "All notifications"
      : "Notifications";
  const notificationButton = (notification: NotificationContract) => (
    <button
      type="button"
      key={notification.groupKey}
      className={notification.readAt ? "" : "unread"}
      data-priority={notification.priority}
      onClick={() => markRead(notification)}
    >
      <span className="notification-marker" />
      <span>
        <strong>{notification.title}</strong>
        <p>{notification.body}</p>
        <span className="notification-card-meta">
          {notification.groupCount > 1 ? (
            <small className="notification-group-count">
              {notification.groupCount} updates
            </small>
          ) : null}
          <time dateTime={notification.createdAt} title={new Date(notification.createdAt).toLocaleString()}>
            {displayNotificationTime(notification.createdAt)}
          </time>
        </span>
        {notification.actionLabel ? (
          <span className="notification-primary-action">
            {notification.actionLabel}
            <ChevronRight size={13} />
          </span>
        ) : !notification.readAt ? (
          <span className="notification-primary-action">Mark read</span>
        ) : null}
      </span>
    </button>
  );

  return (
    <div className="notifications-control" ref={panelRef}>
      <button
        className={`icon-button notifications-button ${state.unreadCount ? "has-unread" : ""}`}
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        data-unread-count={state.unreadCount}
        data-unread-state={loadState}
        onClick={() => {
          const nextOpen = !openRef.current;
          openRef.current = nextOpen;
          setOpen(nextOpen);
          if (nextOpen) void load(false);
          else {
            setExpanded(false);
            setSettingsOpen(false);
          }
        }}
      >
        <Bell size={18} />
        {state.unreadCount
          ? <b aria-hidden="true">{compactNotificationCount(state.unreadCount)}</b>
          : null}
      </button>
      {open ? (
        <section
          className={`notifications-panel ${expanded || settingsOpen ? "expanded" : "compact"}`}
          aria-label={panelLabel}
        >
          <header>
            <span>
              {expanded || settingsOpen ? (
                <button
                  type="button"
                  title="Back to notifications"
                  aria-label="Back to notifications"
                  onClick={() => {
                    setExpanded(false);
                    setSettingsOpen(false);
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
              ) : <Bell size={17} />}
              <strong>{panelLabel}</strong>
            </span>
            <span>
              {!settingsOpen ? (
                <button
                  type="button"
                  title="Notification settings"
                  aria-label="Notification settings"
                  onClick={() => {
                    setExpanded(false);
                    setSettingsOpen(true);
                    void loadPreferences();
                  }}
                >
                  <Settings2 size={16} />
                </button>
              ) : null}
              {!settingsOpen && state.unreadCount ? (
                <button
                  type="button"
                  title="Mark all read"
                  aria-label="Mark all notifications read"
                  disabled={markingAll}
                  onClick={() => void markAllRead()}
                >
                  {markingAll ? <LoaderCircle className="spin" size={16} /> : <CheckCheck size={16} />}
                </button>
              ) : null}
              <button
                type="button"
                title="Close"
                aria-label="Close notifications"
                onClick={() => {
                  openRef.current = false;
                  setOpen(false);
                  setExpanded(false);
                  setSettingsOpen(false);
                }}
              >
                <X size={16} />
              </button>
            </span>
          </header>
          {settingsOpen ? (
            <div
              className="notification-preferences"
              aria-busy={preferencesLoading || preferencesSaving}
            >
              {preferencesLoading && !preferences
                ? <LoaderCircle className="spin notifications-loader" size={18} />
                : null}
              {!preferencesLoading && !preferences ? (
                <button
                  className="notifications-retry"
                  type="button"
                  onClick={() => void loadPreferences()}
                >
                  <RefreshCw size={14} />
                  <span>Reload notification settings</span>
                </button>
              ) : null}
              {preferences ? (
                <>
                  <p className="notification-preferences-intro">
                    Choose which new activity reaches your inbox. Existing notifications stay in your history.
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preferences.activityEnabled}
                    className="notification-preference-row primary"
                    disabled={preferencesSaving}
                    onClick={() => void updatePreference("activityEnabled", !preferences.activityEnabled)}
                  >
                    <span>
                      <strong>Activity notifications</strong>
                      <small>Pause or resume every optional activity category below.</small>
                    </span>
                    <span className="notification-preference-switch" aria-hidden="true"><i /></span>
                  </button>
                  <h3 className="notifications-section-label">Activity</h3>
                  {activityPreferenceRows.map((row) => (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences[row.key]}
                      className="notification-preference-row"
                      disabled={preferencesSaving}
                      key={row.key}
                      onClick={() => void updatePreference(row.key, !preferences[row.key])}
                    >
                      <span>
                        <strong>{row.label}</strong>
                        <small>{row.detail}</small>
                      </span>
                      <span className="notification-preference-switch" aria-hidden="true"><i /></span>
                    </button>
                  ))}
                  {!preferences.activityEnabled ? (
                    <p className="notification-preferences-paused">
                      Optional activity is paused. Your category choices are preserved.
                    </p>
                  ) : null}
                  <h3 className="notifications-section-label">Always on</h3>
                  <div className="notification-preferences-required">
                    <LockKeyhole size={16} />
                    <span>
                      <strong>Important and actionable alerts</strong>
                      <small>
                        Access changes, membership decisions, applications and moderation-related requests
                        always reach you.
                      </small>
                    </span>
                  </div>
                  <p className="notification-preferences-status" role="status" aria-live="polite">
                    {preferencesSaving ? "Saving…" : preferencesStatus}
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <div
              className="notifications-list"
              aria-busy={loadState === "loading" || loadingMore}
              aria-live="polite"
            >
              {needsAttention.length ? (
                <>
                  <h3 className="notifications-section-label">Needs your attention</h3>
                  {needsAttention.map(notificationButton)}
                </>
              ) : null}
              {recent.length ? (
                <>
                  <h3 className="notifications-section-label">Recent activity</h3>
                  {recent.map(notificationButton)}
                </>
              ) : null}
              {loadState === "loaded" && !state.notifications.length
                ? <p className="notifications-empty">You are all caught up.</p>
                : null}
              {loadState === "loading" && !state.notifications.length
                ? <LoaderCircle className="spin notifications-loader" size={18} />
                : null}
              {loadState === "error" ? (
                <button className="notifications-retry" type="button" onClick={() => void refresh()}>
                  <RefreshCw size={14} />
                  <span>Reconnect notifications</span>
                </button>
              ) : null}
              {expanded && nextCursor ? (
                <button
                  className="notifications-more"
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(true)}
                >
                  {loadingMore ? "Loading…" : "Load older notifications"}
                </button>
              ) : null}
              {!expanded && (hiddenCount > 0 || nextCursor) ? (
                <button
                  className="notifications-more"
                  type="button"
                  onClick={() => setExpanded(true)}
                >
                  View all notifications
                  {hiddenCount > 0 ? ` · ${hiddenCount}${nextCursor ? "+" : ""} more` : ""}
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
