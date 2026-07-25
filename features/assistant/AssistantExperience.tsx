"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, FileClock, Folder, FolderPlus, History, Languages, Link2, LoaderCircle, Maximize2, Minimize2, Plus, RefreshCw, Save, Search, Send, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import type {
  AssistantQuickNoteResultContract,
  AssistantQuickNoteContract,
  AssistantThreadSourceContract,
  AssistantThreadStateContract,
  AssistantTranslationContract,
  AssistantTranslationLanguageContract
} from "@/packages/contracts/src";
import { assistantTranslationLanguageLabels } from "@/packages/contracts/src/translationLanguages";
import type { ScribbleSnapshot } from "@/lib/workspaceTypes";
import type { AssistantContext, AssistantController } from "@/features/assistant/useAssistantController";

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
  const [newNotebookName, setNewNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
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

  const createNotebook = async () => {
    const name = newNotebookName.trim();
    if (!name || creatingNotebook || saved) return;
    setCreatingNotebook(true);
    setError("");
    try {
      const result = await symposiumApi.request<{ notebook: ScribbleSnapshot["notebooks"][number] }>("/api/workspace/notebooks", {
        method: "POST",
        idempotencyKey: createClientMutationId("assistant-notebook"),
        body: { actorHandle, name }
      });
      setNotebooks((current) => [result.notebook, ...current.filter((notebook) => notebook.id !== result.notebook.id)]);
      setNotebookId(result.notebook.id);
      setNewNotebookName("");
      window.dispatchEvent(new Event("symposium-workspace-change"));
    } catch (caught) {
      setError(caught instanceof SymposiumApiError ? caught.message : "The Office notebook could not be created.");
    } finally {
      setCreatingNotebook(false);
    }
  };

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
        <div className="tablet-new-notebook">
          <input
            value={newNotebookName}
            maxLength={120}
            disabled={Boolean(saved) || creatingNotebook}
            onChange={(event) => setNewNotebookName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createNotebook();
              }
            }}
            placeholder="New notebook name"
            aria-label="New notebook name"
          />
          <button type="button" disabled={Boolean(saved) || creatingNotebook || !newNotebookName.trim()} onClick={() => void createNotebook()}>
            {creatingNotebook ? <LoaderCircle className="spin" size={13} /> : <FolderPlus size={13} />}
            {creatingNotebook ? "Creating…" : "Create & select"}
          </button>
        </div>
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
    <section className="tablet-translation-card" aria-label={`${assistantTranslationLanguageLabels[translation.targetLanguage]} translation`}>
      <header>
        <span><Languages size={14} />{assistantTranslationLanguageLabels[translation.targetLanguage]} translation</span>
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

