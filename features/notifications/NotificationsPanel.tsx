"use client";

import { Bell, CheckCheck, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NotificationContract,
  NotificationPageContract,
  NotificationUnreadCountContract
} from "@/packages/contracts/src";
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

type NotificationLoadState = "loading" | "loaded" | "error";

const retryDelayMs = 2_000;
const maximumRetryDelayMs = 30_000;

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const requestEpochRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const pendingReadGroupsRef = useRef(new Set<string>());
  const processedEventKeysRef = useRef(new Set<string>());
  const latestEventKey = useMemo(() => latestNotificationEventKey(liveEvents), [liveEvents]);

  const clearRetry = () => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
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
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        openRef.current = false;
        setOpen(false);
        setExpanded(false);
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
      onOpenConversation(conversationId);
      return true;
    }
    if (notification.href) {
      openRef.current = false;
      setOpen(false);
      setExpanded(false);
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
          else setExpanded(false);
        }}
      >
        <Bell size={18} />
        {state.unreadCount
          ? <b aria-hidden="true">{compactNotificationCount(state.unreadCount)}</b>
          : null}
      </button>
      {open ? (
        <section
          className={`notifications-panel ${expanded ? "expanded" : "compact"}`}
          aria-label={expanded ? "All notifications" : "Notifications"}
        >
          <header>
            <span>
              {expanded ? (
                <button
                  type="button"
                  title="Back to compact notifications"
                  aria-label="Back to compact notifications"
                  onClick={() => setExpanded(false)}
                >
                  <ChevronLeft size={16} />
                </button>
              ) : <Bell size={17} />}
              <strong>{expanded ? "All notifications" : "Notifications"}</strong>
            </span>
            <span>
              {state.unreadCount ? (
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
                }}
              >
                <X size={16} />
              </button>
            </span>
          </header>
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
        </section>
      ) : null}
    </div>
  );
}
