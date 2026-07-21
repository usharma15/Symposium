"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, ExternalLink, Folder, Languages, LoaderCircle, Save, Send, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import type {
  AssistantQuickNoteResultContract,
  AssistantQuickNoteContract,
  AssistantMessageInputContract,
  AssistantQuotaStatusContract,
  AssistantResponseContract,
  AssistantTranslationContract,
  AssistantTranslationLanguageContract
} from "@/packages/contracts/src";
import type { ScribbleSnapshot } from "@/lib/workspaceTypes";

type TabletContext = AssistantMessageInputContract["context"];
type TabletMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  conversationId?: string;
  translation?: AssistantTranslationContract;
  quickNote?: AssistantQuickNoteContract;
};

const translationLanguageLabels: Record<AssistantTranslationLanguageContract, string> = {
  english: "English",
  french: "French",
  german: "German",
  spanish: "Spanish"
};

const initialMessage = (context: TabletContext): TabletMessage => ({
  id: `intro:${context.surface}:${context.entityId ?? context.route}`,
  role: "assistant",
  body: `I’m looking at ${context.title}. Ask me about what is actually on this screen.`
});

const contextType = (surface: TabletContext["surface"]): AssistantMessageInputContract["contextType"] => {
  if (surface === "post" || surface === "opportunity" || surface === "attachment") return "post";
  if (surface === "community") return "community";
  if (surface === "workspace") return "note";
  if (surface === "room") return "room";
  return "general";
};

