"use client";

import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageUnreadCountContract } from "@/packages/contracts/src";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import type { MessagingLiveEvent } from "@/features/messages/messageLiveState";
import {
  compactMessageUnreadCount,
  latestUnreadChangingEventKey
} from "@/features/messages/messageUnreadState";

type UnreadLoadState = "loading" | "loaded" | "error";

const unreadRetryDelayMs = 2_000;

export function MessagesUnreadButton({
  actorHandle,
  expanded,
  liveEvents,
  onOpen
}: {
  actorHandle: string;
  expanded: boolean;
  liveEvents: MessagingLiveEvent[];
  onOpen: () => void;
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadState, setLoadState] = useState<UnreadLoadState>("loading");
  const requestEpochRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const wasExpandedRef = useRef(expanded);
  const latestEventKey = useMemo(() => latestUnreadChangingEventKey(liveEvents), [liveEvents]);

  const loadUnreadCount = useCallback(async () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    const parameters = new URLSearchParams({ actorHandle });
    try {
      const result = await symposiumApi.request<MessageUnreadCountContract>(
        `/api/conversations/unread?${parameters.toString()}`,
        { cache: "no-store" }
      );
      if (requestEpoch !== requestEpochRef.current) return;
      setUnreadCount(result.unreadCount);
      setLoadState("loaded");
    } catch {
      if (requestEpoch !== requestEpochRef.current) return;
      setLoadState("error");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void loadUnreadCount();
      }, unreadRetryDelayMs);
    }
  }, [actorHandle]);

  useEffect(() => {
    setUnreadCount(0);
    setLoadState("loading");
    void loadUnreadCount();
    return () => {
      requestEpochRef.current += 1;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [loadUnreadCount]);

  useEffect(() => {
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void loadUnreadCount();
    };
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [loadUnreadCount]);

  useEffect(() => {
    if (!latestEventKey) return;
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadUnreadCount();
    }, 0);
    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [latestEventKey, loadUnreadCount]);

  useEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (wasExpanded && !expanded) void loadUnreadCount();
  }, [expanded, loadUnreadCount]);

  const title = unreadCount
    ? `Quick messages · ${unreadCount} unread`
    : "Quick messages";

  return (
    <button
      className={`icon-button quick-messages-button ${unreadCount ? "has-unread" : ""}`}
      type="button"
      title={title}
      aria-label={title}
      aria-expanded={expanded}
      data-unread-count={unreadCount}
      data-unread-state={loadState}
      onClick={onOpen}
    >
      <MessageCircle size={18} />
      {unreadCount ? <b aria-hidden="true">{compactMessageUnreadCount(unreadCount)}</b> : null}
    </button>
  );
}
