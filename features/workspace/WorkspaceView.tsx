"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  X
} from "lucide-react";
import { buildPostAttachmentMetadata } from "@/features/attachments/AttachmentViews";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import { createClientMutationId } from "@/features/api/symposiumApiClient";
import { RoomRender } from "@/features/shell/SymposiumShellViews";
import { WorkspaceDocumentCard, workspaceKindLabel } from "@/features/workspace/WorkspaceDocumentCard";
import { WorkspaceDocumentDetail } from "@/features/workspace/WorkspaceDocumentDetail";
import { useWorkspaceDocuments } from "@/features/workspace/useWorkspaceDocuments";
import { emptySymposiumDocument } from "@/lib/documentModel";
import type { ResearchProfile, Room } from "@/lib/mockData";
import type {
  WorkspaceDocument,
  WorkspacePublicationResponse,
  WorkspaceSearchResponse
} from "@/lib/workspaceTypes";

type WorkspaceSection = "all" | "notebooks" | "quick";
const creationKinds: WorkspaceDocument["kind"][] = ["note", "paper", "thought", "comment", "reply"];
const kindDescription: Record<WorkspaceDocument["kind"], string> = {
  note: "A flexible full-tooling note that can become a Paper or Thought",
  paper: "A full research draft destined for the Library",
  thought: "A reduced-tooling draft destined for the Amphitheater",
  comment: "A reduced draft linked to a post",
  reply: "A reduced draft linked to a comment",
  quick: "A light capture space reserved for the next pass"
};

