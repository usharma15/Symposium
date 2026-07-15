"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Search,
  StickyNote,
  Trash2,
  Users,
  X
} from "lucide-react";
import { buildPostAttachmentMetadata } from "@/features/attachments/AttachmentViews";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import { createClientMutationId } from "@/features/api/symposiumApiClient";
import { RoomRender } from "@/features/shell/SymposiumShellViews";
import { WorkspaceDocumentCard, workspaceKindLabel } from "@/features/workspace/WorkspaceDocumentCard";
import {
  WorkspaceDocumentDetail,
  type WorkspaceDocumentDetailHandle
} from "@/features/workspace/WorkspaceDocumentDetail";
import { WorkspaceNavigatorDocument } from "@/features/workspace/WorkspaceNavigatorDocument";
import { WorkspaceSharingDialog } from "@/features/workspace/WorkspaceSharingDialog";
import type { WorkspaceAccessTarget } from "@/features/workspace/useWorkspaceAccess";
import { useWorkspaceDocuments } from "@/features/workspace/useWorkspaceDocuments";
import {
  runAfterWorkspaceSave,
  sortWorkspaceDocuments,
  workspaceDocumentsInNotebook
} from "@/features/workspace/workspaceNavigator";
import { emptySymposiumDocument } from "@/lib/documentModel";
import type { ResearchProfile, Room } from "@/lib/mockData";
import type {
  WorkspaceDocument,
  WorkspacePublicationResponse,
  WorkspaceSearchResponse
} from "@/lib/workspaceTypes";

type WorkspaceSection = "all" | "notebooks" | "quick";
const creationKinds: WorkspaceDocument["kind"][] = ["note", "thought", "paper"];
const kindDescription: Record<WorkspaceDocument["kind"], string> = {
  note: "A flexible full-tooling note that can become a Paper or Thought",
  paper: "A full research draft destined for the Library",
  thought: "A reduced-tooling draft destined for the Amphitheater",
  comment: "A reduced draft linked to a post",
  reply: "A reduced draft linked to a comment",
  quick: "Filed Scribbles kept as private Quick Notes"
};

