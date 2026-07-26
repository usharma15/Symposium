"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Folder,
  FolderPlus,
  Languages,
  LoaderCircle,
  Save
} from "lucide-react";
import {
  createClientMutationId,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import type {
  AssistantQuickNoteContract,
  AssistantQuickNoteResultContract,
  AssistantTranslationContract,
  AssistantTranslationLanguageContract
} from "@/packages/contracts/src";
import { assistantTranslationLanguageLabels } from "@/packages/contracts/src/translationLanguages";
import type { ScribbleSnapshot } from "@/lib/workspaceTypes";

export function AssistantQuickNoteDraftCard({
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
  const [notebooks, setNotebooks] =
    useState<ScribbleSnapshot["notebooks"]>([]);
  const [notebookId, setNotebookId] = useState(
    savedQuickNote?.notebookId ?? ""
  );
  const [notebooksLoading, setNotebooksLoading] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] =
    useState<AssistantQuickNoteResultContract | null>(
      savedQuickNote ?? null
    );
  const retryRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

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
    void symposiumApi
      .request<ScribbleSnapshot>(
        `/api/workspace/scribble?actorHandle=${encodeURIComponent(
          actorHandle
        )}`,
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
        idempotencyKey: createClientMutationId("assistant-notebook"),
        body: { actorHandle, name }
      });
      setNotebooks((current) => [
        result.notebook,
        ...current.filter(
          (notebook) => notebook.id !== result.notebook.id
        )
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

  const saveQuickNote = async () => {
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();
    if (!normalizedTitle || !normalizedBody || saving || saved) return;
    const fingerprint = `${notebookId}\n${normalizedTitle}\n${normalizedBody}`;
    if (retryRef.current?.fingerprint !== fingerprint) {
      retryRef.current = {
        fingerprint,
        key: createClientMutationId("assistant-quick-note")
      };
    }
    setSaving(true);
    setError("");
    try {
      const result =
        await symposiumApi.request<AssistantQuickNoteResultContract>(
          "/api/assistant/quick-notes",
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
              ...(targetLanguage ? { targetLanguage } : {}),
              source: quickNote.source
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
          : "The Quick Note could not be saved."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="tablet-quick-note-draft"
      aria-label="Quick Note draft"
    >
      <span>
        Private Quick Note · review, choose a notebook, then save
      </span>
      <label>
        <small>Title</small>
        <input
          value={title}
          maxLength={240}
          disabled={Boolean(saved)}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        <small>Note</small>
        <textarea
          value={body}
          maxLength={8000}
          rows={5}
          disabled={Boolean(saved)}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label>
        <small>
          <Folder size={12} />
          Office destination
        </small>
        <select
          value={notebookId}
          disabled={Boolean(saved) || notebooksLoading}
          onChange={(event) => setNotebookId(event.target.value)}
        >
          <option value="">All · Quick Notes</option>
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
          onChange={(event) =>
            setNewNotebookName(event.target.value)
          }
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
          Saved to {saved.notebookName ?? "All · Quick Notes"}
          <ExternalLink size={13} />
        </a>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={saving || !title.trim() || !body.trim()}
          onClick={() => void saveQuickNote()}
        >
          {saving ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Save size={14} />
          )}
          {saving
            ? "Saving private note…"
            : "Confirm & save Quick Note"}
        </button>
      )}
    </div>
  );
}

export function AssistantTranslationCard({
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
    <section
      className="tablet-translation-card"
      aria-label={`${assistantTranslationLanguageLabels[translation.targetLanguage]} translation`}
    >
      <header>
        <span>
          <Languages size={14} />
          {
            assistantTranslationLanguageLabels[
              translation.targetLanguage
            ]
          }{" "}
          translation
        </span>
        <small>Derived from {translation.source.title}</small>
      </header>
      <div className="tablet-translation-copy">
        <strong>{translation.translatedTitle}</strong>
        <p>{translation.translatedBody}</p>
      </div>
      <AssistantQuickNoteDraftCard
        actorHandle={actorHandle}
        conversationId={conversationId}
        messageId={messageId}
        quickNote={{
          title: translation.quickNoteTitle,
          body: translation.quickNoteBody,
          source: translation.source
        }}
        targetLanguage={translation.targetLanguage}
        savedQuickNote={savedQuickNote}
        onSaved={onSaved}
      />
    </section>
  );
}
