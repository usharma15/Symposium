"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clock3, Pencil, Send, Trash2, Users } from "lucide-react";
import { SymposiumDocumentEditor, SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import type { AttachmentUploadHandler } from "@/features/attachments/AttachmentViews";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import type { InquiryAttachment, ResearchProfile } from "@/lib/mockData";
import { relativeTimeLabel } from "@/lib/symposiumCore";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import type { WorkspaceDocument, WorkspaceNotebook, WorkspacePublicationResponse } from "@/lib/workspaceTypes";
import { workspaceKindLabel } from "@/features/workspace/WorkspaceDocumentCard";

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

export function WorkspaceDocumentDetail({
  document,
  notebooks,
  profiles,
  initiallyEditing,
  onBack,
  onSave,
  onDelete,
  onPublish,
  onPublished,
  onUploadAttachment
}: {
  document: WorkspaceDocument;
  notebooks: WorkspaceNotebook[];
  profiles: Record<string, ResearchProfile>;
  initiallyEditing: boolean;
  onBack: () => void;
  onSave: (draft: SaveDraft) => Promise<WorkspaceDocument>;
  onDelete: () => Promise<void>;
  onPublish: (document: WorkspaceDocument, target?: "paper" | "thought") => Promise<WorkspacePublicationResponse>;
  onPublished: (result: WorkspacePublicationResponse) => void;
  onUploadAttachment: AttachmentUploadHandler;
}) {
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
  const saveInFlightRef = useRef(false);
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

  const currentDraft = useCallback(() => ({
    title: title.trim() || "Untitled note",
    body,
    document: documentValue,
    notebookId,
    targetId: targetId.trim() || null,
    publicationTarget: document.kind === "note" ? publicationTarget : document.publicationTarget,
    attachments
  }), [attachments, body, document.kind, document.publicationTarget, documentValue, notebookId, publicationTarget, targetId, title]);

  const saveDraft = useCallback(async (checkpoint: boolean) => {
    if (saveInFlightRef.current || uploading) return null;
    const draft = currentDraft();
    const fingerprint = draftFingerprint(draft);
    if (!checkpoint && fingerprint === savedFingerprintRef.current) return document;
    saveInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setSaveState(checkpoint ? "Saving checkpoint…" : "Autosaving…");
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
      saveInFlightRef.current = false;
      setBusy(false);
    }
  }, [currentDraft, document, onSave, uploading]);

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
  const capability = document.kind === "note" || document.kind === "paper" ? "paper" : "reduced";
  const targetLinked = document.kind !== "comment" && document.kind !== "reply" || Boolean(targetId.trim());
  const publicationChosen = document.kind !== "note" || publicationTarget !== "undecided";

  return (
    <div className="workspace-detail" data-testid={`workspace-detail-${document.id}`}>
      <header className="workspace-detail-nav">
        <button type="button" onClick={onBack}><ArrowLeft size={17} />Notes</button>
        <div className="workspace-save-state" aria-live="polite">
          {saveState === "Saved" || saveState === "Autosaved" || saveState === "Draft saved" ? <Check size={15} /> : <Clock3 size={15} />}
          {saveState}
        </div>
        <div className="workspace-detail-actions">
          {!editing && document.access.canEdit ? <button type="button" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button> : null}
          {document.access.canDelete ? <button type="button" className="danger" onClick={() => {
            if (window.confirm(`Delete “${document.title}”? This cannot be undone.`)) void onDelete();
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
                <label>
                  <span>Save in</span>
                  <select value={notebookId ?? ""} onChange={(event) => setNotebookId(event.target.value || null)}>
                    <option value="">All · Unfiled</option>
                    {notebooks.map((notebook) => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
                  </select>
                  {notebookId !== document.notebookId ? <small>Moving a draft can change inherited collaborator access.</small> : null}
                </label>
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
                <div><Users size={15} /><span>{document.access.role === "owner" ? "Private workspace · Owner" : `${document.access.role} access`}</span></div>
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
                <span>Revision {document.revision}</span>
                <span>Edited {relativeTimeLabel(document.updatedAt, document.updatedAt)}</span>
              </div>
              {error ? <div className="workspace-error" role="alert">{error}</div> : null}
              {document.access.canPublish ? <div className="workspace-reader-post"><button type="button" className="primary" disabled={!document.body.trim() || !targetLinked || !publicationChosen} onClick={() => void publish()}><Send size={15} />Post this saved draft</button></div> : null}
              <section className="workspace-draft-discussion">
                <h2>Draft discussion</h2>
                <p>Comments on shared drafts will live here and remain in the private history after publication. Sharing and draft discussion activate in the collaboration pass.</p>
              </section>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
