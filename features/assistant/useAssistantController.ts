"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import { assistantRequestIntentFor } from "@/features/assistant/assistantRequestIntent";
import {
  orderAssistantThreadsByLatestMessage,
  reconcileAssistantThreadSummary
} from "@/features/assistant/assistantThreadOrdering";
import type {
  AssistantContextUpdateResultContract,
  AssistantMessageContract,
  AssistantMessageInputContract,
  AssistantQuickNoteContract,
  AssistantQuickNoteResultContract,
  AssistantQuotaStatusContract,
  AssistantResponseContract,
  AssistantSourceUpdateResultContract,
  AssistantThreadDeleteResultContract,
  AssistantThreadDetailContract,
  AssistantThreadPageContract,
  AssistantThreadSourceContract,
  AssistantThreadStateContract,
  AssistantThreadSummaryContract,
  AssistantThreadUpdateResultContract,
  AssistantTranslationContract,
  InquiryAttachmentContract
} from "@/packages/contracts/src";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import { buildPostAttachmentMetadata } from "@/features/attachments/AttachmentViews";
import {
  inferAttachmentContentType,
  maxAssistantAttachments,
  validateAssistantAttachmentDetails
} from "@/lib/attachmentRules";
import {
  isAssistantVisionContentType,
  maxAssistantVisionAttachments
} from "@/lib/assistantVisionRules";

export type AssistantContext = NonNullable<AssistantMessageInputContract["context"]>;
export type AssistantNewThreadContextMode = "current" | "blank";

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
  attachments?: InquiryAttachmentContract[];
};

type AssistantBroadcast = {
  actorHandle: string;
  conversationId: string;
  operation: "changed" | "deleted";
  updatedAt: number;
};

type RetryMutation = {
  fingerprint: string;
  key: string;
};

export type AssistantThreadLibraryStatus = "active" | "archived";
export type AssistantThreadLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  subjectId: string;
};

const assistantBroadcastChannel = "symposium:assistant-threads:v1";
const emptyAssistantLiveEvents: AssistantThreadLiveEvent[] = [];

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

export const initialAssistantMessageFor = (
  context: AssistantContext | null
): AssistantMessageView => ({
  id: context ? `intro:${contextKeyFor(context)}` : "intro:blank",
  role: "assistant",
  body: context
    ? `You’re on ${context.title}. Ask about this view, or remove it to start without context.`
    : "What’s on your mind?"
});

const threadSummary = (
  thread: AssistantThreadStateContract
): AssistantThreadSummaryContract => {
  const { sources: _sources, ...summary } = thread;
  return summary;
};

const errorMessage = (caught: unknown, fallback: string) =>
  caught instanceof SymposiumApiError ? caught.message : fallback;

const discardAssistantAttachment = (
  attachmentId: string,
  actorHandle: string
) => symposiumApi.request<{ attachmentId: string; discarded: true }>(
  `/api/attachments/${encodeURIComponent(attachmentId)}?actorHandle=${encodeURIComponent(actorHandle)}`,
  { method: "DELETE" }
);

