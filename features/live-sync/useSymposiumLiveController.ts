"use client";

import { useEffect, useState } from "react";
import {
  contentAnalyticsInvalidationFromLiveEvent,
  contentAnalyticsSyncChannel,
  contentAnalyticsSyncStorageKey,
  dispatchContentAnalyticsInvalidation,
  isContentAnalyticsInvalidation,
  type ContentAnalyticsInvalidation
} from "@/features/analytics/contentAnalyticsSync";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import {
  liveEventScopeKey,
  useLiveEventStream
} from "@/features/live-sync/useLiveEventStream";
import {
  appendScopedLiveEvent,
  resetScopedLiveEventBuffer,
  routeSymposiumLiveEvent,
  scopedLiveEvents,
  type SymposiumLiveEvent,
  type ScopedLiveEventBuffer,
  type SymposiumLiveRoutingPorts
} from "@/features/live-sync/symposiumLiveEventRouter";
import type { AssistantThreadLiveEvent } from "@/features/assistant/assistantControllerModel";

type ManagedRoutingPort =
  | "appendAssistantEvent"
  | "appendMessagingEvent"
  | "appendNotificationEvent"
  | "dispatchAnalyticsInvalidation"
  | "dispatchOpportunityApplicationsChange"
  | "dispatchScribbleChange"
  | "dispatchWorkspaceChange";

type SymposiumLiveControllerInput = {
  authSessionKey: string;
  backendUrl: string | null;
  enabled: boolean;
  getAccessToken: () => Promise<string | null>;
  onConnected: () => void;
  onReconnecting: () => void;
  routing: Omit<SymposiumLiveRoutingPorts, ManagedRoutingPort>;
};

export const useSymposiumLiveController = ({
  authSessionKey,
  backendUrl,
  enabled,
  getAccessToken,
  onConnected,
  onReconnecting,
  routing
}: SymposiumLiveControllerInput) => {
  const [messagingBuffer, setMessagingBuffer] = useState<
    ScopedLiveEventBuffer<SymposiumLiveEvent>
  >({ scopeKey: authSessionKey, events: [] });
  const [assistantBuffer, setAssistantBuffer] = useState<
    ScopedLiveEventBuffer<AssistantThreadLiveEvent>
  >({ scopeKey: authSessionKey, events: [] });
  const [notificationBuffer, setNotificationBuffer] = useState<
    ScopedLiveEventBuffer<SymposiumLiveEvent>
  >({ scopeKey: authSessionKey, events: [] });
  const transportScopeKey = liveEventScopeKey(authSessionKey, backendUrl);
  const publishContentAnalyticsInvalidation =
    useCrossTabItemTransport<ContentAnalyticsInvalidation>({
      channelName: contentAnalyticsSyncChannel,
      isMessage: isContentAnalyticsInvalidation,
      onMessage: dispatchContentAnalyticsInvalidation,
      storageKey: contentAnalyticsSyncStorageKey
    });

  useEffect(() => {
    setMessagingBuffer((current) =>
      resetScopedLiveEventBuffer(current, authSessionKey)
    );
    setAssistantBuffer((current) =>
      resetScopedLiveEventBuffer(current, authSessionKey)
    );
    setNotificationBuffer((current) =>
      resetScopedLiveEventBuffer(current, authSessionKey)
    );
  }, [authSessionKey]);

  const onEvent = (event: SymposiumLiveEvent, eventScopeKey: string) => {
    if (eventScopeKey !== transportScopeKey) return;
    routeSymposiumLiveEvent(event, {
      ...routing,
      appendAssistantEvent: (incoming) => {
        setAssistantBuffer((current) => appendScopedLiveEvent(current, authSessionKey, {
          id: incoming.id,
          cursor: incoming.cursor,
          kind: incoming.kind,
          subjectId: incoming.subjectId
        }, 100));
      },
      appendMessagingEvent: (incoming) => {
        setMessagingBuffer((current) =>
          appendScopedLiveEvent(current, authSessionKey, incoming, 1000)
        );
      },
      appendNotificationEvent: (incoming) => {
        setNotificationBuffer((current) =>
          appendScopedLiveEvent(current, authSessionKey, incoming, 1000)
        );
      },
      dispatchAnalyticsInvalidation: (incoming) => {
        const invalidation = contentAnalyticsInvalidationFromLiveEvent(incoming);
        if (!invalidation) return;
        dispatchContentAnalyticsInvalidation(invalidation);
        publishContentAnalyticsInvalidation(invalidation);
      },
      dispatchOpportunityApplicationsChange: () => {
        window.dispatchEvent(new Event("symposium-opportunity-applications-change"));
      },
      dispatchScribbleChange: (revision) => {
        window.dispatchEvent(new CustomEvent("symposium-scribble-change", {
          detail: { revision }
        }));
      },
      dispatchWorkspaceChange: () => {
        window.dispatchEvent(new Event("symposium-workspace-change"));
      }
    });
  };

  useLiveEventStream<SymposiumLiveEvent>({
    authSessionKey,
    backendUrl,
    enabled,
    getAccessToken,
    onConnected: (eventScopeKey) => {
      if (eventScopeKey === transportScopeKey) onConnected();
    },
    onEvent,
    onMalformedEvent: (eventScopeKey) => {
      if (eventScopeKey === transportScopeKey) routing.refreshAll();
    },
    onReconnecting: (eventScopeKey) => {
      if (eventScopeKey === transportScopeKey) onReconnecting();
    }
  });

  return {
    assistantEvents: scopedLiveEvents(assistantBuffer, authSessionKey),
    messagingEvents: scopedLiveEvents(messagingBuffer, authSessionKey),
    notificationEvents: scopedLiveEvents(notificationBuffer, authSessionKey)
  };
};
