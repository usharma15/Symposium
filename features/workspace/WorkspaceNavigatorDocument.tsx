"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { workspaceKindLabel } from "@/features/workspace/WorkspaceDocumentCard";
import type { WorkspaceDocument, WorkspaceNotebook } from "@/lib/workspaceTypes";

type DocumentMenu = "actions" | "move" | null;

const workspaceSidebarTimestamp = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });

const workspaceSidebarExcerpt = (document: WorkspaceDocument) =>
  document.body.replace(/\s+/g, " ").trim() || `${workspaceKindLabel[document.kind]} draft`;

export function WorkspaceNavigatorDocument({
  document,
  notebooks,
  active,
  compact = false,
  disabled = false,
  onOpen,
  onRename,
  onMove,
  onDelete
}: {
  document: WorkspaceDocument;
  notebooks: WorkspaceNotebook[];
  active: boolean;
  compact?: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onRename: () => void;
  onMove: (notebookId: string | null) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState<DocumentMenu>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const canOrganize = document.access.canEdit;
  const hasActions = canOrganize || document.access.canDelete;

  useEffect(() => {
    if (!menu) return;
    const closeForPointer = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", closeForPointer);
    window.addEventListener("keydown", closeForEscape);
    return () => {
      window.removeEventListener("pointerdown", closeForPointer);
      window.removeEventListener("keydown", closeForEscape);
    };
  }, [menu]);

  const title = document.title || "Untitled note";
  return (
    <div className={`workspace-sidebar-document-row ${active ? "active" : ""} ${compact ? "compact" : ""}`}>
      <button
        type="button"
        className="workspace-sidebar-document"
        disabled={disabled}
        onClick={onOpen}
      >
        <strong>{title}</strong>
        <span className="workspace-sidebar-preview">{workspaceSidebarExcerpt(document)}</span>
        <span className="workspace-sidebar-meta">
          <time>{workspaceSidebarTimestamp(document.updatedAt)}</time>
          <em>{workspaceKindLabel[document.kind]}</em>
          {!compact && document.notebookName ? <small>{document.notebookName}</small> : null}
        </span>
      </button>

      {hasActions ? (
        <div className="workspace-sidebar-document-actions" ref={actionsRef}>
          <button
            type="button"
            className="workspace-sidebar-more"
            aria-label={`Actions for ${title}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            disabled={disabled}
            onClick={() => setMenu((current) => current ? null : "actions")}
          ><MoreHorizontal size={16} /></button>
          {menu ? (
            <div className="workspace-sidebar-document-menu" role="menu" aria-label={`Actions for ${title}`}>
              {menu === "actions" ? (
                <>
                  {canOrganize ? <button type="button" role="menuitem" onClick={() => { setMenu(null); onRename(); }}><Pencil size={14} />Rename</button> : null}
                  {canOrganize ? <button type="button" role="menuitem" onClick={() => setMenu("move")}><FolderInput size={14} />Move to notebook</button> : null}
                  {document.access.canDelete ? <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); onDelete(); }}><Trash2 size={14} />Delete</button> : null}
                </>
              ) : (
                <>
                  <header><button type="button" title="Back to note actions" onClick={() => setMenu("actions")}><ArrowLeft size={14} /></button><strong>Move to</strong></header>
                  <button type="button" role="menuitem" disabled={document.notebookId === null} onClick={() => { setMenu(null); onMove(null); }}><span>All · Unfiled</span>{document.notebookId === null ? <Check size={13} /> : null}</button>
                  {notebooks.map((notebook) => (
                    <button type="button" role="menuitem" key={notebook.id} disabled={document.notebookId === notebook.id} onClick={() => { setMenu(null); onMove(notebook.id); }}>
                      <span>{notebook.name}</span>{document.notebookId === notebook.id ? <Check size={13} /> : null}
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
