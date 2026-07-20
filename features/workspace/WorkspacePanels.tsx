"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, BrainCircuit, Send, Sparkles, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import type {
  AssistantMessageInputContract,
  AssistantQuotaStatusContract,
  AssistantResponseContract
} from "@/packages/contracts/src";

type TabletContext = AssistantMessageInputContract["context"];
type TabletMessage = { id: string; role: "user" | "assistant"; body: string };

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

  const prompts = useMemo(() => {
    if (context.surface === "post" || context.surface === "opportunity") {
      return ["What is the strongest unresolved objection?", "What should I verify next?", "Explain the core claim plainly."];
    }
    if (context.surface === "workspace") {
      return ["What is unclear in this draft?", "Find the weakest inference.", "What is the smallest useful next revision?"];
    }
    if (context.surface === "profile") {
      return ["Summarize this researcher’s focus.", "What work here is most relevant?", "What could I ask them?"];
    }
    return ["Summarize what I’m looking at.", "What deserves attention first?", "What is missing from this view?"];
  }, [context.surface]);

  const submit = async (event?: FormEvent, suggestedPrompt?: string) => {
    event?.preventDefault();
    const message = (suggestedPrompt ?? draft).trim();
    if (!message || busy || quotaLoading || remainingToday <= 0) return;
    const userMessage: TabletMessage = { id: createClientMutationId("assistant-user"), role: "user", body: message };
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
        body: response.message.body
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
          <small>Contextual, read-only assistant</small>
        </div>
        <button type="button" title="Close AI Tablet" onClick={onClose}><X size={16} /></button>
      </header>

      <section className="tablet-limit-notice" aria-label="AI usage limits">
        <AlertTriangle size={15} />
        <div>
          <strong>Extremely limited beta</strong>
          <span>{quotaLoading ? "Loading today’s tiny AI allowance…" : `Only ${remainingToday} of ${dailyLimit} answers left today. Capacity is shared and AI stops at the daily or $${monthlyBudgetUsd} monthly app cap.`}</span>
          <small>Opening and browsing cost nothing. Only Send shares this view with the model and uses an answer.</small>
        </div>
      </section>

      <section className="tablet-context-card">
        <span>Looking at now · {context.surface}</span>
        <strong>{context.title}</strong>
        {context.summary ? <p>{context.summary}</p> : null}
      </section>

      <div className="tablet-transcript" aria-live="polite">
        {messages.map((message) => (
          <article className={`tablet-message ${message.role}`} key={message.id}>
            <span>{message.role === "assistant" ? "Tablet" : "You"}</span>
            <p>{message.body}</p>
          </article>
        ))}
        {busy ? <article className="tablet-message assistant pending"><span>Tablet</span><p>Reading this view and thinking…</p></article> : null}
      </div>

      {messages.length === 1 ? <div className="tablet-prompts">
        {prompts.map((prompt) => (
          <button type="button" key={prompt} disabled={busy || quotaLoading || remainingToday <= 0} onClick={() => void submit(undefined, prompt)}>
            <Sparkles size={13} />{prompt}
          </button>
        ))}
      </div> : null}

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
          placeholder={quotaLoading ? "Loading AI allowance" : remainingToday > 0 ? "Ask about this exact view" : "Daily AI limit reached"}
          disabled={busy || quotaLoading || remainingToday <= 0}
        />
        <button type="submit" className="primary" disabled={busy || quotaLoading || !draft.trim() || remainingToday <= 0} title="Send one limited AI request">
          <Send size={15} /><span>Send · uses 1</span>
        </button>
      </form>
    </aside>
  );
}