export function useAssistantController({
  actorHandle,
  context,
  requestedConversationId = null,
  enabled = true,
  liveEvents = emptyAssistantLiveEvents
}: {
  actorHandle: string;
  context: AssistantContext;
  requestedConversationId?: string | null;
  enabled?: boolean;
  liveEvents?: AssistantThreadLiveEvent[];
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
  const threadListRequestRef = useRef(0);
  const draftsRef = useRef(new Map<string, string>());
  const attachmentDraftsRef = useRef(new Map<string, InquiryAttachmentContract[]>());
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const submissionLockRef = useRef(false);
  const contextLockRef = useRef(false);
  const threadActionLockRef = useRef(false);
  const explicitNewThreadRef = useRef(false);
  const suppressedRequestedConversationIdRef = useRef<string | null>(null);
  const messageRetryRef = useRef<RetryMutation | null>(null);
  const contextRetryRef = useRef<RetryMutation | null>(null);
  const sourceRetryRef = useRef<RetryMutation | null>(null);
  const threadMutationRetryRef = useRef(new Map<string, RetryMutation>());
  const processedLiveEventKeysRef = useRef<string[]>([]);
  const newThreadContextModeRef = useRef<AssistantNewThreadContextMode>("current");
  const threadSearchRef = useRef("");
  const threadLibraryStatusRef = useRef<AssistantThreadLibraryStatus>("active");

  const [conversationId, setConversationIdState] = useState<string | undefined>(
    requestedConversationId ?? undefined
  );
  const [thread, setThread] = useState<AssistantThreadStateContract | null>(null);
  const [threads, setThreads] = useState<AssistantThreadSummaryContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [threadSearch, setThreadSearchState] = useState("");
  const [threadLibraryStatus, setThreadLibraryStatusState] =
    useState<AssistantThreadLibraryStatus>("active");
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [threadListLoadingMore, setThreadListLoadingMore] = useState(false);
  const [threadActionBusyId, setThreadActionBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>(() => [
    initialAssistantMessageFor(context)
  ]);
  const [newThreadContextMode, setNewThreadContextModeState] =
    useState<AssistantNewThreadContextMode>("current");
  const [draft, setDraftState] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<InquiryAttachmentContract[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
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
      id ?? (newThreadContextModeRef.current === "blank"
        ? "new:blank"
        : `new:${contextKeyFor(contextRef.current)}`),
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

  const restorePendingAttachments = useCallback((id?: string) => {
    setPendingAttachments(
      attachmentDraftsRef.current.get(currentDraftKey(id)) ?? []
    );
  }, [currentDraftKey]);

  const setConversationId = useCallback((id?: string) => {
    conversationIdRef.current = id;
    setConversationIdState(id);
  }, []);

  const setNewThreadContextMode = useCallback((
    mode: AssistantNewThreadContextMode
  ) => {
    newThreadContextModeRef.current = mode;
    setNewThreadContextModeState(mode);
    if (!conversationIdRef.current) {
      setMessages([
        initialAssistantMessageFor(mode === "current" ? contextRef.current : null)
      ]);
    }
  }, []);

  const replaceThreadSummary = useCallback((next: AssistantThreadStateContract) => {
    setThreads((current) => reconcileAssistantThreadSummary(
      current,
      threadSummary(next),
      {
        status: threadLibraryStatusRef.current,
        hasSearch: Boolean(threadSearchRef.current)
      }
    ));
  }, []);

  const broadcastThreadChange = useCallback((
    id: string,
    operation: AssistantBroadcast["operation"] = "changed"
  ) => {
    broadcastRef.current?.postMessage({
      actorHandle,
      conversationId: id,
      operation,
      updatedAt: Date.now()
    } satisfies AssistantBroadcast);
  }, [actorHandle]);

  const refreshThreads = useCallback(async ({
    append = false,
    cursor = null,
    search = threadSearchRef.current,
    status = threadLibraryStatusRef.current,
    silent = false
  }: {
    append?: boolean;
    cursor?: string | null;
    search?: string;
    status?: AssistantThreadLibraryStatus;
    silent?: boolean;
  } = {}) => {
    const request = ++threadListRequestRef.current;
    if (!silent) {
      if (append) setThreadListLoadingMore(true);
      else setThreadListLoading(true);
    }
    const params = new URLSearchParams({
      actorHandle,
      limit: "20",
      status
    });
    if (search.trim()) params.set("search", search.trim());
    if (cursor) params.set("cursor", cursor);
    try {
      const page = await symposiumApi.request<AssistantThreadPageContract>(
        `/api/assistant/conversations?${params.toString()}`,
        { cache: "no-store" }
      );
      if (request === threadListRequestRef.current) {
        setThreads((current) => orderAssistantThreadsByLatestMessage(
          append
            ? [
                ...current,
                ...page.threads.filter((candidate) =>
                  current.every((existing) => existing.id !== candidate.id)
                )
              ]
            : page.threads
        ));
        setNextCursor(page.nextCursor);
      }
      return page;
    } finally {
      if (!silent && request === threadListRequestRef.current) {
        if (append) setThreadListLoadingMore(false);
        else setThreadListLoading(false);
      }
    }
  }, [actorHandle]);

  const setThreadLibraryFilters = useCallback((
    search: string,
    status: AssistantThreadLibraryStatus
  ) => {
    const normalizedSearch = search.trim().slice(0, 160);
    threadSearchRef.current = normalizedSearch;
    threadLibraryStatusRef.current = status;
    setThreadSearchState(normalizedSearch);
    setThreadLibraryStatusState(status);
    setNextCursor(null);
    void refreshThreads({ search: normalizedSearch, status }).catch((caught) => {
      setThreadListLoading(false);
      setError(errorMessage(caught, "Chat history could not be searched."));
    });
  }, [refreshThreads]);

  const loadMoreThreads = useCallback(async () => {
    const cursor = nextCursor;
    if (!cursor || threadListLoadingMore) return;
    setError("");
    try {
      await refreshThreads({ append: true, cursor });
    } catch (caught) {
      setThreadListLoadingMore(false);
      setError(errorMessage(caught, "More chats could not be loaded."));
    }
  }, [nextCursor, refreshThreads, threadListLoadingMore]);

  const findActiveThreadForContext = useCallback(async (contextKey: string) => {
    const params = new URLSearchParams({
      actorHandle,
      contextKey,
      limit: "1",
      status: "active"
    });
    const page = await symposiumApi.request<AssistantThreadPageContract>(
      `/api/assistant/conversations?${params.toString()}`,
      { cache: "no-store" }
    );
    return page.threads[0] ?? null;
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
    explicitNewThreadRef.current = false;
    suppressedRequestedConversationIdRef.current = null;
    draftsRef.current.set(currentDraftKey(), draftRef.current);
    attachmentDraftsRef.current.set(currentDraftKey(), pendingAttachments);
    const request = ++threadRequestRef.current;
    setConversationId(normalized);
    loadedConversationIdRef.current = null;
    setThread(null);
    setMessages([]);
    restoreDraft(normalized);
    restorePendingAttachments(normalized);
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
      newThreadContextModeRef.current = "current";
      setNewThreadContextModeState("current");
      setMessages([initialAssistantMessageFor(contextRef.current)]);
      restoreDraft(undefined);
      restorePendingAttachments(undefined);
      setError(errorMessage(caught, "That research thread could not be loaded."));
    } finally {
      if (request === threadRequestRef.current) setThreadLoading(false);
    }
  }, [
    actorHandle,
    currentDraftKey,
    replaceThreadSummary,
    pendingAttachments,
    restoreDraft,
    restorePendingAttachments,
    setConversationId
  ]);

  const startNewThread = useCallback((
    mode: AssistantNewThreadContextMode = "blank"
  ) => {
    suppressedRequestedConversationIdRef.current = conversationIdRef.current ?? null;
    explicitNewThreadRef.current = true;
    draftsRef.current.set(currentDraftKey(), draftRef.current);
    attachmentDraftsRef.current.set(currentDraftKey(), pendingAttachments);
    threadRequestRef.current += 1;
    newThreadContextModeRef.current = mode;
    setNewThreadContextModeState(mode);
    setConversationId(undefined);
    loadedConversationIdRef.current = null;
    requestedAttemptRef.current = null;
    setThread(null);
    setMessages([
      initialAssistantMessageFor(mode === "current" ? contextRef.current : null)
    ]);
    restoreDraft(undefined);
    restorePendingAttachments(undefined);
    setThreadLoading(false);
    setError("");
    messageRetryRef.current = null;
    contextRetryRef.current = null;
    sourceRetryRef.current = null;
  }, [currentDraftKey, pendingAttachments, restoreDraft, restorePendingAttachments, setConversationId]);

  const updateThreadDetails = useCallback(async (
    candidate: AssistantThreadSummaryContract,
    changes: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
    }
  ) => {
    if (threadActionLockRef.current) return null;
    const selected = conversationIdRef.current === candidate.id ? thread : null;
    const expectedRevision = selected?.metadataRevision ?? candidate.metadataRevision;
    const input = {
      actorHandle,
      ...changes,
      expectedRevision
    };
    const fingerprint = JSON.stringify(input);
    const retryKey = `update:${candidate.id}`;
    const existingRetry = threadMutationRetryRef.current.get(retryKey);
    if (existingRetry?.fingerprint !== fingerprint) {
      threadMutationRetryRef.current.set(retryKey, {
        fingerprint,
        key: createClientMutationId("assistant-thread-update")
      });
    }
    threadActionLockRef.current = true;
    setThreadActionBusyId(candidate.id);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantThreadUpdateResultContract>(
        `/api/assistant/conversations/${encodeURIComponent(candidate.id)}`,
        {
          method: "PATCH",
          idempotencyKey: threadMutationRetryRef.current.get(retryKey)!.key,
          body: input
        }
      );
      threadMutationRetryRef.current.delete(retryKey);
      if (conversationIdRef.current === result.thread.id) {
        if (changes.archived === true) {
          draftsRef.current.delete(result.thread.id);
          startNewThread("blank");
        } else {
          setThread(result.thread);
        }
      }
      await refreshThreads().catch(() => null);
      broadcastThreadChange(result.thread.id);
      return result.thread;
    } catch (caught) {
      if (caught instanceof SymposiumApiError && caught.status === 409) {
        if (conversationIdRef.current === candidate.id) {
          await refreshSelectedThread().catch(() => null);
        }
        await refreshThreads().catch(() => null);
        setError("This chat changed in another session. The latest details are loaded; review them and try again.");
      } else {
        setError(errorMessage(caught, "The chat details could not be updated."));
      }
      return null;
    } finally {
      threadActionLockRef.current = false;
      setThreadActionBusyId(null);
    }
  }, [
    actorHandle,
    broadcastThreadChange,
    refreshSelectedThread,
    refreshThreads,
    startNewThread,
    thread
  ]);

  const deleteThread = useCallback(async (
    candidate: AssistantThreadSummaryContract
  ) => {
    if (threadActionLockRef.current) return false;
    const selected = conversationIdRef.current === candidate.id ? thread : null;
    const expectedRevision = selected?.metadataRevision ?? candidate.metadataRevision;
    const input = { actorHandle, expectedRevision };
    const fingerprint = JSON.stringify(input);
    const retryKey = `delete:${candidate.id}`;
    const existingRetry = threadMutationRetryRef.current.get(retryKey);
    if (existingRetry?.fingerprint !== fingerprint) {
      threadMutationRetryRef.current.set(retryKey, {
        fingerprint,
        key: createClientMutationId("assistant-thread-delete")
      });
    }
    threadActionLockRef.current = true;
    setThreadActionBusyId(candidate.id);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantThreadDeleteResultContract>(
        `/api/assistant/conversations/${encodeURIComponent(candidate.id)}`,
        {
          method: "DELETE",
          idempotencyKey: threadMutationRetryRef.current.get(retryKey)!.key,
          body: input
        }
      );
      threadMutationRetryRef.current.delete(retryKey);
      draftsRef.current.delete(result.conversationId);
      const unsentAttachments = attachmentDraftsRef.current.get(result.conversationId) ?? [];
      attachmentDraftsRef.current.delete(result.conversationId);
      for (const attachment of unsentAttachments) {
        void discardAssistantAttachment(attachment.id, actorHandle).catch(() => undefined);
      }
      setThreads((current) => current.filter((entry) => entry.id !== result.conversationId));
      if (conversationIdRef.current === result.conversationId) startNewThread("blank");
      await refreshThreads().catch(() => null);
      broadcastThreadChange(result.conversationId, "deleted");
      return true;
    } catch (caught) {
      if (caught instanceof SymposiumApiError && caught.status === 409) {
        if (conversationIdRef.current === candidate.id) {
          await refreshSelectedThread().catch(() => null);
        }
        await refreshThreads().catch(() => null);
        setError("This chat changed in another session. The latest details are loaded; review them and try again.");
      } else {
        setError(errorMessage(caught, "The chat could not be deleted."));
      }
      return false;
    } finally {
      threadActionLockRef.current = false;
      setThreadActionBusyId(null);
    }
  }, [
    actorHandle,
    broadcastThreadChange,
    refreshSelectedThread,
    refreshThreads,
    startNewThread,
    thread
  ]);

  useEffect(() => {
    if (actorHandleRef.current === actorHandle) return;
    const previousActorHandle = actorHandleRef.current;
    const abandonedAttachments = Array.from(attachmentDraftsRef.current.values()).flat();
    for (const attachment of abandonedAttachments) {
      void discardAssistantAttachment(attachment.id, previousActorHandle).catch(() => undefined);
    }
    actorHandleRef.current = actorHandle;
    threadRequestRef.current += 1;
    threadListRequestRef.current += 1;
    draftsRef.current.clear();
    attachmentDraftsRef.current.clear();
    setConversationId(undefined);
    loadedConversationIdRef.current = null;
    requestedAttemptRef.current = null;
    newThreadContextModeRef.current = "current";
    setNewThreadContextModeState("current");
    setThread(null);
    setThreads([]);
    setNextCursor(null);
    threadSearchRef.current = "";
    threadLibraryStatusRef.current = "active";
    setThreadSearchState("");
    setThreadLibraryStatusState("active");
    setThreadListLoading(false);
    setThreadListLoadingMore(false);
    setThreadActionBusyId(null);
    setMessages([initialAssistantMessageFor(contextRef.current)]);
    rememberDraft("");
    setPendingAttachments([]);
    setAttachmentUploading(false);
    setThreadLoading(enabled);
    setQuotaLoading(enabled);
    setError("");
    submissionLockRef.current = false;
    contextLockRef.current = false;
    threadActionLockRef.current = false;
    explicitNewThreadRef.current = false;
    suppressedRequestedConversationIdRef.current = null;
    messageRetryRef.current = null;
    contextRetryRef.current = null;
    sourceRetryRef.current = null;
    threadMutationRetryRef.current.clear();
    processedLiveEventKeysRef.current = [];
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
      if (
        cancelled ||
        explicitNewThreadRef.current ||
        requestedConversationId ||
        conversationIdRef.current
      ) return;
      const contextKey = contextKeyFor(contextRef.current);
      const loadedMatch = page.threads.find(
        (candidate) => candidate.activeContextKey === contextKey
      );
      return loadedMatch ?? findActiveThreadForContext(contextKey);
    }).then((matching) => {
      if (
        cancelled ||
        explicitNewThreadRef.current ||
        requestedConversationId ||
        conversationIdRef.current
      ) return;
      if (matching) void openThread(matching.id);
      else {
        newThreadContextModeRef.current = "current";
        setNewThreadContextModeState("current");
        setMessages([initialAssistantMessageFor(contextRef.current)]);
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
  }, [actorHandle, enabled, findActiveThreadForContext, openThread, refreshThreads, requestedConversationId]);

  useEffect(() => {
    if (!enabled) return;
    if (!requestedConversationId) {
      requestedAttemptRef.current = null;
      suppressedRequestedConversationIdRef.current = null;
      return;
    }
    if (suppressedRequestedConversationIdRef.current === requestedConversationId) return;
    if (loadedConversationIdRef.current === requestedConversationId) return;
    if (requestedAttemptRef.current === requestedConversationId) return;
    requestedAttemptRef.current = requestedConversationId;
    void openThread(requestedConversationId);
  }, [enabled, openThread, requestedConversationId]);

  useEffect(() => {
    if (!conversationIdRef.current) {
      setMessages([
        initialAssistantMessageFor(
          newThreadContextModeRef.current === "current" ? context : null
        )
      ]);
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
      if (!change || change.actorHandle !== actorHandle) return;
      if (
        change.operation === "deleted" &&
        change.conversationId === conversationIdRef.current
      ) {
        draftsRef.current.delete(change.conversationId);
        startNewThread("blank");
      }
      const selectedRefresh =
        change.operation !== "deleted" &&
        change.conversationId === conversationIdRef.current
          ? refreshSelectedThread().catch(() => null)
          : Promise.resolve(null);
      void Promise.all([
        selectedRefresh,
        refreshThreads({ silent: true }).catch(() => null)
      ]);
    };
    return () => {
      if (broadcastRef.current === channel) broadcastRef.current = null;
      channel.close();
    };
  }, [actorHandle, enabled, refreshSelectedThread, refreshThreads, startNewThread]);

  useEffect(() => {
    if (!enabled || !liveEvents.length) return;
    let refreshLibrary = false;
    let refreshSelected = false;
    let selectedDeleted = false;
    const processed = new Set(processedLiveEventKeysRef.current);
    for (const event of liveEvents) {
      if (!event.kind.startsWith("assistant.")) continue;
      const key = event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}`;
      if (processed.has(key)) continue;
      processed.add(key);
      refreshLibrary = true;
      if (event.subjectId === conversationIdRef.current) {
        if (event.kind === "assistant.thread.deleted") selectedDeleted = true;
        else refreshSelected = true;
      }
    }
    processedLiveEventKeysRef.current = [...processed].slice(-100);
    if (!refreshLibrary) return;
    if (selectedDeleted && conversationIdRef.current) {
      draftsRef.current.delete(conversationIdRef.current);
      startNewThread("blank");
    }
    const selectedRefresh = refreshSelected && !selectedDeleted
      ? refreshSelectedThread().catch(() => null)
      : Promise.resolve(null);
    void Promise.all([
      selectedRefresh,
      refreshThreads({ silent: true }).catch(() => null)
    ]);
  }, [
    enabled,
    liveEvents,
    refreshSelectedThread,
    refreshThreads,
    startNewThread
  ]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const selectedRefresh = conversationIdRef.current
        ? refreshSelectedThread().catch(() => null)
        : Promise.resolve(null);
      void Promise.all([
        selectedRefresh,
        refreshThreads({ silent: true }).catch(() => null)
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
    mode: "use" | "attach" | "refresh" | "clear"
  ) => {
    const id = conversationIdRef.current;
    if (
      !id ||
      !thread ||
      thread.archivedAt !== null ||
      busy ||
      contextBusy ||
      submissionLockRef.current ||
      contextLockRef.current
    ) {
      return;
    }
    const input = mode === "clear"
      ? {
          actorHandle,
          mode,
          expectedRevision: thread.contextRevision
        }
      : {
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

  const useCurrentView = useCallback(() => {
    if (conversationIdRef.current) {
      void changeThreadContext("use");
      return;
    }
    setNewThreadContextMode("current");
  }, [changeThreadContext, setNewThreadContextMode]);

  const clearContext = useCallback(() => {
    if (conversationIdRef.current) {
      void changeThreadContext("clear");
      return;
    }
    setNewThreadContextMode("blank");
  }, [changeThreadContext, setNewThreadContextMode]);

  const changeSavedSource = useCallback(async (
    source: AssistantThreadSourceContract,
    action: "use" | "include" | "exclude"
  ) => {
    const id = conversationIdRef.current;
    if (
      !id ||
      !thread ||
      thread.archivedAt !== null ||
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

  const includedSourceCount = conversationId
    ? thread?.sources.filter((source) => source.included).length ?? 0
    : newThreadContextMode === "current"
      ? 1
      : 0;
  const attachmentCapacity = Math.max(
    0,
    maxAssistantAttachments - includedSourceCount
  );
  const includedVisionSourceCount = conversationId
    ? thread?.sources.filter((source) =>
        source.included &&
        source.context.surface === "attachment" &&
        isAssistantVisionContentType(
          typeof source.context.metadata?.contentType === "string"
            ? source.context.metadata.contentType
            : ""
        )
      ).length ?? 0
    : newThreadContextMode === "current" &&
        context?.surface === "attachment" &&
        isAssistantVisionContentType(
          typeof context.metadata?.contentType === "string"
            ? context.metadata.contentType
            : ""
        )
      ? 1
      : 0;
  const pendingVisionCount = pendingAttachments.filter((attachment) =>
    isAssistantVisionContentType(attachment.contentType)
  ).length;
  const visionAttachmentCapacity = Math.max(
    0,
    maxAssistantVisionAttachments - includedVisionSourceCount - pendingVisionCount
  );

  const uploadAssistantFiles = useCallback(async (selectedFiles: File[]) => {
    if (
      !selectedFiles.length ||
      attachmentUploading ||
      busy ||
      contextBusy ||
      threadLoading ||
      Boolean(thread?.archivedAt)
    ) {
      return;
    }
    const available = Math.max(0, attachmentCapacity - pendingAttachments.length);
    if (!available) {
      setError("This chat already has five included sources. Exclude one in the Context Dock before attaching a file.");
      return;
    }
    const withinSourceLimit = selectedFiles.slice(0, available);
    let remainingVisionSlots = visionAttachmentCapacity;
    let skippedVisionFiles = 0;
    const files = withinSourceLimit.filter((file) => {
      const contentType = inferAttachmentContentType(file.name, file.type);
      if (!isAssistantVisionContentType(contentType)) return true;
      if (remainingVisionSlots <= 0) {
        skippedVisionFiles += 1;
        return false;
      }
      remainingVisionSlots -= 1;
      return true;
    });
    if (selectedFiles.length > available) {
      setError(`Only ${available} more file${available === 1 ? "" : "s"} can be attached while this source set is active.`);
    } else if (skippedVisionFiles) {
      setError(`Only ${maxAssistantVisionAttachments} images can be inspected in one answer. Other supported files can still be attached.`);
    } else {
      setError("");
    }
    if (!files.length) return;
    const uploadDraftKey = currentDraftKey();
    setAttachmentUploading(true);
    try {
      const results = await Promise.allSettled(files.map(async (file) => {
        const contentType = inferAttachmentContentType(file.name, file.type);
        const validationError = validateAssistantAttachmentDetails(
          file.name,
          contentType,
          file.size
        );
        if (validationError) throw new Error(validationError);
        const metadata = await buildPostAttachmentMetadata(file, contentType);
        return uploadConfirmedAttachment({
          actorHandle,
          file,
          idempotencyKey: createClientMutationId("assistant-attachment"),
          metadata: { ...metadata, surface: "assistant" },
          ownerType: "assistant_message"
        });
      }));
      const uploaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const existing = attachmentDraftsRef.current.get(uploadDraftKey) ?? [];
      const next = [...existing, ...uploaded].slice(0, attachmentCapacity);
      attachmentDraftsRef.current.set(uploadDraftKey, next);
      if (uploadDraftKey === currentDraftKey()) setPendingAttachments(next);

      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failures.length) {
        const first = failures[0]!.reason;
        const detail = first instanceof Error ? first.message : "A file could not be uploaded.";
        setError(failures.length === 1
          ? detail
          : `${failures.length} files could not be uploaded. ${detail}`);
      }
    } finally {
      setAttachmentUploading(false);
    }
  }, [
    actorHandle,
    attachmentCapacity,
    attachmentUploading,
    busy,
    contextBusy,
    currentDraftKey,
    pendingAttachments.length,
    thread?.archivedAt,
    threadLoading,
    visionAttachmentCapacity
  ]);

  const removePendingAttachment = useCallback((
    attachment: InquiryAttachmentContract
  ) => {
    const key = currentDraftKey();
    const next = pendingAttachments.filter((candidate) => candidate.id !== attachment.id);
    attachmentDraftsRef.current.set(key, next);
    setPendingAttachments(next);
    setError("");
    void discardAssistantAttachment(attachment.id, actorHandle).catch((caught) => {
      setError(errorMessage(
        caught,
        "The unsent file was removed here, but storage cleanup could not be confirmed."
      ));
    });
  }, [actorHandle, currentDraftKey, pendingAttachments]);

  const submit = useCallback(async () => {
    const message = draft.trim() || (pendingAttachments.length === 1
      ? "Review the attached file."
      : "Review the attached files.");
    if (
      (!draft.trim() && !pendingAttachments.length) ||
      Boolean(thread?.archivedAt) ||
      busy ||
      contextBusy ||
      attachmentUploading ||
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
    const id = conversationIdRef.current;
    const activeSource = id
      ? thread?.sources.find((source) => source.id === thread.activeSourceId)
      : null;
    const selectedContext = id
      ? activeSource?.context ?? null
      : newThreadContextModeRef.current === "current"
        ? contextRef.current
        : null;
    const detectedIntent = assistantRequestIntentFor(message);
    if (pendingAttachments.length && detectedIntent.translationRequested) {
      setError("Whole-file translation is paused in this limited beta. Ask for a summary or explanation instead; page translation remains available from an opened Symposium document page.");
      return;
    }
    const requestIntent: ReturnType<typeof assistantRequestIntentFor> = selectedContext
      ? detectedIntent
      : { translationRequested: false, intent: "answer" as const };
    if (selectedContext && requestIntent.translationRequested && !requestIntent.targetLanguage) {
      setError("Name a supported target language in your translation request.");
      return;
    }
    const optimisticId = createClientMutationId("assistant-user");
    const optimistic: AssistantMessageView = {
      id: optimisticId,
      role: "user",
      body: message,
      attachments: pendingAttachments
    };
    const submittedAttachments = pendingAttachments;
    const submittedAttachmentIds = submittedAttachments.map((attachment) => attachment.id);
    const draftKey = currentDraftKey();
    const submissionThreadRequest = threadRequestRef.current;
    const ownsSubmissionSurface = () =>
      threadRequestRef.current === submissionThreadRequest;
    const fingerprint = JSON.stringify({
      id,
      message,
      selectedContext,
      attachmentIds: submittedAttachmentIds
    });
    if (messageRetryRef.current?.fingerprint !== fingerprint) {
      messageRetryRef.current = {
        fingerprint,
        key: createClientMutationId("assistant-message")
      };
    }
    submissionLockRef.current = true;
    setMessages((current) => [...current, optimistic]);
    rememberDraft("");
    attachmentDraftsRef.current.set(draftKey, []);
    setPendingAttachments([]);
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
            attachmentIds: submittedAttachmentIds,
            intent: requestIntent.intent,
            ...(requestIntent.targetLanguage
              ? { targetLanguage: requestIntent.targetLanguage }
              : {}),
            contextType: selectedContext ? contextTypeFor(selectedContext.surface) : "general",
            contextId: selectedContext?.entityId,
            context: selectedContext
          }
        }
      );
      if (response.status === "discarded") {
        if (ownsSubmissionSurface()) {
          setMessages((current) => current.filter(
            (candidate) => candidate.id !== optimisticId
          ));
          rememberDraft("");
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
        if (ownsSubmissionSurface()) setError(response.message.body);
        messageRetryRef.current = null;
        await refreshThreads({ silent: true }).catch(() => null);
        return;
      }
      if (response.status === "disabled" || response.status === "provider_not_configured") {
        draftsRef.current.set(draftKey, message);
        attachmentDraftsRef.current.set(draftKey, submittedAttachments);
        if (ownsSubmissionSurface()) {
          setMessages((current) => current.filter(
            (candidate) => candidate.id !== optimisticId
          ));
          draftRef.current = message;
          setDraftState(message);
          setPendingAttachments(submittedAttachments);
          setError(response.message.body);
        }
        return;
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
      if (!ownsSubmissionSurface()) {
        messageRetryRef.current = null;
        broadcastThreadChange(response.conversationId);
        await refreshThreads({ silent: true }).catch(() => null);
        return;
      }
      explicitNewThreadRef.current = false;
      suppressedRequestedConversationIdRef.current = null;
      setConversationId(response.conversationId);
      loadedConversationIdRef.current = response.conversationId;
      if (response.thread) {
        setThread(response.thread);
        replaceThreadSummary(response.thread);
      }
      setMessages((current) => [
        ...current.filter((candidate) => candidate.id !== optimisticId),
        response.userMessage ?? optimistic,
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
      draftsRef.current.set(draftKey, message);
      attachmentDraftsRef.current.set(draftKey, submittedAttachments);
      if (ownsSubmissionSurface()) {
        setMessages((current) => current.filter(
          (candidate) => candidate.id !== optimisticId
        ));
        draftRef.current = message;
        setDraftState(message);
        setPendingAttachments(submittedAttachments);
        setError(errorMessage(caught, "The AI Tablet could not complete this request."));
      }
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }, [
    actorHandle,
    attachmentUploading,
    broadcastThreadChange,
    busy,
    contextBusy,
    currentDraftKey,
    draft,
    pendingAttachments,
    providerConfigured,
    providerEnabled,
    quotaLoading,
    remainingToday,
    rememberDraft,
    refreshThreads,
    replaceThreadSummary,
    setConversationId,
    thread,
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
    activeContext: conversationId
      ? thread?.sources.find((source) => source.id === thread.activeSourceId)?.context ?? null
      : newThreadContextMode === "current"
        ? context
        : null,
    newThreadContextMode,
    contextKey,
    conversationId,
    thread,
    threads,
    nextCursor,
    threadSearch,
    threadLibraryStatus,
    threadListLoading,
    threadListLoadingMore,
    threadActionBusyId,
    messages,
    draft,
    pendingAttachments,
    attachmentUploading,
    attachmentCapacity,
    visionAttachmentCapacity,
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
    uploadAssistantFiles,
    removePendingAttachment,
    openThread,
    startNewThread,
    setThreadLibraryFilters,
    loadMoreThreads,
    updateThreadDetails,
    deleteThread,
    useCurrentView,
    clearContext,
    refreshThreads,
    refreshSelectedThread,
    changeThreadContext,
    changeSavedSource,
    synchronizeThreadMutation,
    submit
  };
}

export type AssistantController = ReturnType<typeof useAssistantController>;
