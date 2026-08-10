"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  BrainCircuit,
  ChevronDown,
  File,
  FilePenLine,
  History,
  Link2,
  LoaderCircle,
  Maximize2,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Send,
  X
} from "lucide-react";
import type {
  AssistantDraftEditModeContract,
  InquiryAttachmentContract
} from "@/packages/contracts/src";
import type { AssistantController } from "@/features/assistant/useAssistantController";
import { nextAssistantProjectSelection } from "@/features/assistant/assistantControllerModel";
import { assistantThreadActivityLabel } from "@/features/assistant/assistantThreadOrdering";
import { AssistantContextDock } from "@/features/assistant/AssistantContextDock";
import { AssistantDraftStudio } from "@/features/assistant/AssistantDraftStudio";
import { AssistantMessageCard } from "@/features/assistant/AssistantMessageCard";
import { AssistantProjectsPanel } from "@/features/assistant/AssistantProjectsPanel";
import { AssistantThreadHistoryItem } from "@/features/assistant/AssistantThreadHistoryItem";
import {
  assistantAttachmentProcessingLabel,
  assistantAttachmentUrl
} from "@/features/assistant/assistantPresentation";
import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import {
  formatAttachmentBytes,
  postAttachmentAccept
} from "@/lib/attachmentRules";

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
    contextConfiguration,
    activeContext,
    conversationId,
    thread,
    threads,
    projects,
    nextCursor,
    threadSearch,
    threadLibraryView,
    selectedProjectId,
    threadListLoading,
    threadListLoadingMore,
    threadActionBusyId,
    projectActionBusyId,
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
    setDraft,
    setError,
    uploadAssistantFiles,
    removePendingAttachment,
    openThread,
    startNewThread,
    setThreadLibraryFilters,
    loadMoreThreads,
    updateThreadDetails,
    deleteThread,
    createProject,
    updateProject,
    deleteProject,
    useCurrentView,
    clearContext,
    changeThreadContext,
    changeContextConfiguration,
    changeSavedSource,
    synchronizeThreadMutation,
    submit
  } = controller;
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [contextDockOpen, setContextDockOpen] = useState(mode === "workspace");
  const [threadQuery, setThreadQuery] = useState(threadSearch);
  const [mobilePane, setMobilePane] = useState<"threads" | "chat" | "context">("chat");
  const [draftEditMode, setDraftEditMode] =
    useState<AssistantDraftEditModeContract>("review");
  const [rightPanel, setRightPanel] = useState<"draft" | "context">("context");
  const [compactDraftOpen, setCompactDraftOpen] = useState(false);
  const [draftStudioState, setDraftStudioState] = useState<{
    revision: number | null;
    pending: boolean;
  }>({ revision: null, pending: false });
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerResizeRef = useRef(false);
  const previousModeRef = useRef(mode);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    id: string;
    attachments: InquiryAttachmentContract[];
  } | null>(null);
  const activeDraftReceipt = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const receipt = messages[index]?.actionReceipt;
      if (
        receipt?.tool === "office.note.create_draft" ||
        receipt?.tool === "office.post.create_draft"
      ) {
        return receipt;
      }
    }
    return null;
  }, [messages]);
  const previousDraftDocumentIdRef = useRef<string | null>(null);
  const handleDraftStudioState = useCallback((state: {
    revision: number | null;
    pending: boolean;
  }) => {
    setDraftStudioState((current) =>
      current.revision === state.revision && current.pending === state.pending
        ? current
        : state
    );
  }, []);

  const openAttachmentPreview = (
    attachments: InquiryAttachmentContract[],
    attachmentId: string
  ) => {
    setAttachmentPreview({
      id: attachmentId,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: assistantAttachmentUrl(attachment, actorHandle)
      }))
    });
  };

  const selectThread = (id: string) => {
    setThreadsOpen(false);
    setMobilePane("chat");
    void openThread(id);
  };

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    setContextDockOpen(mode === "workspace");
    if (mode === "compact" && (threadLibraryView !== "all" || threadSearch)) {
      setThreadQuery("");
      setThreadLibraryFilters("", "all");
    }
  }, [mode, setThreadLibraryFilters, threadLibraryView, threadSearch]);

  useEffect(() => {
    const documentId = activeDraftReceipt?.documentId ?? null;
    if (!documentId) {
      previousDraftDocumentIdRef.current = null;
      setCompactDraftOpen(false);
      setRightPanel("context");
      setDraftStudioState({ revision: null, pending: false });
      setDraftEditMode("review");
      return;
    }
    if (previousDraftDocumentIdRef.current === documentId) return;
    previousDraftDocumentIdRef.current = documentId;
    setRightPanel("draft");
    setCompactDraftOpen(mode === "compact");
    setDraftEditMode("review");
    if (mode === "workspace" && window.innerWidth <= 1100) {
      setMobilePane("context");
    }
  }, [activeDraftReceipt?.documentId, mode]);

  useEffect(() => {
    if (threadQuery === threadSearch) return;
    const timeout = window.setTimeout(() => {
      setThreadLibraryFilters(
        threadQuery,
        threadLibraryView,
        selectedProjectId
      );
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [
    selectedProjectId,
    setThreadLibraryFilters,
    threadLibraryView,
    threadQuery,
    threadSearch
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, messages.length]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    if (!draft) delete textarea.dataset.manualHeight;
    const style = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingHeight = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const borderHeight = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const verticalChrome = paddingHeight + borderHeight;
    const minimumHeight = lineHeight * 2 + verticalChrome;
    const automaticMaximum = lineHeight * 4 + verticalChrome;
    const manualHeight = Number.parseFloat(textarea.dataset.manualHeight ?? "0");
    textarea.style.height = "auto";
    const contentHeight = Math.min(Math.max(textarea.scrollHeight + borderHeight, minimumHeight), automaticMaximum);
    textarea.style.height = `${Math.max(contentHeight, manualHeight)}px`;
  }, [draft, mode]);

  const submitForm = (event?: FormEvent) => {
    event?.preventDefault();
    if (activeDraftReceipt && draftStudioState.pending) {
      setError("Wait for the private draft to finish saving before asking the AI to work on its next revision.");
      return;
    }
    void submit({
      draftSession:
        activeDraftReceipt && draftStudioState.revision
          ? {
              documentId: activeDraftReceipt.documentId,
              expectedRevision: draftStudioState.revision,
              mode: draftEditMode
            }
          : null
    });
  };

  const renderThreadList = (inlineProject = false) => (
    <div
      className={`assistant-thread-list${
        inlineProject ? " assistant-project-thread-list" : ""
      }`}
    >
      {threads.length ? threads.map((candidate) => (
        <AssistantThreadHistoryItem
          key={candidate.id}
          candidate={candidate}
          selected={candidate.id === conversationId}
          disabled={threadActionBusyId !== null}
          busy={threadActionBusyId === candidate.id}
          projects={projects}
          projectName={inlineProject
            ? null
            : projects.find(
                (project) => project.id === candidate.projectId
              )?.name ?? null}
          onSelect={() => selectThread(candidate.id)}
          onUpdate={async (changes) =>
            Boolean(await updateThreadDetails(candidate, changes))
          }
          onDelete={() => deleteThread(candidate)}
        />
      )) : (
        <p>
          {threadListLoading
            ? "Loading chats…"
            : threadQuery.trim()
              ? "No chats match this search."
              : threadLibraryView === "archived"
                ? "No archived chats."
                : inlineProject
                  ? "No active chats in this Project."
                  : "No saved chats yet."}
        </p>
      )}
      {nextCursor ? (
        <button
          type="button"
          className="assistant-thread-load-more"
          disabled={threadListLoadingMore}
          onClick={() => void loadMoreThreads()}
        >
          {threadListLoadingMore ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
          {threadListLoadingMore ? "Loading…" : "Load more chats"}
        </button>
      ) : threads.length ? (
        <small>All matching chats are shown.</small>
      ) : null}
    </div>
  );

  return (
    <section
      className={`assistant-experience ${
        mode === "compact"
          ? "tablet-panel assistant-compact"
          : "assistant-workspace"
      }`}
      data-assistant-mode={mode}
      data-mobile-pane={mobilePane}
      aria-label={mode === "workspace" ? "Assistant workspace" : "Assistant"}
    >
      {mode === "compact" ? (
        <header className="tablet-header assistant-header">
          <div>
            <span><BrainCircuit size={16} />Assistant</span>
          </div>
          <div className="assistant-header-actions">
            {activeDraftReceipt ? (
              <button
                type="button"
                className={compactDraftOpen ? "active" : ""}
                aria-pressed={compactDraftOpen}
                title={compactDraftOpen ? "Return to chat" : "Open Draft Studio"}
                onClick={() => setCompactDraftOpen((current) => !current)}
              >
                <FilePenLine size={15} />
                <span>{compactDraftOpen ? "Chat" : "Draft"}</span>
              </button>
            ) : null}
            <button type="button" title="Expand Assistant" onClick={onExpand}>
              <Maximize2 size={16} /><span>Expand</span>
            </button>
            <button type="button" title="Close Assistant" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
      ) : null}

      <nav className="assistant-mobile-nav" aria-label="Assistant panels">
        <button type="button" aria-pressed={mobilePane === "threads"} className={mobilePane === "threads" ? "active" : ""} onClick={() => setMobilePane("threads")}>
          <History size={14} />Chats
        </button>
        <button type="button" aria-pressed={mobilePane === "chat"} className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}>
          <BrainCircuit size={14} />Chat
        </button>
        {activeDraftReceipt ? (
          <button
            type="button"
            aria-pressed={mobilePane === "context" && rightPanel === "draft"}
            className={mobilePane === "context" && rightPanel === "draft" ? "active" : ""}
            onClick={() => {
              setRightPanel("draft");
              setMobilePane("context");
            }}
          >
            <FilePenLine size={14} />Draft
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={mobilePane === "context" && rightPanel === "context"}
          className={mobilePane === "context" && rightPanel === "context" ? "active" : ""}
          onClick={() => {
            setRightPanel("context");
            setMobilePane("context");
          }}
        >
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
                {thread ? <small>{thread.sourceCount} active source{thread.sourceCount === 1 ? "" : "s"}</small> : null}
              </span>
            </button>
          ) : (
            <div className="tablet-thread-current assistant-panel-title" aria-label="Assistant chat history">
              <BrainCircuit size={15} />
              <span>
                <strong>Assistant</strong>
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
                <strong>{candidate.pinned ? <Pin size={10} aria-label="Pinned" /> : null}{candidate.title}</strong>
                <small>{candidate.sourceCount} source{candidate.sourceCount === 1 ? "" : "s"} · {assistantThreadActivityLabel(candidate.lastMessageAt)}</small>
              </button>
            )) : <p>No saved chats yet.</p>}
          </div>
          ) : null}
        </section>
        <div className="assistant-thread-search">
          {threadListLoading ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
          <input
            type="search"
            value={threadQuery}
            onChange={(event) => setThreadQuery(event.target.value)}
            maxLength={160}
            placeholder={
              threadLibraryView === "projects"
                ? selectedProjectId
                  ? "Search this Project"
                  : "Select a Project to search chats"
                : threadLibraryView === "archived"
                  ? "Search archived chats"
                  : "Search titles and messages"
            }
            aria-label="Search chats"
          />
        </div>
        <nav className="assistant-thread-filters" aria-label="Chat history view">
          <button
            type="button"
            className={threadLibraryView === "all" ? "active" : undefined}
            aria-pressed={threadLibraryView === "all"}
            onClick={() => setThreadLibraryFilters(threadQuery, "all")}
          >
            All
          </button>
          <button
            type="button"
            className={threadLibraryView === "projects" ? "active" : undefined}
            aria-pressed={threadLibraryView === "projects"}
            onClick={() => setThreadLibraryFilters(
              threadQuery,
              "projects",
              threadLibraryView === "projects" ? selectedProjectId : null
            )}
          >
            Projects
          </button>
          <button
            type="button"
            className={`assistant-archive-filter${
              threadLibraryView === "archived" ? " active" : ""
            }`}
            aria-label="Archived chats"
            title="Archived chats"
            aria-pressed={threadLibraryView === "archived"}
            onClick={() => setThreadLibraryFilters(threadQuery, "archived")}
          >
            <Archive size={14} />
          </button>
        </nav>
        {threadLibraryView === "projects" ? (
          <AssistantProjectsPanel
            projects={projects}
            selectedProjectId={selectedProjectId}
            disabled={
              projectActionBusyId !== null ||
              threadActionBusyId !== null
            }
            busyId={projectActionBusyId}
            onSelect={(projectId) =>
              setThreadLibraryFilters(
                threadQuery,
                "projects",
                nextAssistantProjectSelection(selectedProjectId, projectId)
              )
            }
            onCreate={async (name) => Boolean(await createProject(name))}
            onRename={async (project, name) =>
              Boolean(await updateProject(project, name))
            }
            onDelete={deleteProject}
            expandedContent={renderThreadList(true)}
          />
        ) : null}
        {threadLibraryView === "projects" ? null : renderThreadList()}
      </aside>

      <section className="assistant-center" aria-label="Chat">
        <section
          className="tablet-limit-notice"
          aria-label={
            quotaLoading
              ? "AI usage limits. Loading allowance."
              : `AI usage limits. Limited beta with less processing capacity. ${remainingToday} of ${dailyLimit} answers left today. Shared $${monthlyBudgetUsd} monthly cap.`
          }
        >
          <AlertTriangle size={13} />
          <strong title="Limited beta uses less processing capacity">
            Limited beta
          </strong>
          <span>
            {quotaLoading
              ? "Loading allowance…"
              : `${remainingToday}/${dailyLimit} answers · $${monthlyBudgetUsd} shared cap`}
          </span>
        </section>

        {thread?.archivedAt ? (
          <section className="assistant-archived-notice" aria-label="Archived chat">
            <span><Archive size={14} /><strong>This chat is archived.</strong> Restore it to continue the conversation or change its context.</span>
            <button
              type="button"
              disabled={threadActionBusyId !== null}
              onClick={() => void updateThreadDetails(thread, { archived: false })}
            >
              {threadActionBusyId === thread.id ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
              Restore
            </button>
          </section>
        ) : null}

        {mode === "compact" ? (
          <div className={`tablet-active-context${activeContext ? " attached" : ""}`} aria-label="Chat context">
            <span>
              <BookOpen size={13} />
              <strong>
                {activeContext
                  ? `Context · ${activeContext.title}`
                  : "Plain chat · No context"}
              </strong>
            </span>
            {activeContext ? (
              <button
                type="button"
                aria-label="Remove chat context"
                title="Continue without explicit context"
                disabled={busy || contextBusy || Boolean(thread?.archivedAt)}
                onClick={clearContext}
              >
                <X size={14} />
              </button>
            ) : (
              <button type="button" disabled={busy || contextBusy || Boolean(thread?.archivedAt)} onClick={useCurrentView}>
                <Link2 size={12} />Add current view
              </button>
            )}
          </div>
        ) : null}

        <div className="tablet-transcript" aria-live="polite" ref={transcriptRef}>
          {threadLoading ? <article className="tablet-message assistant pending"><span>Assistant</span><p>Loading research threads…</p></article> : null}
          {messages.map((message) => (
            <AssistantMessageCard
              actorHandle={actorHandle}
              key={message.id}
              message={message}
              onOpenAttachment={openAttachmentPreview}
              onSaved={(id) => void synchronizeThreadMutation(id)}
            />
          ))}
          {busy ? <article className="tablet-message assistant pending"><span>Assistant</span><p>{activeContext ? "Reading the context and thinking…" : "Thinking…"}</p></article> : null}
        </div>

        {error ? <div className="tablet-error" role="alert">{error}</div> : null}
        <form className="tablet-composer" onSubmit={submitForm}>
          {pendingAttachments.length ? (
            <div className="tablet-pending-attachments" aria-label="Files ready to attach">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.id}>
                  <button
                    type="button"
                    className="tablet-pending-file"
                    onClick={() => openAttachmentPreview(pendingAttachments, attachment.id)}
                  >
                    <File size={13} />
                    <span>
                      <strong>{attachment.fileName}</strong>
                      <small>{formatAttachmentBytes(attachment.byteSize)} · {assistantAttachmentProcessingLabel(attachment)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tablet-pending-remove"
                    aria-label={`Remove ${attachment.fileName}`}
                    title="Remove unsent file"
                    disabled={busy}
                    onClick={() => removePendingAttachment(attachment)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="tablet-composer-main">
            <input
              ref={attachmentInputRef}
              className="tablet-attachment-input"
              type="file"
              multiple
              accept={postAttachmentAccept}
              aria-label="Attach files to this AI message"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void uploadAssistantFiles(files);
              }}
            />
            <button
              type="button"
              className="tablet-attach-button"
              aria-label="Attach files"
              title={attachmentCapacity > pendingAttachments.length
                ? visionAttachmentCapacity > 0
                  ? "Attach files up to 5 MB · images can be inspected by AI"
                  : "Attach files up to 5 MB · two image sources are already active"
                : "No more files fit in the five-source limit"}
              disabled={Boolean(thread?.archivedAt) || busy || contextBusy || attachmentUploading || threadLoading || quotaLoading || attachmentCapacity <= pendingAttachments.length || remainingToday <= 0 || !providerEnabled || !providerConfigured}
              onClick={() => attachmentInputRef.current?.click()}
            >
              {attachmentUploading ? <LoaderCircle className="spin" size={15} /> : <Paperclip size={15} />}
            </button>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPointerDown={(event) => {
                const textarea = event.currentTarget;
                const nearResizeHandle =
                  event.nativeEvent.offsetX >= textarea.clientWidth - 24 &&
                  event.nativeEvent.offsetY >= textarea.clientHeight - 24;
                if (!nearResizeHandle) return;
                composerResizeRef.current = true;
              }}
              onPointerUp={(event) => {
                if (!composerResizeRef.current) return;
                composerResizeRef.current = false;
                const textarea = event.currentTarget;
                textarea.dataset.manualHeight = String(textarea.getBoundingClientRect().height);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitForm();
                }
              }}
              maxLength={2000}
              rows={2}
              aria-label="Message Symposium AI"
              placeholder={thread?.archivedAt
                ? "Restore this chat to continue"
                : quotaLoading
                ? "Loading AI allowance"
                : remainingToday > 0
                  ? activeContext
                    ? `Ask about ${activeContext.title}`
                    : "Message Symposium AI"
                  : "Daily AI limit reached"}
              disabled={Boolean(thread?.archivedAt) || busy || contextBusy || attachmentUploading || threadLoading || quotaLoading || remainingToday <= 0 || !providerEnabled || !providerConfigured}
            />
            <button
              type="submit"
              className="primary tablet-send-button"
              disabled={Boolean(thread?.archivedAt) || busy || contextBusy || attachmentUploading || threadLoading || quotaLoading || (!draft.trim() && !pendingAttachments.length) || remainingToday <= 0 || !providerEnabled || !providerConfigured}
              aria-label="Send message · uses 1 AI answer"
              title="Send message · uses 1 AI answer"
            >
              <Send size={15} />
            </button>
          </div>
          {pendingAttachments.length ? (
            <small className="tablet-attachment-limit">
              <Paperclip size={11} />
              Files up to 5 MB · at most 2 images per answer · uploads use no
              answer · documents use bounded extracted text.
            </small>
          ) : null}
        </form>
      </section>

      {mode === "compact" && activeDraftReceipt && compactDraftOpen ? (
        <aside className="assistant-draft-overlay" aria-label="Draft Studio panel">
          <AssistantDraftStudio
            actorHandle={actorHandle}
            receipt={activeDraftReceipt}
            mode={draftEditMode}
            onModeChange={setDraftEditMode}
            onStateChange={handleDraftStudioState}
          />
        </aside>
      ) : null}

      {mode === "workspace" ? (
        <aside className="assistant-right" aria-label="Thread context">
          {activeDraftReceipt ? (
            <nav className="assistant-right-tabs" aria-label="Assistant side panel">
              <button
                type="button"
                className={rightPanel === "draft" ? "active" : ""}
                aria-pressed={rightPanel === "draft"}
                onClick={() => setRightPanel("draft")}
              >
                <FilePenLine size={13} />Draft
              </button>
              <button
                type="button"
                className={rightPanel === "context" ? "active" : ""}
                aria-pressed={rightPanel === "context"}
                onClick={() => setRightPanel("context")}
              >
                <BookOpen size={13} />Context
              </button>
            </nav>
          ) : null}
          {activeDraftReceipt && rightPanel === "draft" ? (
            <AssistantDraftStudio
              actorHandle={actorHandle}
              receipt={activeDraftReceipt}
              mode={draftEditMode}
              onModeChange={setDraftEditMode}
              onStateChange={handleDraftStudioState}
            />
          ) : (
            <AssistantContextDock
              context={context}
              configuration={contextConfiguration}
              activeContext={activeContext}
              thread={thread}
              open={contextDockOpen}
              busy={busy || contextBusy || Boolean(thread?.archivedAt)}
              onCollapse={onCollapse}
              onToggle={() => setContextDockOpen((current) => !current)}
              onUseCurrentView={useCurrentView}
              onClearContext={clearContext}
              onConfigurationChange={(configuration) => void changeContextConfiguration(configuration)}
              onContextChange={(change) => void changeThreadContext(change)}
              onSourceChange={(source, action) => void changeSavedSource(source, action)}
            />
          )}
        </aside>
      ) : null}
      {attachmentPreview ? (
        <AttachmentPreviewModal
          attachments={attachmentPreview.attachments}
          contextTitle="AI chat files"
          attachmentId={attachmentPreview.id}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
    </section>
  );
}