export function WorkspaceView({
  room,
  actorHandle,
  profiles,
  onOpenSaved,
  onPublished
}: {
  room: Room;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenSaved: () => void;
  onPublished: (result: WorkspacePublicationResponse) => void;
}) {
  const workspace = useWorkspaceDocuments(actorHandle);
  const [section, setSection] = useState<WorkspaceSection>("all");
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [editSelected, setEditSelected] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

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
    if (query.trim() && searchResults) return searchResults.documents;
    if (section === "notebooks" && selectedNotebookId) {
      return workspace.snapshot.documents.filter((document) => document.notebookId === selectedNotebookId);
    }
    if (section === "quick") return [];
    return workspace.snapshot.documents;
  }, [query, searchResults, section, selectedNotebookId, workspace.snapshot.documents]);

  const createDocument = async (kind: WorkspaceDocument["kind"]) => {
    setNewMenuOpen(false);
    try {
      const document = await workspace.createDocument({
        title: `Untitled ${workspaceKindLabel[kind].toLowerCase()}`,
        body: "",
        document: emptySymposiumDocument(),
        kind,
        publicationTarget: kind === "paper" ? "paper" : kind === "thought" ? "thought" : kind === "comment" ? "comment" : kind === "reply" ? "reply" : "undecided",
        notebookId: section === "notebooks" ? selectedNotebookId : null,
        targetId: null,
        attachmentIds: []
      });
      setSelectedDocumentId(document.id);
      setEditSelected(true);
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
    } catch (error) {
      workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be created");
    }
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

  const publishCard = async (document: WorkspaceDocument) => {
    if (document.kind === "note" || document.kind === "comment" || document.kind === "reply" || !document.body.trim()) {
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

  if (selectedDocument) {
    return (
      <div className="room-layout workspace-room-layout">
        <WorkspaceDocumentDetail
          key={selectedDocument.id}
          document={selectedDocument}
          notebooks={workspace.snapshot.notebooks}
          profiles={profiles}
          initiallyEditing={editSelected}
          onBack={() => { setSelectedDocumentId(null); setEditSelected(false); }}
          onSave={(draft) => workspace.updateDocument(selectedDocument.id, draft)}
          onDelete={async () => {
            await workspace.deleteDocument(selectedDocument);
            setSelectedDocumentId(null);
            setEditSelected(false);
          }}
          onPublish={workspace.publishDocument}
          onPublished={onPublished}
          onUploadAttachment={uploadDraftAttachment}
        />
      </div>
    );
  }

  return (
    <div className="room-layout workspace-room-layout">
      <RoomRender room={room} onOpenNotebook={() => undefined} onOpenSaved={onOpenSaved} />
      <section className="feed-toolbar workspace-toolbar" aria-label="Notes workspace controls">
        <div className="room-mini-title">
          <p className="eyebrow">Private research workspace</p>
          <h1>Notes</h1>
          <p>Draft, organise, revise, and publish research without leaving your office.</p>
        </div>

        <div className="workspace-primary-row">
          <nav className="workspace-tabs" aria-label="Workspace sections">
            <button type="button" className={section === "all" ? "active" : ""} onClick={() => { setSection("all"); setSelectedNotebookId(null); }}><FileText size={16} />All</button>
            <button type="button" className={section === "notebooks" ? "active" : ""} onClick={() => setSection("notebooks")}><BookOpen size={16} />Notebooks</button>
            <button type="button" className={section === "quick" ? "active" : ""} onClick={() => { setSection("quick"); setSelectedNotebookId(null); }}><StickyNote size={16} />Quick Notes</button>
          </nav>
          <div className="workspace-create-wrap">
            <button type="button" className="workspace-new-button" onClick={() => setNewMenuOpen((open) => !open)}><FilePlus2 size={16} />New draft</button>
            {newMenuOpen ? (
              <div className="workspace-create-menu">
                <header><strong>Create in {selectedNotebookId ? workspace.snapshot.notebooks.find((notebook) => notebook.id === selectedNotebookId)?.name : "All"}</strong><button type="button" title="Close" onClick={() => setNewMenuOpen(false)}><X size={15} /></button></header>
                {creationKinds.map((kind) => <button type="button" key={kind} onClick={() => void createDocument(kind)}><span>{workspaceKindLabel[kind]}</span><small>{kindDescription[kind]}</small></button>)}
              </div>
            ) : null}
          </div>
        </div>

        <label className="workspace-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, authors, notebooks, content, comments, attachments…" />
          {searching ? <span>Searching…</span> : query ? <button type="button" title="Clear search" onClick={() => setQuery("")}><X size={15} /></button> : <kbd>⌘ K</kbd>}
        </label>

        <div className="workspace-sync-status" aria-live="polite">{workspace.error ? <span className="error">{workspace.error}</span> : workspace.status}</div>
      </section>

      {section === "notebooks" ? (
        <section className="workspace-notebooks" aria-label="Notebooks">
          <div className="workspace-notebook-rail">
            <button type="button" className={!selectedNotebookId ? "active" : ""} onClick={() => setSelectedNotebookId(null)}><Folder size={16} /><span><strong>All notebooks</strong><small>{workspace.snapshot.documents.filter((document) => document.notebookId).length} drafts</small></span></button>
            {workspace.snapshot.notebooks.map((notebook) => (
              <div className={`workspace-notebook-row ${selectedNotebookId === notebook.id ? "active" : ""}`} key={notebook.id}>
                <button type="button" onClick={() => setSelectedNotebookId(notebook.id)}><Folder size={16} /><span><strong>{notebook.name}</strong><small>{notebook.documentCount} {notebook.documentCount === 1 ? "draft" : "drafts"}</small></span></button>
                {notebook.role === "owner" ? (
                  <div className="workspace-notebook-actions">
                    <button type="button" title="Rename notebook" onClick={() => {
                      const name = window.prompt("Rename notebook", notebook.name)?.trim();
                      if (name && name !== notebook.name) void workspace.renameNotebook(notebook, name).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be renamed"));
                    }}><MoreHorizontal size={15} /></button>
                    <button type="button" title="Delete notebook" onClick={() => {
                      if (window.confirm(`Delete “${notebook.name}”? Its drafts will move to All.`)) void workspace.deleteNotebook(notebook).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Notebook could not be removed"));
                    }}><Trash2 size={14} /></button>
                  </div>
                ) : null}
              </div>
            ))}
            {creatingNotebook ? (
              <form onSubmit={(event) => { event.preventDefault(); void createNotebook(); }}><input autoFocus value={notebookName} maxLength={120} onChange={(event) => setNotebookName(event.target.value)} placeholder="Notebook name" /><div><button type="submit" disabled={!notebookName.trim()}>Create</button><button type="button" onClick={() => setCreatingNotebook(false)}>Cancel</button></div></form>
            ) : <button type="button" className="workspace-add-notebook" onClick={() => setCreatingNotebook(true)}><FolderPlus size={16} />New notebook</button>}
          </div>
          <div className="workspace-notebook-summary">
            <Sparkles size={18} />
            <div><strong>{selectedNotebookId ? workspace.snapshot.notebooks.find((notebook) => notebook.id === selectedNotebookId)?.name : "Notebooks"}</strong><p>{selectedNotebookId ? "Drafts inherit this notebook’s collaborator access. Direct document access can add to it." : "Choose a notebook or create one to give a line of research its own working space."}</p></div>
          </div>
        </section>
      ) : null}

      {query.trim() && searchResults && (searchResults.notebooks.length || searchResults.collaborators.length) ? (
        <section className="workspace-search-groups" aria-label="Additional workspace search results">
          {searchResults.notebooks.length ? <div><strong>Notebooks</strong>{searchResults.notebooks.map((notebook) => <button type="button" key={notebook.id} onClick={() => { setSection("notebooks"); setSelectedNotebookId(notebook.id); setQuery(""); }}><Folder size={15} />{notebook.name}</button>)}</div> : null}
          {searchResults.collaborators.length ? <div><strong>Authors & collaborators</strong>{searchResults.collaborators.map((collaborator) => <span key={collaborator.handle}>{collaborator.name}<small>{collaborator.handle}</small></span>)}</div> : null}
        </section>
      ) : null}

      {section === "quick" ? (
        <section className="workspace-quick-empty">
          <StickyNote size={30} />
          <h2>Quick Notes have a place.</h2>
          <p>The filing destination is ready. Fast capture, inbox processing, and promotion into full drafts arrive in the next workspace pass.</p>
        </section>
      ) : (
        <section className="feed-stream workspace-feed" aria-label="Workspace drafts">
          {workspace.loading && !visibleDocuments.length ? <div className="empty-feed"><strong>Opening your workspace…</strong><span>Checking the latest private revisions.</span></div> : null}
          {!workspace.loading && !visibleDocuments.length ? <div className="empty-feed"><strong>{query ? "No workspace results." : selectedNotebookId ? "This notebook is ready." : "Your workspace is ready."}</strong><span>{query ? "Try a title, author, notebook, phrase, attachment, or equation." : "Create a generic Note or a destination-specific draft."}</span></div> : null}
          {visibleDocuments.map((document) => (
            <WorkspaceDocumentCard
              key={document.id}
              document={document}
              profiles={profiles}
              onOpen={() => { setSelectedDocumentId(document.id); setEditSelected(false); }}
              onEdit={() => { setSelectedDocumentId(document.id); setEditSelected(true); }}
              onDelete={() => {
                if (window.confirm(`Delete “${document.title}”? This cannot be undone.`)) void workspace.deleteDocument(document).catch((error) => workspace.setStatus(error instanceof Error ? error.message : "Draft could not be deleted"));
              }}
              onPublish={() => void publishCard(document)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
