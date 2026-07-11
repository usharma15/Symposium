import { useEffect, useRef } from "react";
import { symposiumApi } from "@/features/api/symposiumApiClient";

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
  enabled,
  onConnected,
  onEvent,
  onMalformedEvent,
  onReconnecting,
  pollIntervalMs = 2500
}: {
  enabled: boolean;
  onConnected: () => void;
  onEvent: (event: T) => void;
  onMalformedEvent: () => void;
  onReconnecting: () => void;
  pollIntervalMs?: number;
}) => {
  const callbacksRef = useRef({ onConnected, onEvent, onMalformedEvent, onReconnecting });
  callbacksRef.current = { onConnected, onEvent, onMalformedEvent, onReconnecting };
  const cursorRef = useRef("");

  useEffect(() => {
    if (!enabled) return undefined;

    let closed = false;
    let pollTimer: number | null = null;
    let source: EventSource | null = null;

    const acceptEvent = (event: T) => {
      if (event.cursor) cursorRef.current = event.cursor;
      callbacksRef.current.onEvent(event);
    };

    const fetchEvents = async () => {
      const data = await symposiumApi.request<LiveEventBatch<T>>(
        liveEventsPath("/api/events", cursorRef.current),
        { cache: "no-store" }
      );
      if (closed) return;
      for (const event of data.events ?? []) acceptEvent(event);
      if (data.cursor) cursorRef.current = data.cursor;
      callbacksRef.current.onConnected();
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

    startPolling();

    if ("EventSource" in window) {
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
    }

    return () => {
      closed = true;
      source?.close();
      stopPolling();
    };
  }, [enabled, pollIntervalMs]);
};
