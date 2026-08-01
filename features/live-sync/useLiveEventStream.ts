import { useEffect, useRef } from "react";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  consumeLiveEventStream,
  liveEventCursorIsAfter,
  type ServerSentEvent
} from "@/features/live-sync/liveEventTransport";

export type LiveEventEnvelope = {
  cursor?: string;
};

type LiveEventBatch<T> = {
  events?: T[];
  cursor?: string | null;
};

export const liveEventsPath = (basePath: string, cursor: string) =>
  `${basePath}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;

export const useLiveEventStream = <T extends LiveEventEnvelope>({
  authSessionKey,
  backendUrl,
  enabled,
  getAccessToken,
  onConnected,
  onEvent,
  onMalformedEvent,
  onReconnecting,
  pollIntervalMs = 3000
}: {
  authSessionKey?: string | null;
  backendUrl?: string | null;
  enabled: boolean;
  getAccessToken?: () => Promise<string | null>;
  onConnected: () => void;
  onEvent: (event: T) => void;
  onMalformedEvent: () => void;
  onReconnecting: () => void;
  pollIntervalMs?: number;
}) => {
  const callbacksRef = useRef({ onConnected, onEvent, onMalformedEvent, onReconnecting });
  callbacksRef.current = { onConnected, onEvent, onMalformedEvent, onReconnecting };
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const cursorRef = useRef("");
  const cursorScopeKeyRef = useRef(`${authSessionKey ?? ""}::${backendUrl ?? ""}`);

  useEffect(() => {
    if (!enabled) return undefined;

    const cursorScopeKey = `${authSessionKey ?? ""}::${backendUrl ?? ""}`;
    if (cursorScopeKeyRef.current !== cursorScopeKey) cursorRef.current = "";
    cursorScopeKeyRef.current = cursorScopeKey;

    let closed = false;
    let pollTimer: number | null = null;
    let pollController: AbortController | null = null;
    let pollInFlight = false;
    let source: EventSource | null = null;
    let streamController: AbortController | null = null;
    let reconnectTimer: number | null = null;
    const directBackendUrl = backendUrl?.replace(/\/$/, "") ?? null;

    const acceptEvent = (event: T) => {
      if (event.cursor) {
        if (!liveEventCursorIsAfter(event.cursor, cursorRef.current)) return;
        cursorRef.current = event.cursor;
      }
      callbacksRef.current.onEvent(event);
    };

    const fetchEvents = async () => {
      if (document.hidden || pollInFlight) return;
      const controller = new AbortController();
      pollController = controller;
      pollInFlight = true;
      try {
        const token = directBackendUrl ? await getAccessTokenRef.current?.().catch(() => null) : null;
        const data = await symposiumApi.request<LiveEventBatch<T>>(
          liveEventsPath(directBackendUrl ? `${directBackendUrl}/v1/events` : "/api/events", cursorRef.current),
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: controller.signal
          }
        );
        if (closed || controller.signal.aborted) return;
        for (const event of data.events ?? []) acceptEvent(event);
        if (data.cursor && liveEventCursorIsAfter(data.cursor, cursorRef.current)) cursorRef.current = data.cursor;
        callbacksRef.current.onConnected();
      } finally {
        if (pollController === controller) pollController = null;
        pollInFlight = false;
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      void fetchEvents().catch(() => undefined);
      pollTimer = window.setInterval(() => {
        if (!closed) void fetchEvents().catch(() => undefined);
      }, pollIntervalMs);
    };
    const stopPolling = () => {
      if (!pollTimer) return;
      window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const abortPoll = () => {
      pollController?.abort();
      pollController = null;
    };

    const acceptStreamEvent = (message: ServerSentEvent) => {
      if (closed) return;
      if (message.event === "symposium-ready" || message.event === "symposium-heartbeat") {
        stopPolling();
        callbacksRef.current.onConnected();
        return;
      }
      if (message.event !== "symposium-event") return;
      try {
        acceptEvent(JSON.parse(message.data) as T);
      } catch {
        callbacksRef.current.onMalformedEvent();
      }
    };

    const stopStream = () => {
      source?.close();
      source = null;
      streamController?.abort();
      streamController = null;
    };

    const clearReconnect = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connectDirectStream = async () => {
      if (!directBackendUrl || closed || document.hidden || streamController) return;
      const controller = new AbortController();
      streamController = controller;
      let restartAfterAbort = false;
      let watchdogTimer: number | null = null;
      const clearWatchdog = () => {
        if (watchdogTimer === null) return;
        window.clearTimeout(watchdogTimer);
        watchdogTimer = null;
      };
      const armWatchdog = (timeoutMs: number) => {
        clearWatchdog();
        watchdogTimer = window.setTimeout(() => {
          watchdogTimer = null;
          if (closed || controller.signal.aborted) return;
          restartAfterAbort = true;
          callbacksRef.current.onReconnecting();
          controller.abort();
        }, timeoutMs);
      };
      armWatchdog(10_000);
      try {
        const token = await getAccessTokenRef.current?.().catch(() => null);
        await consumeLiveEventStream({
          url: liveEventsPath(`${directBackendUrl}/v1/events/stream`, cursorRef.current),
          token,
          signal: controller.signal,
          onOpen: () => {
            if (closed || controller.signal.aborted) return;
            armWatchdog(22_000);
            stopPolling();
            callbacksRef.current.onConnected();
          },
          onEvent: (message) => {
            armWatchdog(22_000);
            acceptStreamEvent(message);
          }
        });
        if (!closed && !controller.signal.aborted) callbacksRef.current.onReconnecting();
      } catch (error) {
        if (!controller.signal.aborted) {
          callbacksRef.current.onReconnecting();
        }
      } finally {
        clearWatchdog();
        const ownsStream = streamController === controller;
        if (ownsStream) streamController = null;
        if (ownsStream && !closed && !document.hidden && (restartAfterAbort || !controller.signal.aborted)) {
          startPolling();
          clearReconnect();
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            void connectDirectStream();
          }, 750);
        }
      }
    };

    const connectLocalStream = () => {
      if (closed || document.hidden || source || !("EventSource" in window)) return;
      source = new EventSource(liveEventsPath("/api/events/stream", cursorRef.current));
      source.onopen = () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected();
        }
      };
      source.addEventListener("symposium-ready", () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected();
        }
      });
      source.addEventListener("symposium-heartbeat", () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected();
        }
      });
      source.addEventListener("symposium-event", (message) => {
        if (closed) return;
        try {
          acceptEvent(JSON.parse((message as MessageEvent<string>).data) as T);
        } catch {
          callbacksRef.current.onMalformedEvent();
        }
      });
      source.onerror = () => {
        if (!closed) {
          callbacksRef.current.onReconnecting();
          startPolling();
        }
      };
    };

    const connect = () => {
      if (document.hidden) return;
      if (directBackendUrl) void connectDirectStream();
      else {
        startPolling();
        connectLocalStream();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearReconnect();
        stopPolling();
        abortPoll();
        stopStream();
        return;
      }
      connect();
    };
    const handleOnline = () => {
      if (document.hidden) return;
      clearReconnect();
      connect();
      void fetchEvents().catch(() => undefined);
    };
    const handleOffline = () => {
      clearReconnect();
      stopPolling();
      abortPoll();
      stopStream();
      callbacksRef.current.onReconnecting();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearReconnect();
      stopStream();
      stopPolling();
      abortPoll();
    };
  }, [authSessionKey, backendUrl, enabled, pollIntervalMs]);
};
