"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  LoaderCircle,
  LockKeyhole
} from "lucide-react";
import {
  createClientMutationId,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import type {
  AssistantActionProposalContract,
  AssistantActionReceiptContract
} from "@/packages/contracts/src";
import type { ScribbleSnapshot } from "@/lib/workspaceTypes";

export function AssistantOfficeDraftCard({
  actorHandle,
  conversationId,
  messageId,
  proposal,
  receipt,
  onSaved
}: {
  actorHandle: string;
  conversationId: string;
  messageId: string;
  proposal: AssistantActionProposalContract;
  receipt?: AssistantActionReceiptContract;
  onSaved: () => void;
}) {
  const isPostDraft = proposal.tool === "office.post.create_draft";
  const proposalPostKind = isPostDraft ? proposal.postKind : "thought";
  const receiptPostKind = receipt?.tool === "office.post.create_draft"
    ? receipt.documentKind
    : undefined;
  const [title, setTitle] = useState(proposal.title);
  const [body, setBody] = useState(proposal.body);
  const [postKind, setPostKind] = useState<"thought" | "paper">(
    receiptPostKind ?? proposalPostKind
  );
  const [notebooks, setNotebooks] =
    useState<ScribbleSnapshot["notebooks"]>([]);
  const [notebookId, setNotebookId] = useState(receipt?.notebookId ?? "");
  const [notebooksLoading, setNotebooksLoading] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AssistantActionReceiptContract | null>(
    receipt ?? null
  );
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setTitle(proposal.title);
    setBody(proposal.body);
    if (proposal.tool === "office.post.create_draft") {
      setPostKind(
        receipt?.tool === "office.post.create_draft"
          ? receipt.documentKind
          : proposal.postKind
      );
    }
    if (receipt) {
      setNotebookId(receipt.notebookId ?? "");
      setSaved(receipt);
    }
  }, [
    proposal.body,
    proposal.title,
    proposal.tool,
    proposalPostKind,
    receipt
  ]);

  useEffect(() => {
    let cancelled = false;
    setNotebooksLoading(true);
    void symposiumApi
      .request<ScribbleSnapshot>(
        `/api/workspace/scribble?actorHandle=${encodeURIComponent(actorHandle)}`,
        { cache: "no-store" }
      )
      .then((snapshot) => {
        if (!cancelled) setNotebooks(snapshot.notebooks);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof SymposiumApiError
              ? caught.message
              : "Your Office notebooks could not be loaded."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setNotebooksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actorHandle]);

  const createNotebook = async () => {
    const name = newNotebookName.trim();
    if (!name || creatingNotebook || saved) return;
    setCreatingNotebook(true);
    setError("");
    try {
      const result = await symposiumApi.request<{
        notebook: ScribbleSnapshot["notebooks"][number];
      }>("/api/workspace/notebooks", {
        method: "POST",
        idempotencyKey: createClientMutationId("assistant-action-notebook"),
        body: { actorHandle, name }
      });
      setNotebooks((current) => [
        result.notebook,
        ...current.filter((notebook) => notebook.id !== result.notebook.id)
      ]);
      setNotebookId(result.notebook.id);
      setNewNotebookName("");
      window.dispatchEvent(new Event("symposium-workspace-change"));
    } catch (caught) {
      setError(
        caught instanceof SymposiumApiError
          ? caught.message
          : "The Office notebook could not be created."
      );
    } finally {
      setCreatingNotebook(false);
    }
  };

  const confirm = async () => {
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();
    if (!normalizedTitle || !normalizedBody || confirming || saved) return;
    const fingerprint =
      `${proposal.tool}\n${postKind}\n${notebookId}\n${normalizedTitle}\n${normalizedBody}`;
    if (retryRef.current?.fingerprint !== fingerprint) {
      retryRef.current = {
        fingerprint,
        key: createClientMutationId(
          isPostDraft
            ? "assistant-office-post-draft"
            : "assistant-office-note-draft"
        )
      };
    }
    setConfirming(true);
    setError("");
    try {
      const result = await symposiumApi.request<AssistantActionReceiptContract>(
        isPostDraft
          ? "/api/assistant/actions/office-post-drafts"
          : "/api/assistant/actions/office-note-drafts",
        {
          method: "POST",
          idempotencyKey: retryRef.current.key,
          body: {
            actorHandle,
            assistantMessageId: messageId,
            conversationId,
            title: normalizedTitle,
            body: normalizedBody,
            notebookId: notebookId || null,
            ...(isPostDraft ? { postKind } : {})
          }
        }
      );
      setSaved(result);
      onSaved();
      window.dispatchEvent(new Event("symposium-workspace-change"));
    } catch (caught) {
      setError(
        caught instanceof SymposiumApiError
          ? caught.message
          : isPostDraft
            ? "The private Office post draft could not be created."
            : "The private Office note draft could not be created."
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <section
      className="tablet-action-draft"
      aria-label={
        isPostDraft
          ? "Proposed private Office post draft"
          : "Proposed private Office note"
      }
      aria-busy={confirming}
      aria-live="polite"
    >
      <header>
        <span>
          {isPostDraft ? <FileText size={14} /> : <FilePlus2 size={14} />}
          {isPostDraft
            ? "Proposed private Office post draft"
            : "Proposed private Office note"}
        </span>
        <small>
          <LockKeyhole size={11} />
          {saved
            ? "Created as a private draft"
            : isPostDraft
              ? "Private draft only · not published"
              : "Not saved yet"}
        </small>
      </header>
      <p>
        {isPostDraft
          ? "Review the exact content, type, and destination. Nothing is created until you confirm, and nothing is published."
          : "Review the exact content and destination. Nothing is created until you confirm below."}
      </p>
      <label>
        <small>Title</small>
        <input
          value={title}
          maxLength={240}
          disabled={Boolean(saved)}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {isPostDraft ? (
        <label>
          <small>Private post draft type</small>
          <select
            value={postKind}
            disabled={Boolean(saved)}
            onChange={(event) =>
              setPostKind(event.target.value as "thought" | "paper")
            }
          >
            <option value="thought">Thought</option>
            <option value="paper">Paper</option>
          </select>
        </label>
      ) : null}
      <label>
        <small>{isPostDraft ? "Draft body" : "Note"}</small>
        <textarea
          value={body}
          maxLength={8000}
          rows={6}
          disabled={Boolean(saved)}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label>
        <small>
          <Folder size={12} />
          Private Office destination
        </small>
        <select
          value={notebookId}
          disabled={Boolean(saved) || notebooksLoading}
          onChange={(event) => setNotebookId(event.target.value)}
        >
          <option value="">All Notes</option>
          {notebooks.map((notebook) => (
            <option value={notebook.id} key={notebook.id}>
              {notebook.name}
            </option>
          ))}
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
        <button
          type="button"
          disabled={
            Boolean(saved) ||
            creatingNotebook ||
            !newNotebookName.trim()
          }
          onClick={() => void createNotebook()}
        >
          {creatingNotebook ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <FolderPlus size={13} />
          )}
          {creatingNotebook ? "Creating…" : "Create & select"}
        </button>
      </div>
      {error ? (
        <p className="tablet-action-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <a className="tablet-note-saved" href={saved.href}>
          <CheckCircle2 size={14} />
          {saved.tool === "office.post.create_draft"
            ? `Created private ${
                saved.documentKind === "paper" ? "Paper" : "Thought"
              } draft in ${saved.notebookName ?? "All Notes"}`
            : `Created in ${saved.notebookName ?? "All Notes"}`}
          <ExternalLink size={13} />
        </a>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={confirming || !title.trim() || !body.trim()}
          onClick={() => void confirm()}
        >
          {confirming ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <LockKeyhole size={14} />
          )}
          {confirming
            ? "Creating private draft…"
            : "Confirm & create private draft"}
        </button>
      )}
    </section>
  );
}
