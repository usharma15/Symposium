"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClientMutationId,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import type {
  CreateWorkspaceDocumentInputContract,
  UpdateWorkspaceDocumentInputContract
} from "@/packages/contracts/src";
import type {
  WorkspaceDocument,
  WorkspaceNotebook,
  WorkspacePublicationResponse,
  WorkspaceSearchResponse,
  WorkspaceSnapshot
} from "@/lib/workspaceTypes";
import {
  normalizeWorkspaceSnapshot,
  workspaceDocumentMetadataUpdate
} from "@/features/workspace/workspaceNavigator";

type WorkspaceChangeMessage = {
  type: "workspace-change";
  actorHandle: string;
  sourceId: string;
  changedAt: string;
};

const isWorkspaceChangeMessage = (value: unknown): value is WorkspaceChangeMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WorkspaceChangeMessage>;
  return message.type === "workspace-change" && typeof message.actorHandle === "string" && typeof message.sourceId === "string";
};

const emptySnapshot: WorkspaceSnapshot = { workspace: null, notebooks: [], documents: [] };
const cacheKey = (handle: string) => `symposium-workspace-v1:${handle}`;

const cacheSnapshot = (handle: string, snapshot: WorkspaceSnapshot) => {
  try {
    window.localStorage.setItem(cacheKey(handle), JSON.stringify(snapshot));
  } catch {
    // The server remains authoritative when browser storage is unavailable or full.
  }
};

