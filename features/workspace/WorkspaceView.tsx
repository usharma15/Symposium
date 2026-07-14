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

const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

const workspaceDateGroup = (value: string, now = new Date()) => {
  const date = new Date(value);
  const elapsedDays = Math.floor((dayStart(now) - dayStart(date)) / 86_400_000);
  if (elapsedDays === 0) return "Today";
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 30) return "Previous 30 Days";
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { month: "long" });
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

const workspaceSidebarTimestamp = (value: string, now = new Date()) => {
  const date = new Date(value);
  if (dayStart(date) === dayStart(now)) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const workspaceSidebarExcerpt = (document: WorkspaceDocument) =>
  document.body.replace(/\s+/g, " ").trim() || `${workspaceKindLabel[document.kind]} draft`;

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
    const candidates = query.trim() && searchResults ? searchResults.documents : workspace.snapshot.documents;
    if (section === "notebooks") {
      const notebookDocuments = selectedNotebookId
        ? candidates.filter((document) => document.notebookId === selectedNotebookId)
        : candidates.filter((document) => Boolean(document.notebookId));
      return [...notebookDocuments].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    }
    if (section === "quick") return [];
    return [...candidates].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [query, searchResults, section, selectedNotebookId, workspace.snapshot.documents]);

  const groupedDocuments = useMemo(() => {
    const groups = new Map<string, WorkspaceDocument[]>();
    visibleDocuments.forEach((document) => {
      const group = workspaceDateGroup(document.updatedAt);
      const documents = groups.get(group);
      if (documents) documents.push(document);
      else groups.set(group, [document]);
    });
    return [...groups.entries()];
  }, [visibleDocuments]);

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

  return (
    <div className="room-layout workspace-room-layout">
      <RoomRender room={room} onOpenNotebook={() => undefined} onOpenSaved={onOpenSaved} />
      <aside className="feed-toolbar workspace-toolbar" aria-label="Notes workspace controls">
        <div className="room-mini-title">
          <p className="eyebrow">Private research workspace</p>
          <h1>Notes</h1>
          <p>Draft, organise, revise, and publish research without leaving your office.</p>
        </div>

        <nav className="workspace-tabs" aria-label="Workspace sections">
          <button type="button" className={section === "all" ? "active" : ""} onClick={() => { setSection("all"); setSelectedNotebookId(null); setSelectedDocumentId(null); setEditSelected(false); }}><FileText size={15} /><span>All</span></button>
          <button type="button" className={section === "notebooks" ? "active" : ""} onClick={() => { setSection("notebooks"); setSelectedDocumentId(null); setEditSelected(false); }}><BookOpen size={15} /><span>Notebooks</span></button>
          <button type="button" className={section === "quick" ? "active" : ""} onClick={() => { setSection("quick"); setSelectedNotebookId(null); setSelectedDocumentId(null); setEditSelected(false); }}><StickyNote size={15} /><span>Quick Notes</span></button>
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

        <label className="workspace-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, authors, notebooks, content, comments, attachments…" />
          {searching ? <span>Searching…</span> : query ? <button type="button" title="Clear search" onClick={() => setQuery("")}><X size={15} /></button> : <kbd>⌘ K</kbd>}
        </label>

        <div className="workspace-sync-status" aria-live="polite">{workspace.error ? <span className="error">{workspace.error}</span> : workspace.status}</div>

        <div className="workspace-sidebar-scroll" aria-label={`${section === "quick" ? "Quick Notes" : section === "notebooks" ? "Notebook drafts" : "All drafts"} list`}>
          {section === "notebooks" ? (
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
          ) : null}

          {query.trim() && searchResults && (searchResults.notebooks.length || searchResults.collaborators.length) ? (
            <section className="workspace-search-groups" aria-label="Additional workspace search results">
              {searchResults.notebooks.length ? <div><strong>Notebooks</strong>{searchResults.notebooks.map((notebook) => <button type="button" key={notebook.id} onClick={() => { setSection("notebooks"); setSelectedNotebookId(notebook.id); setSelectedDocumentId(null); setQuery(""); }}><Folder size={15} /><span>{notebook.name}</span></button>)}</div> : null}
              {searchResults.collaborators.length ? <div><strong>Authors & collaborators</strong>{searchResults.collaborators.map((collaborator) => <span key={collaborator.handle}><b>{collaborator.name}</b><small>{collaborator.handle}</small></span>)}</div> : null}
            </section>
          ) : null}

          {section === "quick" ? (
            <div className="workspace-sidebar-empty"><StickyNote size={18} /><strong>Quick Notes</strong><span>Your quick-capture inbox will appear here.</span></div>
          ) : groupedDocuments.length ? groupedDocuments.map(([label, documents]) => (
            <section className="workspace-sidebar-group" key={label} aria-label={label}>
              <h2>{label}</h2>
              {documents.map((document) => (
                <button
                  type="button"
                  className={`workspace-sidebar-document ${selectedDocumentId === document.id ? "active" : ""}`}
                  key={document.id}
                  onClick={() => { setSelectedDocumentId(document.id); setEditSelected(false); }}
                >
                  <strong>{document.title || "Untitled note"}</strong>
                  <span><time>{workspaceSidebarTimestamp(document.updatedAt)}</time><small>{workspaceSidebarExcerpt(document)}</small></span>
                  <em>{workspaceKindLabel[document.kind]}{document.notebookName ? ` · ${document.notebookName}` : ""}</em>
                </button>
              ))}
            </section>
          )) : (
            <div className="workspace-sidebar-empty"><FileText size={18} /><strong>{searching ? "Searching…" : query ? "No results" : selectedNotebookId ? "Empty notebook" : "No drafts yet"}</strong><span>{query ? "Try another term." : "Create a draft to begin."}</span></div>
          )}
        </div>
      </aside>

      <main className="workspace-main-column">
        {selectedDocument ? (
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
        ) : section === "quick" ? (
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
      </main>
    </div>
  );
}