export function WorkspaceView({
  room,
  actorHandle,
  profiles,
  onOpenSaved,
  onPublished,
  onOpenProfile,
  initialDocumentId,
  initialCommentId
}: {
  room: Room;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenSaved: () => void;
  onPublished: (result: WorkspacePublicationResponse) => void;
  onOpenProfile: (handle: string) => void;
  initialDocumentId?: string;
  initialCommentId?: string;
}) {
  const workspace = useWorkspaceDocuments(actorHandle);
  const [section, setSection] = useState<WorkspaceSection>("all");
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(initialDocumentId ?? null);
  const [editSelected, setEditSelected] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(() => new Set());
  const [navigationPending, setNavigationPending] = useState(false);
  const [sharingTarget, setSharingTarget] = useState<WorkspaceAccessTarget | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const detailRef = useRef<WorkspaceDocumentDetailHandle>(null);
  const navigationInFlightRef = useRef(false);

  const selectedDocument = workspace.snapshot.documents.find((document) => document.id === selectedDocumentId) ?? null;
  useEffect(() => {
    if (selectedDocumentId && !selectedDocument && !workspace.loading) setSelectedDocumentId(null);
  }, [selectedDocument, selectedDocumentId, workspace.loading]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void workspace.search(trimmed, selectedNotebookId ? { notebookId: selectedNotebookId } : undefined)
        .then(setSearchResults)
        .catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Workspace search failed"))
        .finally(() => setSearching(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, selectedNotebookId, workspace.search, workspace.setStatus]);

  const visibleDocuments = useMemo(() => {
    const candidates = query.trim() && searchResults ? searchResults.documents : workspace.snapshot.documents;
    if (section === "notebooks") {
      const notebookDocuments = selectedNotebookId
        ? candidates.filter((document) => document.notebookId === selectedNotebookId)
        : candidates.filter((document) => Boolean(document.notebookId));
      return sortWorkspaceDocuments(notebookDocuments);
    }
    if (section === "quick") return sortWorkspaceDocuments(candidates.filter((document) => document.kind === "quick"));
    return sortWorkspaceDocuments(candidates);
  }, [query, searchResults, section, selectedNotebookId, workspace.snapshot.documents]);

  const afterSavingCurrent = useCallback(async (action: () => void | Promise<void>) => {
    if (navigationInFlightRef.current) return false;
    navigationInFlightRef.current = true;
    setNavigationPending(true);
    try {
      return await runAfterWorkspaceSave(async () => {
        if (!detailRef.current) return true;
        return Boolean(await detailRef.current.prepareForNavigation());
      }, action);
    } finally {
      navigationInFlightRef.current = false;
      setNavigationPending(false);
    }
  }, []);

  const openDocument = useCallback((documentId: string, editing = false) => {
    if (documentId === selectedDocumentId) {
      if (editing) setEditSelected(true);
      return;
    }
    void afterSavingCurrent(() => {
      setSelectedDocumentId(documentId);
      setEditSelected(editing);
    });
  }, [afterSavingCurrent, selectedDocumentId]);

  const clearSelectedDocument = useCallback(() => {
    void afterSavingCurrent(() => {
      setSelectedDocumentId(null);
      setEditSelected(false);
    });
  }, [afterSavingCurrent]);

  const changeSection = useCallback((nextSection: WorkspaceSection) => {
    void afterSavingCurrent(() => {
      setSection(nextSection);
      setSelectedNotebookId(null);
      setSelectedDocumentId(null);
      setEditSelected(false);
      setNewMenuOpen(false);
    });
  }, [afterSavingCurrent]);

  const toggleNotebook = useCallback((notebookId: string) => {
    setSection("notebooks");
    setSelectedNotebookId(notebookId);
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      if (next.has(notebookId)) next.delete(notebookId);
      else next.add(notebookId);
      return next;
    });
  }, []);

  const openNotebook = useCallback((notebookId: string) => {
    setSection("notebooks");
    setSelectedNotebookId(notebookId);
    setExpandedNotebookIds((current) => new Set(current).add(notebookId));
    setQuery("");
  }, []);

  const createDocument = async (kind: WorkspaceDocument["kind"]) => {
    setNewMenuOpen(false);
    try {
      await afterSavingCurrent(async () => {
        const document = await workspace.createDocument({
          title: `Untitled ${workspaceKindLabel[kind].toLowerCase()}`,
          body: "",
          document: emptySymposiumDocument(),
          kind,
          publicationTarget: kind === "paper" ? "paper" : kind === "thought" ? "thought" : kind === "comment" ? "comment" : kind === "reply" ? "reply" : "undecided",
          notebookId: section === "notebooks" ? selectedNotebookId : null,
          targetId: null,
          proposal: null,
          attachmentIds: []
        });
        setSelectedDocumentId(document.id);
        setEditSelected(true);
      });
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Draft could not be created");
    }
  };

  const createNotebook = async () => {
    const name = notebookName.trim();
    if (!name) return;
    try {
      const notebook = await workspace.createNotebook(name);
      setNotebookName("");
      setCreatingNotebook(false);
      setSection("notebooks");
      setSelectedNotebookId(notebook.id);
      setExpandedNotebookIds((current) => new Set(current).add(notebook.id));
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be created");
    }
  };

  const mutateNavigatorDocument = async (
    document: WorkspaceDocument,
    options: { saveCurrent: boolean; fallback: string },
    mutation: (current: WorkspaceDocument) => Promise<WorkspaceDocument | null>
  ) => {
    if (navigationInFlightRef.current) return null;
    navigationInFlightRef.current = true;
    setNavigationPending(true);
    try {
      let current = document;
      if (document.id === selectedDocumentId && detailRef.current) {
        const prepared = options.saveCurrent
          ? await detailRef.current.prepareForNavigation()
          : await detailRef.current.latestSavedDocument();
        if (!prepared) return null;
        current = prepared;
      }
      const updated = await mutation(current);
      if (updated && updated.id === selectedDocumentId) detailRef.current?.applySavedDocument(updated);
      return updated;
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : options.fallback);
      return null;
    } finally {
      navigationInFlightRef.current = false;
      setNavigationPending(false);
    }
  };

  const renameNavigatorDocument = (document: WorkspaceDocument) => {
    const title = window.prompt("Rename note", document.title)?.trim();
    if (!title || title === document.title) return;
    void mutateNavigatorDocument(
      document,
      { saveCurrent: true, fallback: "Note could not be renamed" },
      (current) => workspace.updateDocumentMetadata(current, { title })
    );
  };

  const moveNavigatorDocument = (document: WorkspaceDocument, notebookId: string | null) => {
    if (document.notebookId === notebookId) return;
    const currentNotebook = workspace.snapshot.notebooks.find((notebook) => notebook.id === document.notebookId);
    const nextNotebook = workspace.snapshot.notebooks.find((notebook) => notebook.id === notebookId);
    const affected = Math.max(currentNotebook?.collaboratorCount ?? 0, nextNotebook?.collaboratorCount ?? 0);
    if (affected && !window.confirm(`Moving this draft can change inherited access for up to ${affected} collaborator${affected === 1 ? "" : "s"}. Continue?`)) return;
    void mutateNavigatorDocument(
      document,
      { saveCurrent: true, fallback: "Note could not be moved" },
      (current) => workspace.updateDocumentMetadata(current, { notebookId })
    );
  };

  const deleteNavigatorDocument = (document: WorkspaceDocument) => {
    if (!window.confirm(`Delete “${document.title}”? This cannot be undone.`)) return;
    void mutateNavigatorDocument(
      document,
      { saveCurrent: false, fallback: "Draft could not be deleted" },
      async (current) => {
        await workspace.deleteDocument(current);
        if (current.id === selectedDocumentId) {
          setSelectedDocumentId(null);
          setEditSelected(false);
        }
        return null;
      }
    );
  };

  const uploadDraftAttachment = async (file: File) => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedAttachment({
      actorHandle,
      file,
      idempotencyKey: createClientMutationId("note-attachment-prepare"),
      metadata,
      ownerType: "note"
    });
  };

  const uploadDraftCommentAttachment = async (file: File) => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedAttachment({
      actorHandle,
      file,
      idempotencyKey: createClientMutationId("workspace-comment-attachment-upload"),
      metadata,
      ownerType: "note_comment"
    });
  };

  const publishCard = async (document: WorkspaceDocument) => {
    if (document.kind === "note" || document.kind === "comment" || document.kind === "reply" || !document.body.trim() || (document.publicationTarget === "proposal" && !document.proposal)) {
      setSelectedDocumentId(document.id);
      setEditSelected(true);
      return;
    }
    try {
      const result = await workspace.publishDocument(document);
      onPublished(result);
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Draft could not be published");
    }
  };

  return (
    <div className="room-layout workspace-room-layout">
      <RoomRender room={room} onOpenNotebook={() => undefined} onOpenSaved={onOpenSaved} />
      <aside className="feed-toolbar workspace-toolbar" aria-label="Notes workspace controls">
        <div className="room-mini-title">
          <p className="eyebrow">Private research workspace</p>
          <h1>Notes</h1>
        </div>

        <nav className="workspace-tabs" aria-label="Workspace sections">
          <button type="button" disabled={navigationPending} className={section === "all" ? "active" : ""} onClick={() => changeSection("all")}><FileText size={15} /><span>All</span></button>
          <button type="button" disabled={navigationPending} className={section === "notebooks" ? "active" : ""} onClick={() => changeSection("notebooks")}><BookOpen size={15} /><span>Notebooks</span></button>
          <button type="button" disabled={navigationPending} className={section === "quick" ? "active" : ""} onClick={() => changeSection("quick")}><StickyNote size={15} /><span>Quick Notes</span></button>
        </nav>

        <div className="workspace-create-wrap">
          <button type="button" disabled={navigationPending} className="workspace-new-button" onClick={() => setNewMenuOpen((open) => !open)}><FilePlus2 size={16} />New draft</button>
          {newMenuOpen ? (
            <div className="workspace-create-menu">
              <header><strong>Create in {selectedNotebookId ? workspace.snapshot.notebooks.find((notebook) => notebook.id === selectedNotebookId)?.name : "All"}</strong><button type="button" title="Close" onClick={() => setNewMenuOpen(false)}><X size={15} /></button></header>
              {creationKinds.map((kind) => <button type="button" key={kind} onClick={() => void createDocument(kind)}><span>{workspaceKindLabel[kind]}</span><small>{kindDescription[kind]}</small></button>)}
            </div>
          ) : null}
        </div>

        <label className="workspace-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, authors, notebooks, content, comments, attachments…" />
          {searching ? <span>Searching…</span> : query ? <button type="button" title="Clear search" onClick={() => setQuery("")}><X size={15} /></button> : <kbd>⌘ K</kbd>}
        </label>

        <div className={`workspace-sidebar-scroll workspace-sidebar-${section}`} aria-label={`${section === "quick" ? "Quick Notes" : section === "notebooks" ? "Notebooks" : "All drafts"} list`}>
          {workspace.error ? <div className="workspace-sidebar-error" role="alert">{workspace.error}</div> : null}

          {section === "notebooks" ? (
          <div className="workspace-notebook-rail">
            <div className="workspace-notebook-create">
              {creatingNotebook ? (
                <form onSubmit={(event) => { event.preventDefault(); void createNotebook(); }}><input autoFocus value={notebookName} maxLength={120} onChange={(event) => setNotebookName(event.target.value)} placeholder="Notebook name" /><div><button type="submit" disabled={!notebookName.trim()}>Create</button><button type="button" onClick={() => setCreatingNotebook(false)}>Cancel</button></div></form>
              ) : <button type="button" className="workspace-add-notebook" onClick={() => setCreatingNotebook(true)}><FolderPlus size={16} />New notebook</button>}
            </div>
            {workspace.snapshot.notebooks.map((notebook) => {
              const expanded = expandedNotebookIds.has(notebook.id);
              const notebookDocuments = workspaceDocumentsInNotebook(workspace.snapshot.documents, notebook.id);
              return (
                <div className="workspace-notebook-group" key={notebook.id}>
                  <div className={`workspace-notebook-row ${selectedNotebookId === notebook.id ? "active" : ""}`}>
                    <button type="button" disabled={navigationPending} aria-expanded={expanded} onClick={() => toggleNotebook(notebook.id)}><ChevronRight className={expanded ? "expanded" : ""} size={14} /><Folder size={16} /><span><strong>{notebook.name}</strong><small>{notebook.documentCount} {notebook.documentCount === 1 ? "draft" : "drafts"}</small></span></button>
                    <div className="workspace-notebook-actions">
                      <button type="button" className="workspace-notebook-share" title="Notebook sharing and access" aria-label={`Sharing and access for ${notebook.name}`} onClick={() => setSharingTarget({ type: "notebook", id: notebook.id })}><Users size={14} />{notebook.collaboratorCount ? <small>{notebook.collaboratorCount}</small> : null}</button>
                      {notebook.role === "owner" ? (
                        <>
                        <button type="button" title="Rename notebook" onClick={() => {
                          const name = window.prompt("Rename notebook", notebook.name)?.trim();
                          if (name && name !== notebook.name) void workspace.renameNotebook(notebook, name).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be renamed"));
                        }}><MoreHorizontal size={15} /></button>
                        <button type="button" title="Delete notebook" onClick={() => {
                          if (window.confirm(`Delete “${notebook.name}”? Its drafts will move to All.`)) {
                            void workspace.deleteNotebook(notebook).then(() => {
                              setExpandedNotebookIds((current) => { const next = new Set(current); next.delete(notebook.id); return next; });
                              if (selectedNotebookId === notebook.id) setSelectedNotebookId(null);
                            }).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be removed"));
                          }
                        }}><Trash2 size={14} /></button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {expanded ? (
                    <div className="workspace-notebook-documents" aria-label={`${notebook.name} notes`}>
                      {notebookDocuments.length ? notebookDocuments.map((document) => (
                        <WorkspaceNavigatorDocument
                          key={document.id}
                          document={document}
                          notebooks={workspace.snapshot.notebooks.filter((candidate) => candidate.ownerHandle === document.ownerHandle)}
                          active={selectedDocumentId === document.id}
                          compact
                          disabled={navigationPending}
                          onOpen={() => openDocument(document.id)}
                          onShare={() => setSharingTarget({ type: "document", id: document.id })}
                          onRename={() => renameNavigatorDocument(document)}
                          onMove={(notebookId) => moveNavigatorDocument(document, notebookId)}
                          onDelete={() => deleteNavigatorDocument(document)}
                        />
                      )) : <div className="workspace-notebook-empty">No notes in this notebook yet.</div>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          ) : null}

          {query.trim() && searchResults && (searchResults.notebooks.length || searchResults.collaborators.length) ? (
            <section className="workspace-search-groups" aria-label="Additional workspace search results">
              {searchResults.notebooks.length ? <div><strong>Notebooks</strong>{searchResults.notebooks.map((notebook) => <button type="button" key={notebook.id} onClick={() => openNotebook(notebook.id)}><Folder size={15} /><span>{notebook.name}</span></button>)}</div> : null}
              {searchResults.collaborators.length ? <div><strong>Authors & collaborators</strong>{searchResults.collaborators.map((collaborator) => <span key={collaborator.handle}><b>{collaborator.name}</b><small>{collaborator.handle}</small></span>)}</div> : null}
            </section>
          ) : null}

          {section === "notebooks" ? null : visibleDocuments.length ? (
            <div className="workspace-sidebar-list">
              {visibleDocuments.map((document) => (
                <WorkspaceNavigatorDocument
                  key={document.id}
                  document={document}
                  notebooks={workspace.snapshot.notebooks.filter((notebook) => notebook.ownerHandle === document.ownerHandle)}
                  active={selectedDocumentId === document.id}
                  disabled={navigationPending}
                  onOpen={() => openDocument(document.id)}
                  onShare={() => setSharingTarget({ type: "document", id: document.id })}
                  onRename={() => renameNavigatorDocument(document)}
                  onMove={(notebookId) => moveNavigatorDocument(document, notebookId)}
                  onDelete={() => deleteNavigatorDocument(document)}
                />
              ))}
            </div>
          ) : (
            <div className="workspace-sidebar-empty"><FileText size={18} /><strong>{searching ? "Searching…" : query ? "No results" : selectedNotebookId ? "Empty notebook" : "No drafts yet"}</strong><span>{query ? "Try another term." : "Create a draft to begin."}</span></div>
          )}
        </div>
      </aside>

      <main className="workspace-main-column">
        {selectedDocument ? (
          <WorkspaceDocumentDetail
            ref={detailRef}
            key={selectedDocument.id}
            document={selectedDocument}
            actorHandle={actorHandle}
            initialCommentId={selectedDocument.id === initialDocumentId ? initialCommentId : undefined}
            notebooks={workspace.snapshot.notebooks}
            profiles={profiles}
            initiallyEditing={editSelected}
            onBack={clearSelectedDocument}
            onShare={() => setSharingTarget({ type: "document", id: selectedDocument.id })}
            onSave={(draft) => workspace.updateDocument(selectedDocument.id, draft)}
            onDelete={async (current) => {
              await workspace.deleteDocument(current);
              setSelectedDocumentId(null);
              setEditSelected(false);
            }}
            onPublish={workspace.publishDocument}
            onPublished={onPublished}
            onUploadAttachment={uploadDraftAttachment}
            onUploadCommentAttachment={uploadDraftCommentAttachment}
            onOpenProfile={onOpenProfile}
          />
        ) : (
          <section className="feed-stream workspace-feed" aria-label="Workspace drafts">
            {workspace.loading && !visibleDocuments.length ? <div className="empty-feed"><strong>Opening your workspace…</strong><span>Checking the latest private revisions.</span></div> : null}
            {!workspace.loading && !visibleDocuments.length ? <div className="empty-feed"><strong>{query ? "No workspace results." : section === "quick" ? "No filed Scribbles yet." : selectedNotebookId ? "This notebook is ready." : "Your workspace is ready."}</strong><span>{query ? "Try a title, author, notebook, phrase, attachment, or equation." : section === "quick" ? "File the active Scribble to keep it here as a Quick Note." : "Create a generic Note or a destination-specific draft."}</span></div> : null}
            {visibleDocuments.map((document) => (
              <WorkspaceDocumentCard
                key={document.id}
                document={document}
                profiles={profiles}
                onOpen={() => openDocument(document.id)}
                onEdit={() => openDocument(document.id, true)}
                onShare={() => setSharingTarget({ type: "document", id: document.id })}
                onDelete={() => {
                  if (window.confirm(`Delete “${document.title}”? This cannot be undone.`)) void workspace.deleteDocument(document).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Draft could not be deleted"));
                }}
                onPublish={() => void publishCard(document)}
              />
            ))}
          </section>
        )}
      </main>
      {sharingTarget ? (
        <WorkspaceSharingDialog
          target={sharingTarget}
          actorHandle={actorHandle}
          onClose={() => setSharingTarget(null)}
          onChanged={async () => {
            await workspace.refresh({ quiet: true });
            workspace.announceChange();
          }}
          onLostAccess={() => {
            if (sharingTarget.type === "document" && selectedDocumentId === sharingTarget.id) {
              setSelectedDocumentId(null);
              setEditSelected(false);
            }
            setSharingTarget(null);
            void workspace.refresh({ quiet: true });
          }}
          onOpenNotebookAccess={(notebookId) => setSharingTarget({ type: "notebook", id: notebookId })}
        />
      ) : null}
    </div>
  );
}
