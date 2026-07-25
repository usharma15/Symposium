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
import { assistantThreadActivityLabel } from "@/features/assistant/assistantThreadOrdering";

function QuickNoteDraftCard({
  actorHandle,
  conversationId,
  messageId,
  quickNote,
  targetLanguage,
  savedQuickNote,
  onSaved
}: {
  actorHandle: string;
  conversationId: string;
  messageId: string;
  quickNote: AssistantQuickNoteContract;
  targetLanguage?: AssistantTranslationLanguageContract;
  savedQuickNote?: AssistantQuickNoteResultContract;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(quickNote.title);
  const [body, setBody] = useState(quickNote.body);
  const [notebooks, setNotebooks] = useState<ScribbleSnapshot["notebooks"]>([]);
  const [notebookId, setNotebookId] = useState(savedQuickNote?.notebookId ?? "");
  const [notebooksLoading, setNotebooksLoading] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AssistantQuickNoteResultContract | null>(savedQuickNote ?? null);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!savedQuickNote) return;
    setTitle(quickNote.title);
    setBody(quickNote.body);
    setNotebookId(savedQuickNote.notebookId ?? "");
    setSaved(savedQuickNote);
  }, [quickNote.body, quickNote.title, savedQuickNote]);

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
      onSaved();
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
  translation,
  savedQuickNote,
  onSaved
}: {
  actorHandle: string;
  conversationId: string;
  messageId: string;
  translation: AssistantTranslationContract;
  savedQuickNote?: AssistantQuickNoteResultContract;
  onSaved: () => void;
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
        savedQuickNote={savedQuickNote}
        onSaved={onSaved}
      />
    </section>
  );
}

