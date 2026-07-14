"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowLeft, Check, Clock3, Pencil, Send, Trash2, Users } from "lucide-react";
import { SymposiumDocumentEditor, SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { AttachmentPreviewModal, type AttachmentUploadHandler } from "@/features/attachments/AttachmentViews";
import {
  CommentComposer,
  CommentThread,
  type CommentSegmentStacks
} from "@/features/comments/CommentThread";
import { CommentEditModal } from "@/features/posts/PostViews";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import type { InquiryAttachment, ResearchProfile } from "@/lib/mockData";
import { findCommentInTree, localDateTimeLabel, relativeTimeLabel } from "@/lib/symposiumCore";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import type { WorkspaceDocument, WorkspaceNotebook, WorkspacePublicationResponse } from "@/lib/workspaceTypes";
import { workspaceKindLabel } from "@/features/workspace/WorkspaceDocumentCard";
import { useWorkspaceComments } from "@/features/workspace/useWorkspaceComments";
import { canonicalRouteHref } from "@/features/navigation/canonicalRoute";

type SaveDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  kind: WorkspaceDocument["kind"];
  publicationTarget: WorkspaceDocument["publicationTarget"];
  notebookId: string | null;
  targetId: string | null;
  attachmentIds: string[];
  expectedRevision: number;
  checkpoint: boolean;
};

const draftFingerprint = (draft: {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  notebookId: string | null;
  targetId: string | null;
  publicationTarget: WorkspaceDocument["publicationTarget"];
  attachments: InquiryAttachment[];
}) => JSON.stringify([
  draft.title,
  draft.body,
  draft.document,
  draft.notebookId,
  draft.targetId,
  draft.publicationTarget,
  draft.attachments.map((attachment) => attachment.id)
]);

export type WorkspaceDocumentDetailHandle = {
  prepareForNavigation: () => Promise<WorkspaceDocument | null>;
  latestSavedDocument: () => Promise<WorkspaceDocument>;
  applySavedDocument: (document: WorkspaceDocument) => void;
};

type WorkspaceDocumentDetailProps = {
  document: WorkspaceDocument;
  actorHandle: string;
  initialCommentId?: string;
  notebooks: WorkspaceNotebook[];
  profiles: Record<string, ResearchProfile>;
  initiallyEditing: boolean;
  onBack: () => void;
  onShare: () => void;
  onSave: (draft: SaveDraft) => Promise<WorkspaceDocument>;
  onDelete: (document: WorkspaceDocument) => Promise<void>;
  onPublish: (document: WorkspaceDocument, target?: "paper" | "thought") => Promise<WorkspacePublicationResponse>;
  onPublished: (result: WorkspacePublicationResponse) => void;
  onUploadAttachment: AttachmentUploadHandler;
  onUploadCommentAttachment: AttachmentUploadHandler;
  onOpenProfile: (handle: string) => void;
};