function ContextDock({
  context,
  thread,
  open,
  busy,
  onToggle,
  onContextChange,
  onSourceChange
}: {
  context: AssistantContext;
  thread: AssistantThreadStateContract | null;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onContextChange: (mode: "use" | "attach" | "refresh") => void;
  onSourceChange: (source: AssistantThreadSourceContract, action: "use" | "include" | "exclude") => void;
}) {
  const contextKey = `${context.surface}:${context.entityId ?? context.route}`;
  const latestCurrent = thread?.sources.filter((source) => source.key === contextKey).at(-1) ?? null;
  const activeSource = thread?.sources.find((source) => source.id === thread.activeSourceId) ?? null;
  const currentChanged = Boolean(latestCurrent && JSON.stringify(latestCurrent.context) !== JSON.stringify(context));
  const includedCount = thread?.sources.filter((source) => source.included).length ?? 0;
  const orderedSources = [...(thread?.sources ?? [])].reverse();

  return (
    <section className={`tablet-context-dock${open ? " open" : ""}`} aria-label="Context Dock">
      <button type="button" className="tablet-context-dock-heading" aria-expanded={open} onClick={onToggle}>
        <span>
          <BookOpen size={14} />
          <strong>Context Dock</strong>
          <small>{thread ? `${includedCount} included · ${thread.sourceRevisionCount} snapshot${thread.sourceRevisionCount === 1 ? "" : "s"}` : "Current view becomes the origin"}</small>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="tablet-context-dock-body">
          {!thread ? (
            <div className="tablet-context-empty">
              <strong>{context.title}</strong>
              <span>Sending the first message captures this view as the immutable thread origin. Opening and arranging context costs nothing.</span>
            </div>
          ) : (
            <>
              <div className={`tablet-live-context${thread.activeContextKey !== contextKey ? " changed" : ""}`}>
                <span>
                  <RefreshCw size={13} />
                  <strong>Live view</strong>
                  <small>{context.title}</small>
                </span>
                <p>
                  {!latestCurrent
                    ? "This view is not attached to the thread."
                    : currentChanged
                      ? `The live view has changed since saved revision ${latestCurrent.revision}.`
                      : latestCurrent.id === thread.activeSourceId
                        ? `Matches active revision ${latestCurrent.revision}.`
                        : `Saved as revision ${latestCurrent.revision}, but the thread is using ${activeSource?.context.title ?? "another source"}.`}
                </p>
                <div>
                  {!latestCurrent ? (
                    <>
                      <button type="button" disabled={busy || includedCount >= 5} onClick={() => onContextChange("attach")}>
                        <Link2 size={12} />Add source
                      </button>
                      <button type="button" disabled={busy} onClick={() => onContextChange("use")}>Use live view</button>
                    </>
                  ) : currentChanged ? (
                    <button type="button" disabled={busy} onClick={() => onContextChange("refresh")}>
                      <FileClock size={12} />Capture update
                    </button>
                  ) : latestCurrent.id !== thread.activeSourceId ? (
                    <button type="button" disabled={busy} onClick={() => onContextChange("use")}>Use live view</button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => onContextChange("refresh")}>
                      <FileClock size={12} />Save new revision
                    </button>
                  )}
                </div>
              </div>
              <div className="tablet-source-list" aria-label="Saved source revisions">
                {orderedSources.map((source) => {
                  const active = source.id === thread.activeSourceId;
                  const origin = source.id === thread.originSourceId;
                  return (
                    <article className={`${active ? "active " : ""}${source.included ? "included" : "excluded"}`} key={source.id}>
                      <div>
                        <span>
                          {active ? <strong>Active</strong> : null}
                          {origin ? <em>Origin</em> : null}
                          <small>{source.context.surface} · v{source.revision}</small>
                        </span>
                        <h4>{source.context.title}</h4>
                        <p>{source.context.summary || source.context.route}</p>
                      </div>
                      <div className="tablet-source-actions">
                        {!active ? (
                          <button type="button" disabled={busy} onClick={() => onSourceChange(source, "use")}>Use</button>
                        ) : null}
                        <button
                          type="button"
                          className={source.included ? "included" : ""}
                          disabled={busy || active || (!source.included && includedCount >= 5)}
                          title={active ? "The active source is always included" : source.included ? "Exclude from future answers" : "Include in future answers"}
                          aria-pressed={source.included}
                          onClick={() => onSourceChange(source, source.included ? "exclude" : "include")}
                        >
                          {source.included ? <Eye size={12} /> : <EyeOff size={12} />}
                          {source.included ? "Included" : "Excluded"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export type AssistantExperienceMode = "compact" | "workspace";

export function AssistantExperience({
  controller,
  mode,
  onClose,
  onExpand,
  onCollapse
}: {
  controller: AssistantController;
  mode: AssistantExperienceMode;
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const {
    actorHandle,
    context,
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
    setDraft,
    openThread,
    startNewThread,
    changeThreadContext,
    changeSavedSource,
    submit
  } = controller;
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [contextDockOpen, setContextDockOpen] = useState(true);
  const [threadQuery, setThreadQuery] = useState("");
  const [mobilePane, setMobilePane] = useState<"threads" | "chat" | "context">("chat");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const filteredThreads = useMemo(() => {
    const query = threadQuery.trim().toLocaleLowerCase();
    if (!query) return threads;
    return threads.filter((candidate) =>
      candidate.title.toLocaleLowerCase().includes(query)
    );
  }, [threadQuery, threads]);

  const selectThread = (id: string) => {
    setThreadsOpen(false);
    setMobilePane("chat");
    void openThread(id);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, messages.length]);

  const submitForm = (event?: FormEvent) => {
    event?.preventDefault();
    void submit();
  };

  return (
    <section
      className={`assistant-experience ${
        mode === "compact"
          ? "tablet-panel assistant-compact"
          : "assistant-workspace"
      }`}
      data-assistant-mode={mode}
      data-mobile-pane={mobilePane}
      aria-label={mode === "workspace" ? "AI Workspace" : "AI Tablet"}
    >
      <header className="tablet-header assistant-header">
        <div>
          <span><BrainCircuit size={16} />{mode === "workspace" ? "AI Workspace" : "AI Tablet"}</span>
          <small>{mode === "workspace" ? "Research continuity · inspectable context · confirmed actions" : "Contextual answers · confirmed actions"}</small>
        </div>
        <div className="assistant-header-actions">
          {mode === "compact" ? (
            <button type="button" title="Expand to AI Workspace" onClick={onExpand}>
              <Maximize2 size={16} /><span>Expand</span>
            </button>
          ) : null}
          {mode === "workspace" ? (
            <button type="button" title="Collapse to AI Tablet" onClick={onCollapse}>
              <Minimize2 size={16} /><span>Tablet</span>
            </button>
          ) : null}
          {mode === "compact" ? (
            <button type="button" title="Close AI Tablet" onClick={onClose}>
              <X size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <nav className="assistant-mobile-nav" aria-label="AI Workspace panels">
        <button type="button" className={mobilePane === "threads" ? "active" : ""} onClick={() => setMobilePane("threads")}>
          <History size={14} />Threads
        </button>
        <button type="button" className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}>
          <BrainCircuit size={14} />Chat
        </button>
        <button type="button" className={mobilePane === "context" ? "active" : ""} onClick={() => setMobilePane("context")}>
          <BookOpen size={14} />Context
        </button>
      </nav>

      <aside className="assistant-left" aria-label="Research Threads">
        <section className="tablet-thread-bar" aria-label="Research thread controls">
          <button
            type="button"
            className="tablet-thread-current"
            aria-expanded={mode === "compact" ? threadsOpen : true}
            onClick={() => {
              if (mode === "compact") setThreadsOpen((open) => !open);
            }}
          >
            <History size={14} />
            <span>
              <strong>{thread?.title ?? "New research thread"}</strong>
              <small>{thread ? `${thread.sourceCount} source${thread.sourceCount === 1 ? "" : "s"} · saved history` : "Starts when you send"}</small>
            </span>
          </button>
          <button
            type="button"
            title="Start a new research thread"
            onClick={() => {
              startNewThread();
              setThreadsOpen(false);
              setMobilePane("chat");
            }}
          >
            <Plus size={15} />
          </button>
          {mode === "compact" && threadsOpen ? (
          <div className="tablet-thread-menu">
            {threads.length ? threads.map((candidate) => (
              <button
                type="button"
                className={candidate.id === conversationId ? "active" : undefined}
                key={candidate.id}
                onClick={() => selectThread(candidate.id)}
              >
                <strong>{candidate.title}</strong>
                <small>{candidate.sourceCount} source{candidate.sourceCount === 1 ? "" : "s"} · {new Date(candidate.updatedAt).toLocaleDateString()}</small>
              </button>
            )) : <p>No saved research threads yet.</p>}
          </div>
          ) : null}
        </section>
        <div className="assistant-thread-search">
          <Search size={14} />
          <input
            type="search"
            value={threadQuery}
            onChange={(event) => setThreadQuery(event.target.value)}
            placeholder="Search recent threads"
            aria-label="Search recent Research Threads"
          />
        </div>
        <div className="assistant-thread-list">
          {filteredThreads.length ? filteredThreads.map((candidate) => (
            <button
              type="button"
              className={candidate.id === conversationId ? "active" : undefined}
              aria-current={candidate.id === conversationId ? "page" : undefined}
              key={candidate.id}
              onClick={() => selectThread(candidate.id)}
            >
              <strong>{candidate.title}</strong>
              <span>{candidate.sourceCount} source{candidate.sourceCount === 1 ? "" : "s"}</span>
              <time dateTime={candidate.updatedAt}>{new Date(candidate.updatedAt).toLocaleDateString()}</time>
            </button>
          )) : (
            <p>{threadQuery.trim() ? "No recent threads match this search." : "No saved Research Threads yet."}</p>
          )}
          {nextCursor ? <small>Showing the 50 most recently updated threads.</small> : null}
        </div>
      </aside>

      <section className="assistant-center" aria-label="Active Research Thread">
        <section className="tablet-limit-notice" aria-label="AI usage limits">
          <AlertTriangle size={15} />
          <div>
            <strong>Extremely limited beta</strong>
            <span>{quotaLoading ? "Loading today’s tiny AI allowance…" : `Only ${remainingToday} of ${dailyLimit} answers left today. Capacity is shared and AI stops at the daily or $${monthlyBudgetUsd} monthly app cap.`}</span>
          </div>
        </section>

        <div className="tablet-transcript" aria-live="polite" ref={transcriptRef}>
          {threadLoading ? <article className="tablet-message assistant pending"><span>Tablet</span><p>Loading research threads…</p></article> : null}
          {messages.map((message) => (
            <article
              className={`tablet-message ${message.role}${message.translation ? " has-translation" : ""}`}
              data-assistant-message-id={message.id}
              key={message.id}
            >
              <span>{message.role === "assistant" ? "Tablet" : message.role === "system" ? "Context" : "You"}</span>
              <p>{message.body}</p>
              {message.role === "assistant" && message.evidence?.length ? (
                <details className="tablet-message-evidence">
                  <summary><BookOpen size={12} />Used {message.evidence.length} source{message.evidence.length === 1 ? "" : "s"}</summary>
                  <div>
                    {message.evidence.map((source) => (
                      <span className={source.active ? "active" : ""} key={source.sourceId}>
                        {source.active ? "Active · " : ""}{source.title} · v{source.revision}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}
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
        <form className="tablet-composer" onSubmit={submitForm}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitForm();
              }
            }}
            maxLength={2000}
            rows={mode === "workspace" ? 3 : 2}
            placeholder={quotaLoading ? "Loading AI allowance" : remainingToday > 0 ? "Ask about this view" : "Daily AI limit reached"}
            disabled={busy || contextBusy || threadLoading || quotaLoading || remainingToday <= 0 || !providerEnabled || !providerConfigured}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || contextBusy || threadLoading || quotaLoading || !draft.trim() || remainingToday <= 0 || !providerEnabled || !providerConfigured}
            title="Send one limited AI request"
          >
            <Send size={15} /><span>Send · uses 1</span>
          </button>
        </form>
      </section>

      <aside className="assistant-right" aria-label="Thread context">
        <ContextDock
          context={context}
          thread={thread}
          open={contextDockOpen}
          busy={busy || contextBusy}
          onToggle={() => setContextDockOpen((current) => !current)}
          onContextChange={(change) => void changeThreadContext(change)}
          onSourceChange={(source, action) => void changeSavedSource(source, action)}
        />
      </aside>
    </section>
  );
}
