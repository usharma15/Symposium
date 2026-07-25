"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import { assistantRequestIntentFor } from "@/features/assistant/assistantRequestIntent";
import { orderAssistantThreadsByLatestMessage } from "@/features/assistant/assistantThreadOrdering";
import type {
  AssistantContextUpdateResultContract,
  AssistantMessageContract,
  AssistantMessageInputContract,
  AssistantQuickNoteContract,
  AssistantQuickNoteResultContract,
  AssistantQuotaStatusContract,
  AssistantResponseContract,
  AssistantSourceUpdateResultContract,
  AssistantThreadDetailContract,
  AssistantThreadPageContract,
  AssistantThreadSourceContract,
  AssistantThreadStateContract,
  AssistantThreadSummaryContract,
  AssistantTranslationContract
} from "@/packages/contracts/src";

export type AssistantContext = AssistantMessageInputContract["context"];

export type AssistantMessageView = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  conversationId?: string;
  createdAt?: string;
  evidence?: AssistantMessageContract["evidence"];
  translation?: AssistantTranslationContract;
  quickNote?: AssistantQuickNoteContract;
  quickNoteResult?: AssistantQuickNoteResultContract;
};

type AssistantBroadcast = {
  actorHandle: string;
  conversationId: string;
  updatedAt: number;
};

type RetryMutation = {
  fingerprint: string;
  key: string;
};

const assistantBroadcastChannel = "symposium:assistant-threads:v1";

const contextKeyFor = (context: AssistantContext) =>
  `${context.surface}:${context.entityId ?? context.route}`;

const contextTypeFor = (
  surface: AssistantContext["surface"]
): AssistantMessageInputContract["contextType"] => {
  if (surface === "post" || surface === "opportunity" || surface === "attachment") return "post";
  if (surface === "community") return "community";
  if (surface === "workspace") return "note";
  if (surface === "room") return "room";
  return "general";
};

const initialMessageFor = (context: AssistantContext): AssistantMessageView => ({
  id: `intro:${contextKeyFor(context)}`,
  role: "assistant",
  body: `I’m looking at ${context.title}. Ask me about what is actually on this screen.`
});

const threadSummary = (
  thread: AssistantThreadStateContract
): AssistantThreadSummaryContract => {
  const { sources: _sources, ...summary } = thread;
  return summary;
};

const errorMessage = (caught: unknown, fallback: string) =>
  caught instanceof SymposiumApiError ? caught.message : fallback;