const cachedSnapshot = (handle: string) => {
  try {
    const raw = window.localStorage.getItem(cacheKey(handle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (!Array.isArray(parsed.documents) || !Array.isArray(parsed.notebooks)) return null;
    return parsed as WorkspaceSnapshot;
  } catch {
    return null;
  }
};

const messageForError = (error: unknown, fallback: string) =>
  error instanceof SymposiumApiError || error instanceof Error ? error.message : fallback;

export const useWorkspaceDocuments = (actorHandle: string) => {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Opening workspace…");
  const [error, setError] = useState<string | null>(null);
  const sourceIdRef = useRef(createClientMutationId("workspace-tab"));
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const applySnapshot = useCallback((next: WorkspaceSnapshot) => {
    const normalized = normalizeWorkspaceSnapshot(next);
    snapshotRef.current = normalized;
    setSnapshot(normalized);
    cacheSnapshot(actorHandle, normalized);
  }, [actorHandle]);

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!options.quiet) setStatus("Synchronising workspace…");
    try {
      const next = await symposiumApi.request<WorkspaceSnapshot>(
        `/api/workspace?actorHandle=${encodeURIComponent(actorHandle)}`,
        { cache: "no-store" }
      );
      applySnapshot(next);
      setError(null);
      setStatus("Workspace current");
      return next;
    } catch (caught) {
      const message = messageForError(caught, "Workspace could not be loaded.");
      setError(message);
      setStatus(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [actorHandle, applySnapshot]);

  const publishChange = useCrossTabItemTransport<WorkspaceChangeMessage>({
    channelName: "symposium-workspace-sync-v1",
    storageKey: "symposium-cross-tab-workspace",
    isMessage: isWorkspaceChangeMessage,
    onMessage: (message) => {
      if (message.actorHandle !== actorHandle || message.sourceId === sourceIdRef.current) return;
      void refresh({ quiet: true }).catch(() => undefined);
    }
  });

  const announceChange = useCallback(() => publishChange({
    type: "workspace-change",
    actorHandle,
    sourceId: sourceIdRef.current,
    changedAt: new Date().toISOString()
  }), [actorHandle, publishChange]);

  useEffect(() => {
    const cached = cachedSnapshot(actorHandle);
    if (cached) {
      applySnapshot(cached);
      setStatus("Checking workspace…");
    } else {
      setSnapshot(emptySnapshot);
      setLoading(true);
    }
    void refresh().catch(() => undefined);
  }, [actorHandle, applySnapshot, refresh]);

  useEffect(() => {
    const handleLiveChange = () => void refresh({ quiet: true }).catch(() => undefined);
    window.addEventListener("symposium-workspace-change", handleLiveChange);
    return () => window.removeEventListener("symposium-workspace-change", handleLiveChange);
  }, [refresh]);

  const createDocument = useCallback(async (input: CreateWorkspaceDocumentInputContract) => {
    setStatus("Creating draft…");
    const result = await symposiumApi.request<{ document: WorkspaceDocument }>("/api/workspace/documents", {
      method: "POST",
      idempotencyKey: createClientMutationId("workspace-document-create"),
      body: { ...input, actorHandle }
    });
    applySnapshot({ ...snapshotRef.current, documents: [result.document, ...snapshotRef.current.documents] });
    announceChange();
    setStatus("Draft created");
    return result.document;
  }, [actorHandle, announceChange, applySnapshot]);

  const updateDocument = useCallback(async (noteId: string, input: UpdateWorkspaceDocumentInputContract) => {
    setStatus(input.checkpoint ? "Saving draft…" : "Autosaving…");
    const result = await symposiumApi.request<{ document: WorkspaceDocument }>(
      `/api/workspace/documents/${encodeURIComponent(noteId)}`,
      {
        method: "PATCH",
        idempotencyKey: createClientMutationId(input.checkpoint ? "workspace-document-checkpoint" : "workspace-document-autosave"),
        body: { ...input, actorHandle }
      }
    );
    applySnapshot({
      ...snapshotRef.current,
      documents: snapshotRef.current.documents.map((document) => document.id === noteId ? result.document : document)
    });
    announceChange();
    setError(null);
    setStatus(input.checkpoint ? "Draft saved" : "Autosaved");
    return result.document;
  }, [actorHandle, announceChange, applySnapshot]);

  const updateDocumentMetadata = useCallback(async (
    document: WorkspaceDocument,
    changes: { title?: string; notebookId?: string | null }
  ) => updateDocument(document.id, workspaceDocumentMetadataUpdate(document, changes)), [updateDocument]);

  const deleteDocument = useCallback(async (document: WorkspaceDocument) => {
    setStatus("Deleting draft…");
    await symposiumApi.request(`/api/workspace/documents/${encodeURIComponent(document.id)}`, {
      method: "DELETE",
      idempotencyKey: createClientMutationId("workspace-document-delete"),
      body: { actorHandle, expectedRevision: document.revision }
    });
    applySnapshot({
      ...snapshotRef.current,
      documents: snapshotRef.current.documents.filter((candidate) => candidate.id !== document.id)
    });
    announceChange();
    setStatus("Draft deleted");
  }, [actorHandle, announceChange, applySnapshot]);

  const createNotebook = useCallback(async (name: string) => {
    setStatus("Creating notebook…");
    const result = await symposiumApi.request<{ notebook: WorkspaceNotebook }>("/api/workspace/notebooks", {
      method: "POST",
      idempotencyKey: createClientMutationId("workspace-notebook-create"),
      body: { actorHandle, name }
    });
    applySnapshot({ ...snapshotRef.current, notebooks: [result.notebook, ...snapshotRef.current.notebooks] });
    announceChange();
    setStatus("Notebook created");
    return result.notebook;
  }, [actorHandle, announceChange, applySnapshot]);

  const renameNotebook = useCallback(async (notebook: WorkspaceNotebook, name: string) => {
    setStatus("Renaming notebook…");
    const result = await symposiumApi.request<{ notebook: WorkspaceNotebook }>(
      `/api/workspace/notebooks/${encodeURIComponent(notebook.id)}`,
      {
        method: "PATCH",
        idempotencyKey: createClientMutationId("workspace-notebook-update"),
        body: { actorHandle, name, expectedRevision: notebook.revision }
      }
    );
    applySnapshot({
      ...snapshotRef.current,
      notebooks: snapshotRef.current.notebooks.map((candidate) => candidate.id === notebook.id ? result.notebook : candidate),
      documents: snapshotRef.current.documents.map((document) => document.notebookId === notebook.id ? { ...document, notebookName: result.notebook.name } : document)
    });
    announceChange();
    setStatus("Notebook renamed");
    return result.notebook;
  }, [actorHandle, announceChange, applySnapshot]);

  const deleteNotebook = useCallback(async (notebook: WorkspaceNotebook) => {
    setStatus("Removing notebook…");
    await symposiumApi.request(`/api/workspace/notebooks/${encodeURIComponent(notebook.id)}`, {
      method: "DELETE",
      idempotencyKey: createClientMutationId("workspace-notebook-delete"),
      body: { actorHandle, expectedRevision: notebook.revision }
    });
    await refresh({ quiet: true });
    announceChange();
    setStatus("Notebook removed; its drafts are now in All");
  }, [actorHandle, announceChange, refresh]);

  const search = useCallback(async (query: string, options?: { kind?: string; notebookId?: string | null }) => {
    const parameters = new URLSearchParams({ query, actorHandle, limit: "24" });
    if (options?.kind) parameters.set("kind", options.kind);
    if (options && "notebookId" in options && options.notebookId) parameters.set("notebookId", options.notebookId);
    return symposiumApi.request<WorkspaceSearchResponse>(`/api/workspace/search?${parameters}`, { cache: "no-store" });
  }, [actorHandle]);

  const publishDocument = useCallback(async (
    document: WorkspaceDocument,
    publicationTarget?: "paper" | "thought"
  ) => {
    setStatus("Publishing exact saved revision…");
    const result = await symposiumApi.request<WorkspacePublicationResponse>(
      `/api/workspace/documents/${encodeURIComponent(document.id)}/publish`,
      {
        method: "POST",
        idempotencyKey: createClientMutationId("workspace-document-publish"),
        body: { actorHandle, expectedRevision: document.revision, publicationTarget }
      }
    );
    await refresh({ quiet: true });
    announceChange();
    setStatus("Draft published; private history retained");
    return result;
  }, [actorHandle, announceChange, refresh]);

  return useMemo(() => ({
    snapshot,
    loading,
    status,
    error,
    refresh,
    createDocument,
    updateDocument,
    updateDocumentMetadata,
    deleteDocument,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    search,
    publishDocument,
    setStatus
  }), [
    snapshot,
    loading,
    status,
    error,
    refresh,
    createDocument,
    updateDocument,
    updateDocumentMetadata,
    deleteDocument,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    search,
    publishDocument
  ]);
};
