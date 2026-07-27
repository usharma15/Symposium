"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  FilePenLine,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { buildPostAttachmentMetadata } from "@/features/attachments/AttachmentViews";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import { createClientMutationId } from "@/features/api/symposiumApiClient";
import { SymposiumDocumentEditor } from "@/features/content/SymposiumDocument";
import { useWorkspaceDocuments } from "@/features/workspace/useWorkspaceDocuments";
import type {
  AssistantActionReceiptContract,
  AssistantDraftEditModeContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import type { InquiryAttachment } from "@/lib/mockData";
import type { WorkspaceDocument } from "@/lib/workspaceTypes";

type CreatedDraftReceipt = Extract<
  AssistantActionReceiptContract,
  { tool: "office.note.create_draft" | "office.post.create_draft" }
>;

const fingerprint = (value: {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  attachments: InquiryAttachment[];
}) => JSON.stringify([
  value.title,
  value.body,
  value.document,
  value.attachments.map((attachment) => attachment.id)
]);

export function AssistantDraftStudio({
  actorHandle,
  receipt,
  mode,
  onModeChange,
  onStateChange
}: {
  actorHandle: string;
  receipt: CreatedDraftReceipt;
  mode: AssistantDraftEditModeContract;
  onModeChange: (mode: AssistantDraftEditModeContract) => void;
  onStateChange: (state: {
    revision: number | null;
    pending: boolean;
  }) => void;
}) {
  const workspace = useWorkspaceDocuments(actorHandle);
  const canonical = workspace.snapshot.documents.find(
    (document) => document.id === receipt.documentId
  ) ?? null;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [documentValue, setDocumentValue] =
    useState<VersionedDocumentContract | null>(null);
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [saveState, setSaveState] = useState("Opening draft…");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const savedFingerprintRef = useRef("");
  const savedRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const activeDocumentIdRef = useRef("");

  const applyCanonical = useCallback((next: WorkspaceDocument) => {
    setTitle(next.title);
    setBody(next.body);
    setDocumentValue(next.document);
    setAttachments(next.attachments);
    savedRevisionRef.current = next.revision;
    savedFingerprintRef.current = fingerprint({
      title: next.title,
      body: next.body,
      document: next.document,
      attachments: next.attachments
    });
    setSaveState(`Saved · revision ${next.revision}`);
    setError("");
  }, []);

  const currentFingerprint = useMemo(() => documentValue
    ? fingerprint({ title, body, document: documentValue, attachments })
    : "", [attachments, body, documentValue, title]);
  const dirty = Boolean(
    documentValue &&
    savedFingerprintRef.current &&
    currentFingerprint !== savedFingerprintRef.current
  );

  useEffect(() => {
    onStateChange({
      revision: savedRevisionRef.current || canonical?.revision || null,
      pending: dirty || saving || uploading
    });
  }, [canonical?.revision, dirty, onStateChange, saving, uploading]);

  useEffect(() => {
    if (!canonical) return;
    if (activeDocumentIdRef.current !== canonical.id) {
      activeDocumentIdRef.current = canonical.id;
      applyCanonical(canonical);
      return;
    }
    if (canonical.revision <= savedRevisionRef.current) return;
    if (dirty || savingRef.current) {
      setError(
        "A newer saved revision is available. Your unsaved text has been kept; review it before retrying."
      );
      setSaveState("Revision conflict");
      return;
    }
    applyCanonical(canonical);
  }, [applyCanonical, canonical, dirty]);

  useEffect(() => {
    if (!canonical && !workspace.loading) {
      onStateChange({ revision: null, pending: false });
    }
  }, [canonical, onStateChange, workspace.loading]);

  const save = useCallback(async () => {
    if (
      !canonical ||
      !documentValue ||
      savingRef.current ||
      uploading ||
      currentFingerprint === savedFingerprintRef.current
    ) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    setSaveState("Autosaving…");
    try {
      const saved = await workspace.updateDocument(canonical.id, {
        title: title.trim() || "Untitled draft",
        body,
        document: documentValue,
        kind: canonical.kind,
        publicationTarget: canonical.publicationTarget,
        proposal: canonical.proposal,
        opportunity: canonical.opportunity,
        notebookId: canonical.notebookId,
        targetId: canonical.targetId,
        attachmentIds: attachments.map((attachment) => attachment.id),
        expectedRevision: savedRevisionRef.current,
        checkpoint: false
      });
      applyCanonical(saved);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The private draft could not be saved."
      );
      setSaveState("Save needs attention");
      await workspace.refresh({ quiet: true }).catch(() => null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    applyCanonical,
    attachments,
    body,
    canonical,
    currentFingerprint,
    documentValue,
    title,
    uploading,
    workspace
  ]);

  useEffect(() => {
    if (!dirty || saving || uploading || error.includes("newer saved revision")) return;
    setSaveState("Unsaved changes");
    const timer = window.setTimeout(() => void save(), 1400);
    return () => window.clearTimeout(timer);
  }, [dirty, error, save, saving, uploading]);

  const uploadAttachment = async (file: File) => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedAttachment({
      actorHandle,
      file,
      idempotencyKey: createClientMutationId("assistant-draft-studio-attachment"),
      metadata,
      ownerType: "note"
    });
  };

  if (workspace.loading && !canonical) {
    return (
      <section className="assistant-draft-studio loading" aria-label="Draft Studio">
        <RefreshCw className="spin" size={18} />
        <strong>Opening the private draft…</strong>
      </section>
    );
  }

  if (!canonical || !documentValue) {
    return (
      <section className="assistant-draft-studio unavailable" aria-label="Draft Studio">
        <FilePenLine size={18} />
        <strong>Draft unavailable</strong>
        <p>{workspace.error ?? "This private draft is no longer available in the Office."}</p>
      </section>
    );
  }

  const capability = canonical.kind === "note" || canonical.kind === "paper"
    ? "paper"
    : "reduced";

  return (
    <section
      className="assistant-draft-studio"
      aria-label={`Draft Studio for ${canonical.title}`}
      aria-busy={saving || uploading}
    >
      <header className="assistant-draft-studio-header">
        <span>
          <FilePenLine size={16} />
          <span><strong>Draft Studio</strong><small>Private Office draft</small></span>
        </span>
        <a href={receipt.href} title="Open full draft in Office">
          <ExternalLink size={14} />
          Office
        </a>
      </header>

      <div className="assistant-draft-permission">
        <div>
          <ShieldCheck size={15} />
          <span>
            <strong>AI editing permission</strong>
            <small>Applies only to this private draft and never publishes it.</small>
          </span>
        </div>
        <div className="assistant-draft-mode" role="group" aria-label="AI draft edit mode">
          <button
            type="button"
            className={mode === "review" ? "active" : ""}
            aria-pressed={mode === "review"}
            onClick={() => onModeChange("review")}
          >
            Review
          </button>
          <button
            type="button"
            className={mode === "live" ? "active live" : ""}
            aria-pressed={mode === "live"}
            onClick={() => onModeChange("live")}
          >
            <Sparkles size={12} />
            Live
          </button>
        </div>
      </div>
      <p className="assistant-draft-mode-copy">
        {mode === "review"
          ? "AI changes appear in chat for approval before touching the draft."
          : "Explicit edit requests in chat apply to this draft immediately. Every AI edit remains revisioned and undoable."}
      </p>

      <div className="assistant-draft-editor">
        <input
          value={title}
          maxLength={240}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Draft title"
          placeholder="Untitled draft"
        />
        <SymposiumDocumentEditor
          value={documentValue}
          capability={capability}
          attachments={attachments}
          profiles={{}}
          disabled={saving}
          placeholder="Develop this draft"
          onChange={(next, plainText) => {
            setDocumentValue(next);
            setBody(plainText);
          }}
          onAttachmentsChange={setAttachments}
          onBusyChange={setUploading}
          onUploadAttachment={uploadAttachment}
        />
      </div>

      {error ? <p className="assistant-draft-error" role="alert">{error}</p> : null}
      <footer className="assistant-draft-status" aria-live="polite">
        <span>
          {saving || dirty ? <Clock3 size={13} /> : <Check size={13} />}
          {saveState}
        </span>
        <span><LockKeyhole size={12} />Private · revision {savedRevisionRef.current}</span>
      </footer>
    </section>
  );
}