function ContextDock({
  context,
  activeContext,
  thread,
  open,
  busy,
  onToggle,
  onUseCurrentView,
  onClearContext,
  onContextChange,
  onSourceChange
}: {
  context: AssistantContext;
  activeContext: AssistantContext | null;
  thread: AssistantThreadStateContract | null;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onUseCurrentView: () => void;
  onClearContext: () => void;
  onContextChange: (mode: "use" | "attach" | "refresh" | "clear") => void;
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
          <small>
            {thread
              ? activeContext
                ? `${includedCount} active · ${thread.sourceRevisionCount} saved`
                : `${thread.sourceRevisionCount} saved · none active`
              : activeContext
                ? "Current view ready"
                : "No context attached"}
          </small>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="tablet-context-dock-body">
          {!thread ? (
            <div className={`tablet-context-start${activeContext ? " attached" : ""}`}>
              <div>
                <span>{activeContext ? "Starting context" : "Blank chat"}</span>
                <strong>{activeContext?.title ?? "No context attached"}</strong>
                <small>
                  {activeContext
                    ? "This view will be captured when you send your first message."
                    : "Start with a question. You can attach this page whenever it becomes useful."}
                </small>
              </div>
              {activeContext ? (
                <button
                  type="button"
                  aria-label="Remove current view context"
                  title="Remove current view context"
                  disabled={busy}
                  onClick={onClearContext}
                >
                  <X size={14} />
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={onUseCurrentView}>
                  <Link2 size={13} />Use current view
                </button>
              )}
            </div>
          ) : (
            <>
              <div className={`tablet-context-status${activeSource ? " attached" : ""}`}>
                <div>
                  <span>{activeSource ? "Working context" : "Plain chat"}</span>
                  <strong>{activeSource?.context.title ?? "No context attached"}</strong>
                  <small>
                    {activeSource
                      ? "Answers can use this source and the included material below."
                      : "Answers use only this conversation and general knowledge."}
                  </small>
                </div>
                {activeSource ? (
                  <button
                    type="button"
                    aria-label="Clear active chat context"
                    title="Continue without explicit context"
                    disabled={busy}
                    onClick={onClearContext}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <div className={`tablet-live-context${thread.activeContextKey !== contextKey ? " changed" : ""}`}>
                <span>
                  <RefreshCw size={13} />
                  <strong>This page</strong>
                  <small>{context.title}</small>
                </span>
                <p>
                  {!latestCurrent
                    ? "This page is not saved in this chat."
                    : currentChanged
                      ? `This page changed since saved revision ${latestCurrent.revision}.`
                      : latestCurrent.id === thread.activeSourceId
                        ? `Using saved revision ${latestCurrent.revision}.`
                        : `Saved as revision ${latestCurrent.revision}, but not currently in use.`}
                </p>
                <div>
                  {!latestCurrent ? (
                    <>
                      {activeSource ? (
                        <button type="button" disabled={busy || includedCount >= 5} onClick={() => onContextChange("attach")}>
                          <Link2 size={12} />Add page
                        </button>
                      ) : null}
                      <button type="button" disabled={busy} onClick={() => onContextChange("use")}>Use this page</button>
                    </>
                  ) : currentChanged ? (
                    <button type="button" disabled={busy} onClick={() => onContextChange("refresh")}>
                      <FileClock size={12} />Capture update
                    </button>
                  ) : latestCurrent.id !== thread.activeSourceId ? (
                    <button type="button" disabled={busy} onClick={() => onContextChange("use")}>Use this page</button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => onContextChange("refresh")}>
                      <FileClock size={12} />Save new revision
                    </button>
                  )}
                </div>
              </div>
              {orderedSources.length ? <div className="tablet-source-list" aria-label="Saved source revisions">
                {orderedSources.map((source) => {
                  const active = source.id === thread.activeSourceId;
                  const origin = source.id === thread.originSourceId;
                  const storedMetadata = Object.entries(source.context.metadata);
                  const sourceRoute = source.context.route.startsWith("/") ? source.context.route : "/";
                  return (
                    <article className={`${active ? "active " : ""}${source.included ? "included" : "excluded"}`} key={source.id}>
                      <div>
                        <span>
                          {active ? <strong>Active</strong> : null}
                          {origin ? <em>Origin</em> : null}
                          {source.provenance === "recovered" ? <em>Recovered</em> : null}
                          <small>{source.context.surface} · v{source.revision}</small>
                        </span>
                        <h4>{source.context.title}</h4>
                        <p>{source.context.summary || source.context.route}</p>
                        <div className="tablet-source-links">
                          <a href={sourceRoute} target="_blank" rel="noreferrer">
                            <ExternalLink size={11} />Open source
                          </a>
                          <time dateTime={source.attachedAt}>
                            Captured {new Date(source.attachedAt).toLocaleString()}
                          </time>
                        </div>
                        <details className="tablet-source-inspector">
                          <summary>Inspect saved context</summary>
                          <dl>
                            <div><dt>Surface</dt><dd>{source.context.surface}</dd></div>
                            <div><dt>Route</dt><dd>{source.context.route || "/"}</dd></div>
                            {source.context.entityType ? <div><dt>Entity type</dt><dd>{source.context.entityType}</dd></div> : null}
                            {source.context.entityId ? <div><dt>Entity ID</dt><dd>{source.context.entityId}</dd></div> : null}
                          </dl>
                          {source.context.summary ? (
                            <section>
                              <strong>Stored summary</strong>
                              <p>{source.context.summary}</p>
                            </section>
                          ) : null}
                          {source.context.selection ? (
                            <section>
                              <strong>Stored selection</strong>
                              <pre>{source.context.selection}</pre>
                            </section>
                          ) : null}
                          {source.context.content ? (
                            <section>
                              <strong>Stored source text</strong>
                              <pre>{source.context.content}</pre>
                            </section>
                          ) : null}
                          {storedMetadata.length ? (
                            <section>
                              <strong>Stored metadata</strong>
                              <dl>
                                {storedMetadata.map(([key, value]) => (
                                  <div key={key}><dt>{key}</dt><dd>{value === null ? "null" : String(value)}</dd></div>
                                ))}
                              </dl>
                            </section>
                          ) : null}
                        </details>
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
              </div> : null}
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
    activeContext,
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
    useCurrentView,
    clearContext,
    changeThreadContext,
    changeSavedSource,
    synchronizeThreadMutation,
    submit
  } = controller;
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [contextDockOpen, setContextDockOpen] = useState(mode === "workspace");
  const [threadQuery, setThreadQuery] = useState("");
  const [mobilePane, setMobilePane] = useState<"threads" | "chat" | "context">("chat");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const previousModeRef = useRef(mode);

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
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    setContextDockOpen(mode === "workspace");
  }, [mode]);

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
          <small>{mode === "workspace" ? "Conversations with inspectable working context" : "Ask anything · add Symposium context when useful"}</small>
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
        <button type="button" aria-pressed={mobilePane === "threads"} className={mobilePane === "threads" ? "active" : ""} onClick={() => setMobilePane("threads")}>
          <History size={14} />Chats
        </button>
        <button type="button" aria-pressed={mobilePane === "chat"} className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}>
          <BrainCircuit size={14} />Chat
        </button>
        <button type="button" aria-pressed={mobilePane === "context"} className={mobilePane === "context" ? "active" : ""} onClick={() => setMobilePane("context")}>
          <BookOpen size={14} />Context
        </button>
      </nav>

      <aside className="assistant-left" aria-label="Chats">
        <section className="tablet-thread-bar" aria-label="Chat controls">
          {mode === "compact" ? (
            <button
              type="button"
              className="tablet-thread-current"
              aria-expanded={threadsOpen}
              onClick={() => setThreadsOpen((open) => !open)}
            >
              <History size={14} />
              <span>
                <strong>{thread?.title ?? "New chat"}</strong>
                <small>{thread ? `${thread.sourceCount} active source${thread.sourceCount === 1 ? "" : "s"}` : activeContext ? "Current view ready" : "No context attached"}</small>
              </span>
            </button>
          ) : (
            <div className="tablet-thread-current" aria-label="Current research thread">
              <History size={14} />
              <span>
                <strong>{thread?.title ?? "New chat"}</strong>
                <small>{thread ? `${thread.sourceCount} active source${thread.sourceCount === 1 ? "" : "s"}` : activeContext ? "Current view ready" : "No context attached"}</small>
              </span>
            </div>
          )}
          <button
            type="button"
            className="tablet-new-chat"
            aria-label="Start a new blank chat"
            title="Start a new blank chat"
            onClick={() => {
              startNewThread("blank");
              setThreadsOpen(false);
              setMobilePane("chat");
            }}
          >
            <Plus size={15} /><span>New chat</span>
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
                <small>{candidate.sourceCount} source{candidate.sourceCount === 1 ? "" : "s"} · {assistantThreadActivityLabel(candidate.lastMessageAt)}</small>
              </button>
            )) : <p>No saved chats yet.</p>}
          </div>
          ) : null}
        </section>
        <div className="assistant-thread-search">
          <Search size={14} />
          <input
            type="search"
            value={threadQuery}
            onChange={(event) => setThreadQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
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
              <time dateTime={candidate.lastMessageAt}>{assistantThreadActivityLabel(candidate.lastMessageAt)}</time>
            </button>
          )) : (
            <p>{threadQuery.trim() ? "No chats match this search." : "No saved chats yet."}</p>
          )}
          {nextCursor ? <small>Showing the 50 most recently chatted threads.</small> : null}
        </div>
      </aside>

      <section className="assistant-center" aria-label="Chat">
        <section className="tablet-limit-notice" aria-label="AI usage limits">
          <AlertTriangle size={13} />
          <strong>Limited beta</strong>
          <span>{quotaLoading ? "Loading allowance…" : `${remainingToday} of ${dailyLimit} answers left today · shared $${monthlyBudgetUsd} monthly cap`}</span>
        </section>

        <div className={`tablet-active-context${activeContext ? " attached" : ""}`} aria-label="Chat context">
          <span>
            <BookOpen size={13} />
            <small>{activeContext ? "Using context" : "Plain chat"}</small>
            <strong>{activeContext?.title ?? "No Symposium context"}</strong>
          </span>
          {activeContext ? (
            <button
              type="button"
              aria-label="Remove chat context"
              title="Continue without explicit context"
              disabled={busy || contextBusy}
              onClick={clearContext}
            >
              <X size={14} />
            </button>
          ) : (
            <button type="button" disabled={busy || contextBusy} onClick={useCurrentView}>
              <Link2 size={12} />Add current view
            </button>
          )}
        </div>

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
                  savedQuickNote={message.quickNoteResult}
                  onSaved={() => void synchronizeThreadMutation(message.conversationId!)}
                />
              ) : null}
              {message.role === "assistant" && message.quickNote && message.conversationId ? (
                <QuickNoteDraftCard
                  actorHandle={actorHandle}
                  conversationId={message.conversationId}
                  messageId={message.id}
                  quickNote={message.quickNote}
                  savedQuickNote={message.quickNoteResult}
                  onSaved={() => void synchronizeThreadMutation(message.conversationId!)}
                />
              ) : null}
            </article>
          ))}
          {busy ? <article className="tablet-message assistant pending"><span>Tablet</span><p>{activeContext ? "Reading the context and thinking…" : "Thinking…"}</p></article> : null}
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
            placeholder={quotaLoading
              ? "Loading AI allowance"
              : remainingToday > 0
                ? activeContext
                  ? `Ask about ${activeContext.title}`
                  : "Message Symposium AI"
                : "Daily AI limit reached"}
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
          activeContext={activeContext}
          thread={thread}
          open={contextDockOpen}
          busy={busy || contextBusy}
          onToggle={() => setContextDockOpen((current) => !current)}
          onUseCurrentView={useCurrentView}
          onClearContext={clearContext}
          onContextChange={(change) => void changeThreadContext(change)}
          onSourceChange={(source, action) => void changeSavedSource(source, action)}
        />
      </aside>
    </section>
  );
}
