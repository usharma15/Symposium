"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientMutationId } from "@/features/api/symposiumApiClient";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import type {
  CreateWorkspaceDocumentInputContract,
  UpdateWorkspaceDocumentInputContract
} from "@/packages/contracts/src";
import type {
  WorkspaceDocument,
  WorkspaceNotebook,
  WorkspacePublicationResponse,
  WorkspaceSnapshot
} from "@/lib/workspaceTypes";
import {
  normalizeWorkspaceSnapshot,
  workspaceDocumentMetadataUpdate
} from "@/features/workspace/workspaceNavigator";
import { workspaceGateway } from "@/features/workspace/workspaceGateway";
import {
  readWorkspaceSnapshot,
  writeWorkspaceSnapshot
} from "@/features/workspace/workspaceSnapshotStorage";

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

const messageForError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const useWorkspaceDocuments = (actorHandle: string) => {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Opening workspace…");
  const [error, setError] = useState<string | null>(null);
  const sourceIdRef = useRef(createClientMutationId("workspace-tab"));
  const snapshotRef = useRef(snapshot);
  const mutationEpochRef = useRef(0);
  const refreshRequestRef = useRef(0);
  snapshotRef.current = snapshot;

  const applySnapshot = useCallback((next: WorkspaceSnapshot) => {
    const normalized = normalizeWorkspaceSnapshot(next);
    snapshotRef.current = normalized;
    setSnapshot(normalized);
    writeWorkspaceSnapshot(actorHandle, normalized);
  }, [actorHandle]);

  const applyMutationSnapshot = useCallback((next: WorkspaceSnapshot) => {
    mutationEpochRef.current += 1;
    applySnapshot(next);
    setLoading(false);
  }, [applySnapshot]);

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    const requestId = ++refreshRequestRef.current;
    const mutationEpoch = mutationEpochRef.current;
    const isCurrentRequest = () =>
      requestId === refreshRequestRef.current && mutationEpoch === mutationEpochRef.current;
    if (!options.quiet) setStatus("Synchronising workspace…");
    try {
      const next = await workspaceGateway.getSnapshot(actorHandle);
      if (!isCurrentRequest()) return snapshotRef.current;
      applySnapshot(next);
      setError(null);
      setStatus("Workspace current");
      return next;
    } catch (caught) {
      if (!isCurrentRequest()) return snapshotRef.current;
      const message = messageForError(caught, "Workspace could not be loaded.");
      setError(message);
      setStatus(message);
      throw caught;
    } finally {
      if (isCurrentRequest()) setLoading(false);
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
    mutationEpochRef.current += 1;
    refreshRequestRef.current += 1;
    const cached = readWorkspaceSnapshot(actorHandle);
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
    const result = await workspaceGateway.createDocument(actorHandle, input);
    applyMutationSnapshot({
      ...snapshotRef.current,
      documents: [
        result.document,
        ...snapshotRef.current.documents.filter((document) => document.id !== result.document.id)
      ]
    });
    announceChange();
    setStatus("Draft created");
    return result.document;
  }, [actorHandle, announceChange, applyMutationSnapshot]);

  const updateDocument = useCallback(async (noteId: string, input: UpdateWorkspaceDocumentInputContract) => {
    setStatus(input.checkpoint ? "Saving draft…" : "Autosaving…");
    const result = await workspaceGateway.updateDocument(actorHandle, noteId, input);
    applyMutationSnapshot({
      ...snapshotRef.current,
      documents: snapshotRef.current.documents.map((document) => document.id === noteId ? result.document : document)
    });
    announceChange();
    setError(null);
    setStatus(input.checkpoint ? "Draft saved" : "Autosaved");
    return result.document;
  }, [actorHandle, announceChange, applyMutationSnapshot]);

  const updateDocumentMetadata = useCallback(async (
    document: WorkspaceDocument,
    changes: { title?: string; notebookId?: string | null }
  ) => updateDocument(document.id, workspaceDocumentMetadataUpdate(document, changes)), [updateDocument]);

  const deleteDocument = useCallback(async (document: WorkspaceDocument) => {
    setStatus("Deleting draft…");
    await workspaceGateway.deleteDocument(actorHandle, document);
    applyMutationSnapshot({
      ...snapshotRef.current,
      documents: snapshotRef.current.documents.filter((candidate) => candidate.id !== document.id)
    });
    announceChange();
    setStatus("Draft deleted");
  }, [actorHandle, announceChange, applyMutationSnapshot]);

  const createNotebook = useCallback(async (name: string) => {
    setStatus("Creating notebook…");
    const result = await workspaceGateway.createNotebook(actorHandle, name);
    applyMutationSnapshot({
      ...snapshotRef.current,
      notebooks: [
        result.notebook,
        ...snapshotRef.current.notebooks.filter((notebook) => notebook.id !== result.notebook.id)
      ]
    });
    announceChange();
    setStatus("Notebook created");
    return result.notebook;
  }, [actorHandle, announceChange, applyMutationSnapshot]);

  const renameNotebook = useCallback(async (notebook: WorkspaceNotebook, name: string) => {
    setStatus("Renaming notebook…");
    const result = await workspaceGateway.renameNotebook(actorHandle, notebook, name);
    applyMutationSnapshot({
      ...snapshotRef.current,
      notebooks: snapshotRef.current.notebooks.map((candidate) => candidate.id === notebook.id ? result.notebook : candidate),
      documents: snapshotRef.current.documents.map((document) => document.notebookId === notebook.id ? { ...document, notebookName: result.notebook.name } : document)
    });
    announceChange();
    setStatus("Notebook renamed");
    return result.notebook;
  }, [actorHandle, announceChange, applyMutationSnapshot]);

  const deleteNotebook = useCallback(async (notebook: WorkspaceNotebook) => {
    setStatus("Deleting notebook and its notes…");
    const result = await workspaceGateway.deleteNotebookWithContents(actorHandle, notebook);
    const deletedDocumentIds = new Set(result.deletedDocumentIds);
    applyMutationSnapshot({
      ...snapshotRef.current,
      notebooks: snapshotRef.current.notebooks.filter((candidate) => candidate.id !== result.notebookId),
      documents: snapshotRef.current.documents.filter((document) =>
        document.notebookId !== result.notebookId && !deletedDocumentIds.has(document.id)
      )
    });
    announceChange();
    setStatus(result.cleanupPending
      ? "Notebook and notes deleted; comment and attachment cleanup is finishing"
      : "Notebook and its notes deleted");
    void refresh({ quiet: true }).catch(() => undefined);
  }, [actorHandle, announceChange, applyMutationSnapshot, refresh]);

  const search = useCallback(async (query: string, options?: { kind?: string; notebookId?: string | null }) => {
    return workspaceGateway.search(actorHandle, query, options);
  }, [actorHandle]);

  const publishDocument = useCallback(async (
    document: WorkspaceDocument,
    publicationTarget?: "paper" | "thought" | "proposal" | "opportunity"
  ) => {
    setStatus("Publishing exact saved revision…");
    const result: WorkspacePublicationResponse = await workspaceGateway.publishDocument(
      actorHandle,
      document,
      publicationTarget
    );
    mutationEpochRef.current += 1;
    await refresh({ quiet: true });
    announceChange();
    setStatus("Published and moved out of the workspace");
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
    announceChange,
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
    publishDocument,
    announceChange
  ]);
};
