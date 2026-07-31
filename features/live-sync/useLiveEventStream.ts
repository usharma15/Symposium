import { useEffect, useRef } from "react";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  consumeLiveEventStream,
  liveEventCursorIsAfter,
  type ServerSentEvent
} from "@/features/live-sync/liveEventTransport";
import {
  browserRecoveryCoordinator
} from "@/features/recovery/browserRecoveryCoordinator";
import {
  symposiumRecoveryCanAttempt,
  symposiumRecoveryRetryDelayMs
} from "@/features/recovery/symposiumRecoveryModel";

export type LiveEventEnvelope = {
  cursor?: string;
};

type LiveEventBatch<T> = {
  events?: T[];
  cursor?: string | null;
};

export const liveEventsPath = (basePath: string, cursor: string) =>
  `${basePath}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;

export const liveEventScopeKey = (
  authSessionKey?: string | null,
  backendUrl?: string | null
) => `${authSessionKey ?? ""}::${backendUrl ?? ""}`;

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
  onConnected: (scopeKey: string) => void;
  onEvent: (event: T, scopeKey: string) => void;
  onMalformedEvent: (scopeKey: string) => void;
  onReconnecting: (scopeKey: string) => void;
  pollIntervalMs?: number;
}) => {
  const callbacksRef = useRef({ onConnected, onEvent, onMalformedEvent, onReconnecting });
  callbacksRef.current = { onConnected, onEvent, onMalformedEvent, onReconnecting };
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const cursorRef = useRef("");
  const cursorScopeKeyRef = useRef(liveEventScopeKey(authSessionKey, backendUrl));

  useEffect(() => {
    if (!enabled) return undefined;

    const cursorScopeKey = liveEventScopeKey(authSessionKey, backendUrl);
    if (cursorScopeKeyRef.current !== cursorScopeKey) cursorRef.current = "";
    cursorScopeKeyRef.current = cursorScopeKey;

    let closed = false;
    let pollTimer: number | null = null;
    let pollController: AbortController | null = null;
    let pollInFlight = false;
    let source: EventSource | null = null;
    let streamController: AbortController | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    const directBackendUrl = backendUrl?.replace(/\/$/, "") ?? null;
    const recoveryCanAttempt = () =>
      symposiumRecoveryCanAttempt(
        browserRecoveryCoordinator.getSnapshot()
      );
    const directAccessToken = async () => {
      if (!directBackendUrl) return null;
      try {
        const token = await getAccessTokenRef.current?.() ?? null;
        if (!token) throw new Error("Live authentication token unavailable.");
        return token;
      } catch (error) {
        browserRecoveryCoordinator.reportTransportFailure();
        throw error;
      }
    };

    const acceptEvent = (event: T) => {
      if (event.cursor) {
        if (!liveEventCursorIsAfter(event.cursor, cursorRef.current)) return;
        cursorRef.current = event.cursor;
      }
      callbacksRef.current.onEvent(event, cursorScopeKey);
    };

    const fetchEvents = async () => {
      if (!recoveryCanAttempt() || pollInFlight) return;
      const controller = new AbortController();
      pollController = controller;
      pollInFlight = true;
      try {
        const token = await directAccessToken();
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
        callbacksRef.current.onConnected(cursorScopeKey);
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
        callbacksRef.current.onConnected(cursorScopeKey);
        return;
      }
      if (message.event !== "symposium-event") return;
      try {
        acceptEvent(JSON.parse(message.data) as T);
      } catch {
        callbacksRef.current.onMalformedEvent(cursorScopeKey);
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
      if (
        !directBackendUrl ||
        closed ||
        !recoveryCanAttempt() ||
        streamController
      ) return;
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
          callbacksRef.current.onReconnecting(cursorScopeKey);
          controller.abort();
        }, timeoutMs);
      };
      armWatchdog(10_000);
      try {
        const token = await directAccessToken();
        await consumeLiveEventStream({
          url: liveEventsPath(`${directBackendUrl}/v1/events/stream`, cursorRef.current),
          token,
          signal: controller.signal,
          onOpen: () => {
            if (closed || controller.signal.aborted) return;
            armWatchdog(22_000);
            stopPolling();
            reconnectAttempt = 0;
            browserRecoveryCoordinator.reportTransportSuccess();
            callbacksRef.current.onConnected(cursorScopeKey);
          },
          onEvent: (message) => {
            armWatchdog(22_000);
            reconnectAttempt = 0;
            browserRecoveryCoordinator.reportTransportSuccess();
            acceptStreamEvent(message);
          }
        });
        if (!closed && !controller.signal.aborted) {
          callbacksRef.current.onReconnecting(cursorScopeKey);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          callbacksRef.current.onReconnecting(cursorScopeKey);
        }
      } finally {
        clearWatchdog();
        const ownsStream = streamController === controller;
        if (ownsStream) streamController = null;
        if (
          ownsStream &&
          !closed &&
          recoveryCanAttempt() &&
          (restartAfterAbort || !controller.signal.aborted)
        ) {
          startPolling();
          clearReconnect();
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            void connectDirectStream();
          }, symposiumRecoveryRetryDelayMs(reconnectAttempt, {
            baseMs: 750,
            maximumMs: 30_000
          }));
          reconnectAttempt += 1;
        }
      }
    };

    const connectLocalStream = () => {
      if (
        closed ||
        !recoveryCanAttempt() ||
        source ||
        !("EventSource" in window)
      ) return;
      source = new EventSource(liveEventsPath("/api/events/stream", cursorRef.current));
      source.onopen = () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected(cursorScopeKey);
        }
      };
      source.addEventListener("symposium-ready", () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected(cursorScopeKey);
        }
      });
      source.addEventListener("symposium-heartbeat", () => {
        if (!closed) {
          stopPolling();
          callbacksRef.current.onConnected(cursorScopeKey);
        }
      });
      source.addEventListener("symposium-event", (message) => {
        if (closed) return;
        try {
          acceptEvent(JSON.parse((message as MessageEvent<string>).data) as T);
        } catch {
          callbacksRef.current.onMalformedEvent(cursorScopeKey);
        }
      });
      source.onerror = () => {
        if (!closed) {
          callbacksRef.current.onReconnecting(cursorScopeKey);
          startPolling();
        }
      };
    };

    const connect = () => {
      if (!recoveryCanAttempt()) return;
      if (directBackendUrl) void connectDirectStream();
      else {
        startPolling();
        connectLocalStream();
      }
    };

    const unsubscribeRecovery = browserRecoveryCoordinator.subscribe(
      (next, previous) => {
        const nextCanAttempt = symposiumRecoveryCanAttempt(next);
        const previousCanAttempt = symposiumRecoveryCanAttempt(previous);
        if (!nextCanAttempt) {
          clearReconnect();
          stopPolling();
          abortPoll();
          stopStream();
          if (previous.online && !next.online) {
            callbacksRef.current.onReconnecting(cursorScopeKey);
          }
          return;
        }
        if (
          !previousCanAttempt ||
          next.resumeEpoch !== previous.resumeEpoch
        ) {
          reconnectAttempt = 0;
          clearReconnect();
          connect();
          if (
            (!previous.online && next.online) ||
            next.lastCause === "transport"
          ) {
            void fetchEvents().catch(() => undefined);
          }
        }
      }
    );
    if (recoveryCanAttempt()) {
      connect();
    } else {
      const recovery = browserRecoveryCoordinator.getSnapshot();
      if (!recovery.online) {
        callbacksRef.current.onReconnecting(cursorScopeKey);
      }
    }

    return () => {
      closed = true;
      unsubscribeRecovery();
      clearReconnect();
      stopStream();
      stopPolling();
      abortPoll();
    };
  }, [authSessionKey, backendUrl, enabled, pollIntervalMs]);
};
