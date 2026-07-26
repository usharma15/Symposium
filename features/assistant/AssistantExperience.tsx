"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  BrainCircuit,
  ChevronDown,
  File,
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
import type { InquiryAttachmentContract } from "@/packages/contracts/src";
import type { AssistantController } from "@/features/assistant/useAssistantController";
import { assistantThreadActivityLabel } from "@/features/assistant/assistantThreadOrdering";
import { AssistantContextDock } from "@/features/assistant/AssistantContextDock";
import { AssistantMessageCard } from "@/features/assistant/AssistantMessageCard";
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
    activeContext,
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
    setDraft,
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
    changeThreadContext,
    changeSavedSource,
    synchronizeThreadMutation,
    submit
  } = controller;
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [contextDockOpen, setContextDockOpen] = useState(mode === "workspace");
  const [threadQuery, setThreadQuery] = useState(threadSearch);
  const [mobilePane, setMobilePane] = useState<"threads" | "chat" | "context">("chat");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerResizeRef = useRef(false);
  const previousModeRef = useRef(mode);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    id: string;
    attachments: InquiryAttachmentContract[];
  } | null>(null);

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
    if (mode === "compact" && (threadLibraryStatus !== "active" || threadSearch)) {
      setThreadQuery("");
      setThreadLibraryFilters("", "active");
    }
  }, [mode, setThreadLibraryFilters, threadLibraryStatus, threadSearch]);

  useEffect(() => {
    if (threadQuery === threadSearch) return;
    const timeout = window.setTimeout(() => {
      setThreadLibraryFilters(threadQuery, threadLibraryStatus);
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [setThreadLibraryFilters, threadLibraryStatus, threadQuery, threadSearch]);

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
      {mode === "compact" ? (
        <header className="tablet-header assistant-header">
          <div>
            <span><BrainCircuit size={16} />AI Tablet</span>
          </div>
          <div className="assistant-header-actions">
            <button type="button" title="Expand to AI Workspace" onClick={onExpand}>
              <Maximize2 size={16} /><span>Expand</span>
            </button>
            <button type="button" title="Close AI Tablet" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
      ) : null}

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
            placeholder="Search titles and messages"
            aria-label="Search chats"
          />
        </div>
        <nav className="assistant-thread-filters" aria-label="Chat history view">
          <button
            type="button"
            className={threadLibraryStatus === "active" ? "active" : undefined}
            aria-pressed={threadLibraryStatus === "active"}
            onClick={() => setThreadLibraryFilters(threadQuery, "active")}
          >
            Active
          </button>
          <button
            type="button"
            className={threadLibraryStatus === "archived" ? "active" : undefined}
            aria-pressed={threadLibraryStatus === "archived"}
            onClick={() => setThreadLibraryFilters(threadQuery, "archived")}
          >
            Archived
          </button>
        </nav>
        <div className="assistant-thread-list">
          {threads.length ? threads.map((candidate) => (
            <AssistantThreadHistoryItem
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === conversationId}
              disabled={threadActionBusyId !== null}
              busy={threadActionBusyId === candidate.id}
              onSelect={() => selectThread(candidate.id)}
              onUpdate={async (changes) => Boolean(await updateThreadDetails(candidate, changes))}
              onDelete={() => deleteThread(candidate)}
            />
          )) : (
            <p>
              {threadListLoading
                ? "Loading chats…"
                : threadQuery.trim()
                  ? `No ${threadLibraryStatus} chats match this search.`
                  : threadLibraryStatus === "archived"
                    ? "No archived chats."
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
              {threadListLoadingMore ? <LoaderCircle className="spin" size={13} /> : <ChevronDown size={13} />}
              {threadListLoadingMore ? "Loading…" : "Load more chats"}
            </button>
          ) : threads.length ? <small>All matching chats are shown.</small> : null}
        </div>
      </aside>

      <section className="assistant-center" aria-label="Chat">
        <section className="tablet-limit-notice" aria-label="AI usage limits">
          <AlertTriangle size={13} />
          <strong>Limited beta</strong>
          <span>{quotaLoading ? "Loading allowance…" : `Less processing capacity · ${remainingToday} of ${dailyLimit} answers left today · shared $${monthlyBudgetUsd} monthly cap`}</span>
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
              <small>{activeContext ? "Using context" : "Plain chat"}</small>
              <strong>{activeContext?.title ?? "No Symposium context"}</strong>
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
          {threadLoading ? <article className="tablet-message assistant pending"><span>Tablet</span><p>Loading research threads…</p></article> : null}
          {messages.map((message) => (
            <AssistantMessageCard
              actorHandle={actorHandle}
              key={message.id}
              message={message}
              onOpenAttachment={openAttachmentPreview}
              onSaved={(id) => void synchronizeThreadMutation(id)}
            />
          ))}
          {busy ? <article className="tablet-message assistant pending"><span>Tablet</span><p>{activeContext ? "Reading the context and thinking…" : "Thinking…"}</p></article> : null}
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
              title="Send one limited AI request"
            >
              <Send size={15} /><span>Send · uses 1</span>
            </button>
          </div>
          <small className="tablet-attachment-limit">
            <Paperclip size={11} />
            Files up to 5 MB · at most 2 images per answer · uploads use no answer · documents use bounded extracted text.
          </small>
        </form>
      </section>

      {mode === "workspace" ? (
        <aside className="assistant-right" aria-label="Thread context">
          <AssistantContextDock
            context={context}
            activeContext={activeContext}
            thread={thread}
            open={contextDockOpen}
            busy={busy || contextBusy || Boolean(thread?.archivedAt)}
            onCollapse={onCollapse}
            onToggle={() => setContextDockOpen((current) => !current)}
            onUseCurrentView={useCurrentView}
            onClearContext={clearContext}
            onContextChange={(change) => void changeThreadContext(change)}
            onSourceChange={(source, action) => void changeSavedSource(source, action)}
          />
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