export const WorkspaceDocumentDetail = forwardRef<WorkspaceDocumentDetailHandle, WorkspaceDocumentDetailProps>(function WorkspaceDocumentDetail({
  document,
  actorHandle,
  initialCommentId,
  notebooks,
  profiles,
  initiallyEditing,
  onBack,
  onShare,
  onSave,
  onDelete,
  onPublish,
  onPublished,
  onUploadAttachment,
  onUploadCommentAttachment,
  onOpenProfile
}, ref) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [documentValue, setDocumentValue] = useState(document.document);
  const [attachments, setAttachments] = useState<InquiryAttachment[]>(document.attachments);
  const [notebookId, setNotebookId] = useState<string | null>(document.notebookId);
  const [targetId, setTargetId] = useState(document.targetId ?? "");
  const [publicationTarget, setPublicationTarget] = useState<"undecided" | "paper" | "thought">(
    document.publicationTarget === "paper" || document.publicationTarget === "thought"
      ? document.publicationTarget
      : "undecided"
  );
  const [revision, setRevision] = useState(document.revision);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [error, setError] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(initialCommentId ?? null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentPreview, setCommentPreview] = useState<{ commentId: string; attachmentId: string } | null>(null);
  const [commentSegmentStacks, setCommentSegmentStacks] = useState<CommentSegmentStacks>({});
  const savePromiseRef = useRef<Promise<WorkspaceDocument | null> | null>(null);
  const savedDocumentRef = useRef(document);
  const revisionRef = useRef(document.revision);
  const savedFingerprintRef = useRef(draftFingerprint({
    title: document.title,
    body: document.body,
    document: document.document,
    notebookId: document.notebookId,
    targetId: document.targetId,
    publicationTarget: document.publicationTarget,
    attachments: document.attachments
  }));
  const discussion = useWorkspaceComments(document.id, actorHandle);

  const currentDraft = useCallback(() => ({
    title: title.trim() || "Untitled note",
    body,
    document: documentValue,
    notebookId,
    targetId: targetId.trim() || null,
    publicationTarget: document.kind === "note" ? publicationTarget : document.publicationTarget,
    attachments
  }), [attachments, body, document.kind, document.publicationTarget, documentValue, notebookId, publicationTarget, targetId, title]);

  const applySavedDocument = useCallback((saved: WorkspaceDocument) => {
    savedDocumentRef.current = saved;
    revisionRef.current = saved.revision;
    setRevision(saved.revision);
    setTitle(saved.title);
    setBody(saved.body);
    setDocumentValue(saved.document);
    setAttachments(saved.attachments);
    setNotebookId(saved.notebookId);
    setTargetId(saved.targetId ?? "");
    setPublicationTarget(saved.publicationTarget === "paper" || saved.publicationTarget === "thought" ? saved.publicationTarget : "undecided");
    savedFingerprintRef.current = draftFingerprint({
      title: saved.title,
      body: saved.body,
      document: saved.document,
      notebookId: saved.notebookId,
      targetId: saved.targetId,
      publicationTarget: saved.publicationTarget,
      attachments: saved.attachments
    });
    setSaveState("Draft saved");
    setError(null);
  }, []);

  const saveDraft = useCallback(async (checkpoint: boolean) => {
    if (savePromiseRef.current) await savePromiseRef.current;
    if (uploading) {
      setError("Wait for the attachment upload to finish before leaving this draft.");
      setSaveState("Upload still running");
      return null;
    }
    const draft = currentDraft();
    const fingerprint = draftFingerprint(draft);
    if (!checkpoint && fingerprint === savedFingerprintRef.current) return savedDocumentRef.current;
    setBusy(true);
    setError(null);
    setSaveState(checkpoint ? "Saving checkpoint…" : "Autosaving…");
    const operation = (async () => {
      try {
        const saved = await onSave({
          title: draft.title,
          body: draft.body,
          document: draft.document,
          kind: document.kind,
          publicationTarget: draft.publicationTarget,
          notebookId: draft.notebookId,
          targetId: draft.targetId,
          attachmentIds: draft.attachments.map((attachment) => attachment.id),
          expectedRevision: revisionRef.current,
          checkpoint
        });
        savedDocumentRef.current = saved;
        revisionRef.current = saved.revision;
        setRevision(saved.revision);
        savedFingerprintRef.current = fingerprint;
        setSaveState(checkpoint ? "Draft saved" : "Autosaved");
        return saved;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Draft could not be saved.";
        setError(message);
        setSaveState("Save needs attention");
        return null;
      } finally {
        setBusy(false);
      }
    })();
    savePromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
    }
  }, [currentDraft, document, onSave, uploading]);

  const prepareForNavigation = useCallback(async () => {
    if (savePromiseRef.current) await savePromiseRef.current;
    if (uploading) {
      setError("Wait for the attachment upload to finish before leaving this draft.");
      setSaveState("Upload still running");
      return null;
    }
    const draft = currentDraft();
    if (draftFingerprint(draft) === savedFingerprintRef.current) return savedDocumentRef.current;
    return saveDraft(true);
  }, [currentDraft, saveDraft, uploading]);

  useEffect(() => {
    if (document.id !== savedDocumentRef.current.id || document.revision <= savedDocumentRef.current.revision) return;
    if (draftFingerprint(currentDraft()) !== savedFingerprintRef.current) {
      setError("A newer saved revision is available. Finish or review this edit before leaving the draft.");
      setSaveState("Save needs attention");
      return;
    }
    applySavedDocument(document);
  }, [applySavedDocument, currentDraft, document]);

  useImperativeHandle(ref, () => ({
    prepareForNavigation,
    latestSavedDocument: async () => {
      if (savePromiseRef.current) await savePromiseRef.current;
      return savedDocumentRef.current;
    },
    applySavedDocument
  }), [applySavedDocument, prepareForNavigation]);

  const fingerprint = draftFingerprint(currentDraft());
  useEffect(() => {
    if (!editing || fingerprint === savedFingerprintRef.current || busy || uploading) return;
    setSaveState("Unsaved changes");
    const timer = window.setTimeout(() => void saveDraft(false), 1400);
    return () => window.clearTimeout(timer);
  }, [busy, editing, fingerprint, saveDraft, uploading]);

  const publish = async () => {
    if (!body.trim() || busy || uploading) return;
    setBusy(true);
    setError(null);
    try {
      const saved = fingerprint === savedFingerprintRef.current ? { ...document, revision } : await saveDraft(true);
      if (!saved) return;
      const result = await onPublish(
        saved,
        document.kind === "note" && publicationTarget !== "undecided" ? publicationTarget : undefined
      );
      onPublished(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This draft could not be published.");
    } finally {
      setBusy(false);
    }
  };

  const owner = profileForHandle(profiles, document.ownerHandle);
  const ownerName = owner?.name ?? document.ownerName ?? document.ownerHandle;
  const compatibleNotebooks = notebooks.filter((notebook) => notebook.ownerHandle === document.ownerHandle);
  const capability = document.kind === "note" || document.kind === "paper" ? "paper" : "reduced";
  const targetLinked = document.kind !== "comment" && document.kind !== "reply" || Boolean(targetId.trim());
  const publicationChosen = document.kind !== "note" || publicationTarget !== "undecided";
  const editingComment = editingCommentId ? findCommentInTree(discussion.comments, editingCommentId) ?? null : null;
  const previewComment = commentPreview ? findCommentInTree(discussion.comments, commentPreview.commentId) ?? null : null;

  const updateCommentSegmentStack = (key: string, stack: string[]) => {
    setCommentSegmentStacks((current) => ({ ...current, [key]: stack }));
  };

  const deleteComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await discussion.deleteComment(commentId);
      setEditingCommentId((current) => current === commentId ? null : current);
      setSelectedCommentId((current) => current === commentId ? null : current);
    } catch (caught) {
      discussion.setError(caught instanceof Error ? caught.message : "Comment could not be deleted.");
    }
  };

  return (
    <div className="workspace-detail" data-testid={`workspace-detail-${document.id}`}>
      <header className="workspace-detail-nav">
        <button type="button" onClick={onBack}><ArrowLeft size={17} />Notes</button>
        <div className="workspace-save-state" aria-live="polite">
          {saveState === "Saved" || saveState === "Autosaved" || saveState === "Draft saved" ? <Check size={15} /> : <Clock3 size={15} />}
          {saveState}
        </div>
        <div className="workspace-detail-actions">
          <button type="button" className="workspace-sharing-trigger" aria-label={`Sharing and access for ${document.title}`} onClick={onShare}><Users size={15} />{document.collaboratorCount ? `Shared · ${document.collaboratorCount}` : "Share"}</button>
          {!editing && document.access.canEdit ? <button type="button" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button> : null}
          {document.access.canDelete ? <button type="button" className="danger" onClick={() => {
            if (window.confirm(`Delete “${document.title}”? This cannot be undone.`)) {
              void (async () => {
                if (savePromiseRef.current) await savePromiseRef.current;
                await onDelete(savedDocumentRef.current);
              })();
            }
          }}><Trash2 size={15} />Delete</button> : null}
        </div>
      </header>

      <article className="feed-post workspace-detail-paper">
        <div className="post-author workspace-document-author">
          <span className="avatar">{owner?.avatarUrl ? <img src={owner.avatarUrl} alt="" /> : profileInitials(ownerName)}</span>
          <span><strong>{ownerName}</strong><small>Created {relativeTimeLabel(document.createdAt, document.createdAt)}</small></span>
        </div>
        <div className="post-body">
          <div className="workspace-draft-line">
            <strong>Draft · {workspaceKindLabel[document.kind]}</strong>
            {notebookId ? <><b aria-hidden="true">•</b><span>{notebooks.find((notebook) => notebook.id === notebookId)?.name ?? document.notebookName}</span></> : null}
            {document.lifecycle === "published" ? <span className="workspace-published-badge">Published checkpoint retained</span> : null}
          </div>

          {editing ? (
            <div className="workspace-editor" data-testid="workspace-editor">
              <input className="workspace-title-input" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled note" />
              <div className="workspace-editor-fields">
                {document.access.canDelete ? <label>
                  <span>Save in</span>
                  <select value={notebookId ?? ""} onChange={(event) => {
                    const nextNotebookId = event.target.value || null;
                    const currentNotebook = notebooks.find((notebook) => notebook.id === notebookId);
                    const nextNotebook = notebooks.find((notebook) => notebook.id === nextNotebookId);
                    const affected = Math.max(currentNotebook?.collaboratorCount ?? 0, nextNotebook?.collaboratorCount ?? 0);
                    if (affected && !window.confirm(`Moving this draft can change inherited access for up to ${affected} collaborator${affected === 1 ? "" : "s"}. Continue?`)) return;
                    setNotebookId(nextNotebookId);
                  }}>
                    <option value="">All · Unfiled</option>
                    {compatibleNotebooks.map((notebook) => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
                  </select>
                  {notebookId !== document.notebookId ? <small>Moving a draft can change inherited collaborator access.</small> : null}
                </label> : <label><span>Saved in</span><strong>{notebookId ? compatibleNotebooks.find((notebook) => notebook.id === notebookId)?.name ?? document.notebookName : "All · Unfiled"}</strong><small>Only the owner can change notebook placement because it controls inherited access.</small></label>}
                {document.kind === "note" ? (
                  <label><span>Post as</span><select value={publicationTarget} onChange={(event) => setPublicationTarget(event.target.value as "undecided" | "paper" | "thought")}><option value="undecided">Choose when ready</option><option value="paper">Paper</option><option value="thought">Thought</option></select></label>
                ) : null}
                {document.kind === "comment" || document.kind === "reply" ? (
                  <label className="workspace-target-field"><span>{document.kind === "reply" ? "Reply destination" : "Comment destination"}</span><input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder={document.kind === "reply" ? "post-id:comment-id" : "post-id"} /><small>The linked destination is checked again when published.</small></label>
                ) : null}
              </div>
              <SymposiumDocumentEditor
                value={documentValue}
                capability={capability}
                attachments={attachments}
                profiles={profiles}
                disabled={busy}
                placeholder={`Develop your ${workspaceKindLabel[document.kind].toLowerCase()} here`}
                onChange={(next, plainText) => { setDocumentValue(next); setBody(plainText); }}
                onAttachmentsChange={setAttachments}
                onBusyChange={setUploading}
                onUploadAttachment={onUploadAttachment}
              />
              {error ? <div className="workspace-error" role="alert">{error}</div> : null}
              <footer className="workspace-editor-footer">
                <div><Users size={15} /><span>{document.access.role === "owner" ? `Private workspace · Owner${document.collaboratorCount ? ` · ${document.collaboratorCount} collaborators` : ""}` : `${document.access.role} access`}</span></div>
                <div>
                  <button type="button" disabled={busy || uploading} onClick={() => void saveDraft(true)}>Save Draft</button>
                  {document.access.canPublish ? <button type="button" className="primary" disabled={busy || uploading || !body.trim() || !targetLinked || !publicationChosen} onClick={() => void publish()}><Send size={15} />Post</button> : null}
                </div>
              </footer>
            </div>
          ) : (
            <>
              <h1>{document.title}</h1>
              <SymposiumDocumentRenderer document={document.document} body={document.body} attachments={document.attachments} profiles={profiles} mode="detail" />
              <div className="workspace-reader-meta">
                <span>Created {localDateTimeLabel(document.createdAt)}</span>
                <span>Edited {relativeTimeLabel(document.updatedAt, document.updatedAt)}</span>
                <span>Revision {document.revision}</span>
              </div>
              {error ? <div className="workspace-error" role="alert">{error}</div> : null}
              {document.access.canPublish ? <div className="workspace-reader-post"><button type="button" className="primary" disabled={!document.body.trim() || !targetLinked || !publicationChosen} onClick={() => void publish()}><Send size={15} />Post this saved draft</button></div> : null}
            </>
          )}

          <section className="comments-section workspace-draft-discussion" id={`workspace-comments-${document.id}`}>
            <header>
              <h2>Draft discussion</h2>
              <span aria-live="polite">{discussion.status}</span>
            </header>
            {document.access.canComment ? (
              <CommentComposer
                itemId={document.id}
                profiles={profiles}
                onAddComment={discussion.addComment}
                onUploadAttachment={onUploadCommentAttachment}
                allowQuotes={false}
              />
            ) : null}
            {discussion.loading && !discussion.comments.length ? <p>Opening the private discussion…</p> : null}
            {discussion.error ? <div className="workspace-error" role="alert">{discussion.error}</div> : null}
            <CommentThread
              comments={discussion.comments}
              itemId={document.id}
              profiles={profiles}
              selectedCommentId={selectedCommentId}
              onOpenProfile={onOpenProfile}
              onAddComment={discussion.addComment}
              onUploadAttachment={onUploadCommentAttachment}
              onOpenAttachmentPreview={(_noteId, commentId, attachmentId) => setCommentPreview({ commentId, attachmentId })}
              onCommentAction={discussion.applyAction}
              onEditComment={(_noteId, commentId) => setEditingCommentId(commentId)}
              onDeleteComment={(_noteId, commentId) => void deleteComment(commentId)}
              actorHandle={actorHandle}
              onClearSelectedComment={() => setSelectedCommentId(null)}
              onSelectComment={setSelectedCommentId}
              commentSegmentStacks={commentSegmentStacks}
              onCommentSegmentStackChange={updateCommentSegmentStack}
              onVisibleCommentSegmentStackChange={() => undefined}
              options={{
                allowQuotes: false,
                allowReplies: document.access.canComment,
                allowReshares: false,
                commentHref: (noteId, commentId) => canonicalRouteHref({
                  kind: "workspace",
                  view: "notes",
                  noteId,
                  commentId
                }) + `#comment-${commentId}`
              }}
            />
          </section>
        </div>
      </article>
      {editingComment && !editingComment.deletedAt ? (
        <CommentEditModal
          context={{ id: document.id, title: document.title }}
          comment={editingComment}
          onClose={() => setEditingCommentId(null)}
          onSave={async (_noteId, _commentId, nextBody, nextDocument, nextAttachments) => {
            try {
              await discussion.updateComment(editingComment, nextBody, nextDocument, nextAttachments);
              setEditingCommentId(null);
            } catch (caught) {
              discussion.setError(caught instanceof Error ? caught.message : "Comment edit could not be saved.");
            }
          }}
          onDelete={(_noteId, commentId) => void deleteComment(commentId)}
          onUploadAttachment={onUploadCommentAttachment}
          profiles={profiles}
          allowQuotes={false}
        />
      ) : null}
      {commentPreview && previewComment?.attachments?.length ? (
        <AttachmentPreviewModal
          attachments={previewComment.attachments}
          contextTitle={document.title}
          attachmentId={commentPreview.attachmentId}
          onClose={() => setCommentPreview(null)}
        />
      ) : null}
    </div>
  );
});
