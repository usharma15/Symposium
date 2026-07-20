"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, ExternalLink, Languages, LoaderCircle, Save, Send, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import type {
  AssistantQuickNoteResultContract,
  AssistantMessageInputContract,
  AssistantQuotaStatusContract,
  AssistantResponseContract,
  AssistantTranslationContract,
  AssistantTranslationLanguageContract
} from "@/packages/contracts/src";

type TabletContext = AssistantMessageInputContract["context"];
type TabletMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  conversationId?: string;
  translation?: AssistantTranslationContract;
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
  const [title, setTitle] = useState(translation.quickNoteTitle);
  const [body, setBody] = useState(translation.quickNoteBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AssistantQuickNoteResultContract | null>(null);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const saveQuickNote = async () => {
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();
    if (!normalizedTitle || !normalizedBody || saving || saved) return;
    const fingerprint = `${normalizedTitle}\n${normalizedBody}`;
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
          targetLanguage: translation.targetLanguage,
          source: translation.source
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
    <section className="tablet-translation-card" aria-label={`${translationLanguageLabels[translation.targetLanguage]} translation`}>
      <header>
        <span><Languages size={14} />{translationLanguageLabels[translation.targetLanguage]} translation</span>
        <small>Derived from {translation.source.title}</small>
      </header>
      <div className="tablet-translation-copy">
        <strong>{translation.translatedTitle}</strong>
        <p>{translation.translatedBody}</p>
      </div>
      <div className="tablet-quick-note-draft">
        <span>Private Quick Note · review before saving</span>
        <label>
          <small>Title</small>
          <input value={title} maxLength={240} disabled={Boolean(saved)} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <small>Note</small>
          <textarea value={body} maxLength={8000} rows={5} disabled={Boolean(saved)} onChange={(event) => setBody(event.target.value)} />
        </label>
        {error ? <p className="tablet-action-error" role="alert">{error}</p> : null}
        {saved ? (
          <a className="tablet-note-saved" href={saved.href}>
            <CheckCircle2 size={14} />Saved as “{saved.title}”<ExternalLink size={13} />
          </a>
        ) : (
          <button type="button" className="primary" disabled={saving || !title.trim() || !body.trim()} onClick={() => void saveQuickNote()}>
            {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {saving ? "Saving private note…" : "Confirm & save Quick Note"}
          </button>
        )}
      </div>
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
  const [dailyLimit, setDailyLimit] = useState(3);
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
      setMessages((current) => [...current, {
        id: response.message.id,
        role: "assistant",
        body: response.message.body,
        conversationId: response.conversationId,
        translation: response.translation
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
