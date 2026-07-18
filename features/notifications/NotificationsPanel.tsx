"use client";

import { Bell, CheckCheck, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationContract, NotificationPageContract } from "@/packages/contracts/src";
import { symposiumApi } from "@/features/api/symposiumApiClient";

const displayNotificationTime = (value: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};

export function NotificationsControl({
  actorHandle,
  liveRevision = 0,
  onOpenConversation
}: {
  actorHandle: string;
  liveRevision?: number;
  onOpenConversation: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationContract[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const parameters = new URLSearchParams({ actorHandle, limit: "30" });
      if (append && nextCursor) parameters.set("cursor", nextCursor);
      const page = await symposiumApi.request<NotificationPageContract>(`/api/notifications?${parameters}`, { cache: "no-store" });
      setNotifications((current) => append
        ? [...current, ...page.notifications.filter((entry) => !current.some((existing) => existing.id === entry.id))]
        : page.notifications);
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
    } catch {
      // The global live status already reports service availability. Keep this
      // compact control quiet instead of stacking another persistent error.
    } finally {
      setLoading(false);
    }
  }, [actorHandle, nextCursor]);

  useEffect(() => {
    void load(false);
  }, [actorHandle, liveRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const markRead = async (notification: NotificationContract) => {
    if (!notification.readAt) {
      setNotifications((current) => current.map((entry) => entry.id === notification.id ? { ...entry, readAt: new Date().toISOString() } : entry));
      setUnreadCount((count) => Math.max(0, count - 1));
      void symposiumApi.request("/api/notifications/read", {
        method: "POST",
        body: { actorHandle, notificationId: notification.id }
      }).catch(() => void load(false));
    }
    const conversationId = typeof notification.metadata.conversationId === "string"
      ? notification.metadata.conversationId
      : null;
    if (conversationId) {
      setOpen(false);
      onOpenConversation(conversationId);
      return;
    }
    if (notification.href) window.location.assign(notification.href);
  };

  const markAllRead = async () => {
    setNotifications((current) => current.map((entry) => entry.readAt ? entry : { ...entry, readAt: new Date().toISOString() }));
    setUnreadCount(0);
    await symposiumApi.request("/api/notifications/read", { method: "POST", body: { actorHandle, all: true } }).catch(() => void load(false));
  };

  return (
    <div className="notifications-control" ref={panelRef}>
      <button
        className={`icon-button notifications-button ${unreadCount ? "has-unread" : ""}`}
        type="button"
        title="Notifications"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load(false);
        }}
      >
        <Bell size={18} />
        {unreadCount ? <b>{Math.min(unreadCount, 99)}</b> : null}
      </button>
      {open ? (
        <section className="notifications-panel" aria-label="Notifications">
          <header>
            <span><Bell size={17} /><strong>Notifications</strong></span>
            <span>
              {unreadCount ? <button type="button" title="Mark all read" onClick={() => void markAllRead()}><CheckCheck size={16} /></button> : null}
              <button type="button" title="Close" onClick={() => setOpen(false)}><X size={16} /></button>
            </span>
          </header>
          <div className="notifications-list">
            {notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={notification.readAt ? "" : "unread"}
                onClick={() => void markRead(notification)}
              >
                <span className="notification-marker" />
                <span><strong>{notification.title}</strong><p>{notification.body}</p><small>{displayNotificationTime(notification.createdAt)}</small></span>
              </button>
            ))}
            {!loading && !notifications.length ? <p className="notifications-empty">You are all caught up.</p> : null}
            {loading ? <LoaderCircle className="spin notifications-loader" size={18} /> : null}
            {nextCursor ? <button className="notifications-more" type="button" disabled={loading} onClick={() => void load(true)}>Load older notifications</button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