function QuickNoteDraftCard({
  actorHandle,
  conversationId,
  messageId,
  quickNote,
  targetLanguage
}: {
  actorHandle: string;
  conversationId: string;
  messageId: string;
  quickNote: AssistantQuickNoteContract;
  targetLanguage?: AssistantTranslationLanguageContract;
}) {
  const [title, setTitle] = useState(quickNote.title);
  const [body, setBody] = useState(quickNote.body);
  const [notebooks, setNotebooks] = useState<ScribbleSnapshot["notebooks"]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [notebooksLoading, setNotebooksLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AssistantQuickNoteResultContract | null>(null);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNotebooksLoading(true);
    void symposiumApi.request<ScribbleSnapshot>(
      `/api/workspace/scribble?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    ).then((snapshot) => {
      if (!cancelled) setNotebooks(snapshot.notebooks);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof SymposiumApiError ? caught.message : "Your Office notebooks could not be loaded.");
    }).finally(() => {
      if (!cancelled) setNotebooksLoading(false);
    });
    return () => { cancelled = true; };
  }, [actorHandle]);

  const saveQuickNote = async () => {
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();
    if (!normalizedTitle || !normalizedBody || saving || saved) return;
    const fingerprint = `${notebookId}\n${normalizedTitle}\n${normalizedBody}`;
    if (retryRef.current?.fingerprint !== fingerprint) {
      retryRef.current = { fingerprint, key: createClientMutationId("assistant-quick-note") };
    }
    setSaving(true);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantQuickNoteResultContract>("/api/assistant/quick-notes", {
        method: "POST",
        idempotencyKey: retryRef.current.key,
        body: {
          actorHandle,
          assistantMessageId: messageId,
          conversationId,
          title: normalizedTitle,
          body: normalizedBody,
          notebookId: notebookId || null,
          ...(targetLanguage ? { targetLanguage } : {}),
          source: quickNote.source
        }
      });
      setSaved(result);
      window.dispatchEvent(new Event("symposium-workspace-change"));
    } catch (caught) {
      setError(caught instanceof SymposiumApiError ? caught.message : "The Quick Note could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tablet-quick-note-draft" aria-label="Quick Note draft">
        <span>Private Quick Note · review, choose a notebook, then save</span>
        <label>
          <small>Title</small>
          <input value={title} maxLength={240} disabled={Boolean(saved)} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <small>Note</small>
          <textarea value={body} maxLength={8000} rows={5} disabled={Boolean(saved)} onChange={(event) => setBody(event.target.value)} />
        </label>
        <label>
          <small><Folder size={12} />Office destination</small>
          <select value={notebookId} disabled={Boolean(saved) || notebooksLoading} onChange={(event) => setNotebookId(event.target.value)}>
            <option value="">All · Quick Notes</option>
            {notebooks.map((notebook) => <option value={notebook.id} key={notebook.id}>{notebook.name}</option>)}
          </select>
        </label>
        {error ? <p className="tablet-action-error" role="alert">{error}</p> : null}
        {saved ? (
          <a className="tablet-note-saved" href={saved.href}>
            <CheckCircle2 size={14} />Saved to {saved.notebookName ?? "All · Quick Notes"}<ExternalLink size={13} />
          </a>
        ) : (
          <button type="button" className="primary" disabled={saving || !title.trim() || !body.trim()} onClick={() => void saveQuickNote()}>
            {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {saving ? "Saving private note…" : "Confirm & save Quick Note"}
          </button>
        )}
    </div>
  );
}

function TranslationCard({
  actorHandle,
  conversationId,
  messageId,
  translation
}: {
  actorHandle: string;
  conversationId: string;
  messageId: string;
  translation: AssistantTranslationContract;
}) {
  return (
    <section className="tablet-translation-card" aria-label={`${translationLanguageLabels[translation.targetLanguage]} translation`}>
      <header>
        <span><Languages size={14} />{translationLanguageLabels[translation.targetLanguage]} translation</span>
        <small>Derived from {translation.source.title}</small>
      </header>
      <div className="tablet-translation-copy">
        <strong>{translation.translatedTitle}</strong>
        <p>{translation.translatedBody}</p>
      </div>
      <QuickNoteDraftCard
        actorHandle={actorHandle}
        conversationId={conversationId}
        messageId={messageId}
        quickNote={{ title: translation.quickNoteTitle, body: translation.quickNoteBody, source: translation.source }}
        targetLanguage={translation.targetLanguage}
      />
    </section>
  );
}

export function TabletPanel({
  actorHandle,
  context,
  onClose
}: {
  actorHandle: string;
  context: TabletContext;
  onClose: () => void;
}) {
  const contextKey = `${context.surface}:${context.entityId ?? context.route}`;
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<TabletMessage[]>(() => [initialMessage(context)]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(10);
  const [remainingToday, setRemainingToday] = useState(0);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(40);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setQuotaLoading(true);
    setError("");
    void symposiumApi.request<AssistantQuotaStatusContract>("/api/assistant/quota", { cache: "no-store" })
      .then((status) => {
        if (cancelled) return;
        setDailyLimit(status.quota.dailyLimit);
        setRemainingToday(status.quota.remainingToday);
        setMonthlyBudgetUsd(status.quota.monthlyBudgetUsd);
        if (!status.enabled) setError("The AI Tablet is currently switched off.");
        else if (!status.providerConfigured) setError("The AI Tablet model provider is not configured.");
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof SymposiumApiError ? caught.message : "The current AI allowance could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setQuotaLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

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
    setConversationId(undefined);
    setMessages([initialMessage(context)]);
    setDraft("");
    setError("");
  }, [contextKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, messages.length]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || busy || quotaLoading || remainingToday <= 0) return;
    const userMessage: TabletMessage = {
      id: createClientMutationId("assistant-user"),
      role: "user",
      body: message
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await symposiumApi.request<AssistantResponseContract>("/api/assistant/messages", {
        method: "POST",
        idempotencyKey: createClientMutationId("assistant-message"),
        body: {
          actorHandle,
          conversationId,
          message,
          contextType: contextType(context.surface),
          contextId: context.entityId,
          context
        }
      });
      setConversationId(response.conversationId);
      setRemainingToday(response.quota?.remainingToday ?? Math.max(0, remainingToday - 1));
      if (response.quota) {
        window.dispatchEvent(new CustomEvent("symposium-ai-quota-change", { detail: response.quota }));
      }
      setMessages((current) => [...current, {
        id: response.message.id,
        role: "assistant",
        body: response.message.body,
        conversationId: response.conversationId,
        translation: response.translation,
        quickNote: response.quickNote
      }]);
    } catch (caught) {
      const message = caught instanceof SymposiumApiError
        ? caught.message
        : "The AI Tablet could not complete this request.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="tablet-panel" aria-label="AI Tablet">
      <header className="tablet-header">
        <div>
          <span><BrainCircuit size={16} />AI Tablet</span>
          <small>Contextual answers · confirmed actions</small>
        </div>
        <button type="button" title="Close AI Tablet" onClick={onClose}><X size={16} /></button>
      </header>

      <section className="tablet-limit-notice" aria-label="AI usage limits">
        <AlertTriangle size={15} />
        <div>
          <strong>Extremely limited beta</strong>
          <span>{quotaLoading ? "Loading today’s tiny AI allowance…" : `Only ${remainingToday} of ${dailyLimit} answers left today. Capacity is shared and AI stops at the daily or $${monthlyBudgetUsd} monthly app cap.`}</span>
        </div>
      </section>

      <div className="tablet-transcript" aria-live="polite" ref={transcriptRef}>
        {messages.map((message) => (
          <article className={`tablet-message ${message.role}${message.translation ? " has-translation" : ""}`} key={message.id}>
            <span>{message.role === "assistant" ? "Tablet" : "You"}</span>
            <p>{message.body}</p>
            {message.role === "assistant" && message.translation && message.conversationId ? (
              <TranslationCard
                actorHandle={actorHandle}
                conversationId={message.conversationId}
                messageId={message.id}
                translation={message.translation}
              />
            ) : null}
            {message.role === "assistant" && message.quickNote && message.conversationId ? (
              <QuickNoteDraftCard
                actorHandle={actorHandle}
                conversationId={message.conversationId}
                messageId={message.id}
                quickNote={message.quickNote}
              />
            ) : null}
          </article>
        ))}
        {busy ? <article className="tablet-message assistant pending"><span>Tablet</span><p>Reading this view and thinking…</p></article> : null}
      </div>

      {error ? <div className="tablet-error" role="alert">{error}</div> : null}
      <form className="tablet-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          maxLength={2000}
          rows={2}
          placeholder={quotaLoading ? "Loading AI allowance" : remainingToday > 0 ? "Ask about this view" : "Daily AI limit reached"}
          disabled={busy || quotaLoading || remainingToday <= 0}
        />
        <button type="submit" className="primary" disabled={busy || quotaLoading || !draft.trim() || remainingToday <= 0} title="Send one limited AI request">
          <Send size={15} /><span>Send · uses 1</span>
        </button>
      </form>
    </aside>
  );
}