export function useAssistantController({
  actorHandle,
  context,
  requestedConversationId = null,
  enabled = true
}: {
  actorHandle: string;
  context: AssistantContext;
  requestedConversationId?: string | null;
  enabled?: boolean;
}) {
  const contextRef = useRef(context);
  const actorHandleRef = useRef(actorHandle);
  const contextKey = contextKeyFor(context);
  const conversationIdRef = useRef<string | undefined>(
    requestedConversationId ?? undefined
  );
  const draftRef = useRef("");
  const requestedAttemptRef = useRef<string | null>(null);
  const loadedConversationIdRef = useRef<string | null>(null);
  const threadRequestRef = useRef(0);
  const draftsRef = useRef(new Map<string, string>());
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const submissionLockRef = useRef(false);
  const contextLockRef = useRef(false);
  const messageRetryRef = useRef<RetryMutation | null>(null);
  const contextRetryRef = useRef<RetryMutation | null>(null);
  const sourceRetryRef = useRef<RetryMutation | null>(null);

  const [conversationId, setConversationIdState] = useState<string | undefined>(
    requestedConversationId ?? undefined
  );
  const [thread, setThread] = useState<AssistantThreadStateContract | null>(null);
  const [threads, setThreads] = useState<AssistantThreadSummaryContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>(() => [
    initialMessageFor(context)
  ]);
  const [draft, setDraftState] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [threadLoading, setThreadLoading] = useState(true);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [error, setError] = useState("");
  const [dailyLimit, setDailyLimit] = useState(10);
  const [remainingToday, setRemainingToday] = useState(0);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(40);
  const [providerEnabled, setProviderEnabled] = useState(true);
  const [providerConfigured, setProviderConfigured] = useState(true);

  contextRef.current = context;
  conversationIdRef.current = conversationId;
  draftRef.current = draft;

  const currentDraftKey = useCallback(
    (id = conversationIdRef.current) =>
      id ?? `new:${contextKeyFor(contextRef.current)}`,
    []
  );

  const rememberDraft = useCallback((value: string) => {
    draftsRef.current.set(currentDraftKey(), value);
    draftRef.current = value;
    setDraftState(value);
  }, [currentDraftKey]);

  const restoreDraft = useCallback((id?: string) => {
    const restored = draftsRef.current.get(currentDraftKey(id)) ?? "";
    draftRef.current = restored;
    setDraftState(restored);
  }, [currentDraftKey]);

  const setConversationId = useCallback((id?: string) => {
    conversationIdRef.current = id;
    setConversationIdState(id);
  }, []);

  const replaceThreadSummary = useCallback((next: AssistantThreadStateContract) => {
    setThreads((current) => orderAssistantThreadsByLatestMessage([
      threadSummary(next),
      ...current.filter((candidate) => candidate.id !== next.id)
    ]));
  }, []);

  const broadcastThreadChange = useCallback((id: string) => {
    broadcastRef.current?.postMessage({
      actorHandle,
      conversationId: id,
      updatedAt: Date.now()
    } satisfies AssistantBroadcast);
  }, [actorHandle]);

  const refreshThreads = useCallback(async () => {
    const page = await symposiumApi.request<AssistantThreadPageContract>(
      `/api/assistant/conversations?actorHandle=${encodeURIComponent(actorHandle)}&limit=50`,
      { cache: "no-store" }
    );
    setThreads(orderAssistantThreadsByLatestMessage(page.threads));
    setNextCursor(page.nextCursor);
    return page;
  }, [actorHandle]);

  const refreshSelectedThread = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return null;
    const detail = await symposiumApi.request<AssistantThreadDetailContract>(
      `/api/assistant/conversations/${encodeURIComponent(id)}?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    );
    if (conversationIdRef.current !== id) return null;
    loadedConversationIdRef.current = detail.id;
    setThread(detail);
    setMessages(detail.messages);
    replaceThreadSummary(detail);
    return detail;
  }, [actorHandle, replaceThreadSummary]);

  const openThread = useCallback(async (id: string) => {
    const normalized = id.trim();
    if (!normalized) return;
    draftsRef.current.set(currentDraftKey(), draftRef.current);
    const request = ++threadRequestRef.current;
    setConversationId(normalized);
    loadedConversationIdRef.current = null;
    setThread(null);
    setMessages([]);
    restoreDraft(normalized);
    setThreadLoading(true);
    setError("");
    try {
      const detail = await symposiumApi.request<AssistantThreadDetailContract>(
        `/api/assistant/conversations/${encodeURIComponent(normalized)}?actorHandle=${encodeURIComponent(actorHandle)}`,
        { cache: "no-store" }
      );
      if (request !== threadRequestRef.current) return;
      setConversationId(detail.id);
      loadedConversationIdRef.current = detail.id;
      setThread(detail);
      setMessages(detail.messages);
      replaceThreadSummary(detail);
    } catch (caught) {
      if (request !== threadRequestRef.current) return;
      setConversationId(undefined);
      loadedConversationIdRef.current = null;
      setThread(null);
      setMessages([initialMessageFor(contextRef.current)]);
      restoreDraft(undefined);
      setError(errorMessage(caught, "That research thread could not be loaded."));
    } finally {
      if (request === threadRequestRef.current) setThreadLoading(false);
    }
  }, [
    actorHandle,
    currentDraftKey,
    replaceThreadSummary,
    restoreDraft,
    setConversationId
  ]);

  const startNewThread = useCallback(() => {
    draftsRef.current.set(currentDraftKey(), draftRef.current);
    threadRequestRef.current += 1;
    setConversationId(undefined);
    loadedConversationIdRef.current = null;
    requestedAttemptRef.current = null;
    setThread(null);
    setMessages([initialMessageFor(contextRef.current)]);
    restoreDraft(undefined);
    setThreadLoading(false);
    setError("");
    messageRetryRef.current = null;
    contextRetryRef.current = null;
    sourceRetryRef.current = null;
  }, [currentDraftKey, restoreDraft, setConversationId]);

  useEffect(() => {
    if (actorHandleRef.current === actorHandle) return;
    actorHandleRef.current = actorHandle;
    threadRequestRef.current += 1;
    draftsRef.current.clear();
    setConversationId(undefined);
    loadedConversationIdRef.current = null;
    requestedAttemptRef.current = null;
    setThread(null);
    setThreads([]);
    setNextCursor(null);
    setMessages([initialMessageFor(contextRef.current)]);
    rememberDraft("");
    setThreadLoading(enabled);
    setQuotaLoading(enabled);
    setError("");
    submissionLockRef.current = false;
    contextLockRef.current = false;
    messageRetryRef.current = null;
    contextRetryRef.current = null;
    sourceRetryRef.current = null;
  }, [actorHandle, enabled, rememberDraft, setConversationId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    requestedAttemptRef.current = null;
    setQuotaLoading(true);
    setError("");
    void symposiumApi.request<AssistantQuotaStatusContract>(
      "/api/assistant/quota",
      { cache: "no-store" }
    ).then((status) => {
      if (cancelled) return;
      setDailyLimit(status.quota.dailyLimit);
      setRemainingToday(status.quota.remainingToday);
      setMonthlyBudgetUsd(status.quota.monthlyBudgetUsd);
      setProviderEnabled(status.enabled);
      setProviderConfigured(status.providerConfigured);
      if (!status.enabled) setError("The AI Tablet is currently switched off.");
      else if (!status.providerConfigured) {
        setError("The AI Tablet model provider is not configured.");
      }
    }).catch((caught) => {
      if (!cancelled) {
        setError(errorMessage(
          caught,
          "The current AI allowance could not be loaded."
        ));
      }
    }).finally(() => {
      if (!cancelled) setQuotaLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [actorHandle, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const selectedAlreadyLoaded = Boolean(
      conversationIdRef.current &&
      loadedConversationIdRef.current === conversationIdRef.current
    );
    if (!selectedAlreadyLoaded) setThreadLoading(true);
    void refreshThreads().then((page) => {
      if (cancelled || requestedConversationId || conversationIdRef.current) return;
      const contextKey = contextKeyFor(contextRef.current);
      const matching = page.threads.find(
        (candidate) => candidate.activeContextKey === contextKey
      );
      if (matching) {
        void openThread(matching.id);
      } else {
        setMessages([initialMessageFor(contextRef.current)]);
      }
    }).catch((caught) => {
      if (!cancelled) {
        setError(errorMessage(
          caught,
          "Research-thread history could not be loaded."
        ));
      }
    }).finally(() => {
      if (!cancelled && (selectedAlreadyLoaded || !conversationIdRef.current)) {
        setThreadLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actorHandle, enabled, openThread, refreshThreads]);

  useEffect(() => {
    if (!enabled) return;
    if (!requestedConversationId) {
      requestedAttemptRef.current = null;
      return;
    }
    if (loadedConversationIdRef.current === requestedConversationId) return;
    if (requestedAttemptRef.current === requestedConversationId) return;
    requestedAttemptRef.current = requestedConversationId;
    void openThread(requestedConversationId);
  }, [enabled, openThread, requestedConversationId]);

  useEffect(() => {
    if (!conversationIdRef.current) {
      setMessages([initialMessageFor(context)]);
      restoreDraft(undefined);
    }
  }, [contextKey, restoreDraft]);

  useEffect(() => {
    const updateQuota = (event: Event) => {
      const quota = (event as CustomEvent<AssistantQuotaStatusContract["quota"]>).detail;
      if (!quota) return;
      setDailyLimit(quota.dailyLimit);
      setRemainingToday(quota.remainingToday);
      setMonthlyBudgetUsd(quota.monthlyBudgetUsd);
    };
    window.addEventListener("symposium-ai-quota-change", updateQuota);
    return () => window.removeEventListener("symposium-ai-quota-change", updateQuota);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(assistantBroadcastChannel);
    broadcastRef.current = channel;
    channel.onmessage = (event: MessageEvent<AssistantBroadcast>) => {
      const change = event.data;
      if (
        !change ||
        change.actorHandle !== actorHandle ||
        change.conversationId !== conversationIdRef.current
      ) {
        return;
      }
      void Promise.all([
        refreshSelectedThread().catch(() => null),
        refreshThreads().catch(() => null)
      ]);
    };
    return () => {
      if (broadcastRef.current === channel) broadcastRef.current = null;
      channel.close();
    };
  }, [actorHandle, enabled, refreshSelectedThread, refreshThreads]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "hidden" || !conversationIdRef.current) return;
      void Promise.all([
        refreshSelectedThread().catch(() => null),
        refreshThreads().catch(() => null)
      ]);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, refreshSelectedThread, refreshThreads]);

  const changeThreadContext = useCallback(async (
    mode: "use" | "attach" | "refresh"
  ) => {
    const id = conversationIdRef.current;
    if (
      !id ||
      !thread ||
      busy ||
      contextBusy ||
      submissionLockRef.current ||
      contextLockRef.current
    ) {
      return;
    }
    const input = {
      actorHandle,
      mode,
      context: contextRef.current,
      expectedRevision: thread.contextRevision
    };
    const fingerprint = JSON.stringify({ id, ...input });
    if (contextRetryRef.current?.fingerprint !== fingerprint) {
      contextRetryRef.current = {
        fingerprint,
        key: createClientMutationId(`assistant-context-${mode}`)
      };
    }
    contextLockRef.current = true;
    setContextBusy(true);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantContextUpdateResultContract>(
        `/api/assistant/conversations/${encodeURIComponent(id)}/context`,
        {
          method: "POST",
          idempotencyKey: contextRetryRef.current.key,
          body: input
        }
      );
      setThread(result.thread);
      replaceThreadSummary(result.thread);
      setMessages((current) => [...current, result.message]);
      contextRetryRef.current = null;
      broadcastThreadChange(id);
    } catch (caught) {
      if (caught instanceof SymposiumApiError && caught.status === 409) {
        await refreshSelectedThread().catch(() => null);
        setError(
          "This thread changed in another session. The latest Context Dock state is loaded; review it and try again."
        );
      } else {
        setError(errorMessage(
          caught,
          "The research thread context could not be changed."
        ));
      }
    } finally {
      contextLockRef.current = false;
      setContextBusy(false);
    }
  }, [
    actorHandle,
    broadcastThreadChange,
    busy,
    contextBusy,
    refreshSelectedThread,
    replaceThreadSummary,
    thread
  ]);

  const changeSavedSource = useCallback(async (
    source: AssistantThreadSourceContract,
    action: "use" | "include" | "exclude"
  ) => {
    const id = conversationIdRef.current;
    if (
      !id ||
      !thread ||
      busy ||
      contextBusy ||
      submissionLockRef.current ||
      contextLockRef.current
    ) {
      return;
    }
    const input = {
      actorHandle,
      sourceId: source.id,
      action,
      expectedRevision: thread.contextRevision
    };
    const fingerprint = JSON.stringify({ id, ...input });
    if (sourceRetryRef.current?.fingerprint !== fingerprint) {
      sourceRetryRef.current = {
        fingerprint,
        key: createClientMutationId(`assistant-source-${action}`)
      };
    }
    contextLockRef.current = true;
    setContextBusy(true);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantSourceUpdateResultContract>(
        `/api/assistant/conversations/${encodeURIComponent(id)}/sources`,
        {
          method: "POST",
          idempotencyKey: sourceRetryRef.current.key,
          body: input
        }
      );
      setThread(result.thread);
      replaceThreadSummary(result.thread);
      setMessages((current) => [...current, result.message]);
      sourceRetryRef.current = null;
      broadcastThreadChange(id);
    } catch (caught) {
      if (caught instanceof SymposiumApiError && caught.status === 409) {
        await refreshSelectedThread().catch(() => null);
        setError(
          "This thread changed in another session. The latest Context Dock state is loaded; review it and try again."
        );
      } else {
        setError(errorMessage(caught, "The saved source could not be changed."));
      }
    } finally {
      contextLockRef.current = false;
      setContextBusy(false);
    }
  }, [
    actorHandle,
    broadcastThreadChange,
    busy,
    contextBusy,
    refreshSelectedThread,
    replaceThreadSummary,
    thread
  ]);

  const submit = useCallback(async () => {
    const message = draft.trim();
    if (
      !message ||
      busy ||
      contextBusy ||
      submissionLockRef.current ||
      contextLockRef.current ||
      threadLoading ||
      quotaLoading ||
      remainingToday <= 0 ||
      !providerEnabled ||
      !providerConfigured
    ) {
      return;
    }
    const requestIntent = assistantRequestIntentFor(message);
    if (requestIntent.translationRequested && !requestIntent.targetLanguage) {
      setError("Name a supported target language in your translation request.");
      return;
    }
    const optimisticId = createClientMutationId("assistant-user");
    const optimistic: AssistantMessageView = {
      id: optimisticId,
      role: "user",
      body: message
    };
    const id = conversationIdRef.current;
    const activeContext = contextRef.current;
    const fingerprint = JSON.stringify({ id, message, activeContext });
    if (messageRetryRef.current?.fingerprint !== fingerprint) {
      messageRetryRef.current = {
        fingerprint,
        key: createClientMutationId("assistant-message")
      };
    }
    submissionLockRef.current = true;
    setMessages((current) => [...current, optimistic]);
    rememberDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await symposiumApi.request<AssistantResponseContract>(
        "/api/assistant/messages",
        {
          method: "POST",
          idempotencyKey: messageRetryRef.current.key,
          body: {
            actorHandle,
            conversationId: id,
            message,
            intent: requestIntent.intent,
            ...(requestIntent.targetLanguage
              ? { targetLanguage: requestIntent.targetLanguage }
              : {}),
            contextType: contextTypeFor(activeContext.surface),
            contextId: activeContext.entityId,
            context: activeContext
          }
        }
      );
      setConversationId(response.conversationId);
      loadedConversationIdRef.current = response.conversationId;
      if (response.thread) {
        setThread(response.thread);
        replaceThreadSummary(response.thread);
      }
      setRemainingToday(
        response.quota?.remainingToday ?? Math.max(0, remainingToday - 1)
      );
      if (response.quota) {
        window.dispatchEvent(
          new CustomEvent("symposium-ai-quota-change", {
            detail: response.quota
          })
        );
      }
      setMessages((current) => [
        ...current,
        {
          ...response.message,
          conversationId: response.conversationId,
          evidence: response.message.evidence,
          translation: response.message.translation ?? response.translation,
          quickNote: response.message.quickNote ?? response.quickNote
        }
      ]);
      messageRetryRef.current = null;
      broadcastThreadChange(response.conversationId);
    } catch (caught) {
      setMessages((current) => current.filter(
        (candidate) => candidate.id !== optimisticId
      ));
      rememberDraft(message);
      setError(errorMessage(caught, "The AI Tablet could not complete this request."));
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }, [
    actorHandle,
    broadcastThreadChange,
    busy,
    contextBusy,
    draft,
    providerConfigured,
    providerEnabled,
    quotaLoading,
    remainingToday,
    rememberDraft,
    replaceThreadSummary,
    setConversationId,
    threadLoading
  ]);

  const synchronizeThreadMutation = useCallback(async (id: string) => {
    broadcastThreadChange(id);
    await Promise.all([
      refreshSelectedThread().catch(() => null),
      refreshThreads().catch(() => null)
    ]);
  }, [broadcastThreadChange, refreshSelectedThread, refreshThreads]);

  return {
    actorHandle,
    context,
    contextKey,
    conversationId,
    thread,
    threads,
    nextCursor,
    messages,
    draft,
    busy,
    contextBusy,
    threadLoading,
    quotaLoading,
    error,
    dailyLimit,
    remainingToday,
    monthlyBudgetUsd,
    providerEnabled,
    providerConfigured,
    setDraft: rememberDraft,
    setError,
    openThread,
    startNewThread,
    refreshThreads,
    refreshSelectedThread,
    changeThreadContext,
    changeSavedSource,
    synchronizeThreadMutation,
    submit
  };
}

export type AssistantController = ReturnType<typeof useAssistantController>;
