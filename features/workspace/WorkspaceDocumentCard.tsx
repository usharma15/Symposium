"use client";

import { FileText, MessageCircle, Paperclip, Pencil, Send, Trash2, Users } from "lucide-react";
import { SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import type { ResearchProfile } from "@/lib/mockData";
import { localDateTimeLabel, relativeTimeLabel } from "@/lib/symposiumCore";
import type { WorkspaceDocument } from "@/lib/workspaceTypes";

export const workspaceKindLabel: Record<WorkspaceDocument["kind"], string> = {
  note: "Note",
  paper: "Paper",
  thought: "Thought",
  comment: "Comment",
  reply: "Reply",
  quick: "Quick Note"
};

export function WorkspaceDocumentCard({
  document,
  profiles,
  onOpen,
  onEdit,
  onShare,
  onDelete,
  onPublish
}: {
  document: WorkspaceDocument;
  profiles: Record<string, ResearchProfile>;
  onOpen: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
  onPublish: () => void;
}) {
  const owner = profileForHandle(profiles, document.ownerHandle);
  const ownerName = owner?.name ?? document.ownerName ?? document.ownerHandle;
  return (
    <article
      className={`feed-post workspace-document-card workspace-kind-${document.kind}`}
      data-testid={`workspace-card-${document.id}`}
      onClick={onOpen}
    >
      <div className="workspace-card-controls" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="workspace-sharing-trigger" title="View sharing and access" aria-label={`Sharing and access for ${document.title}`} onClick={onShare}><Users size={15} />{document.collaboratorCount ? <small>{document.collaboratorCount}</small> : null}</button>
        {document.access.canEdit ? <button type="button" title="Edit draft" onClick={onEdit}><Pencil size={15} /></button> : null}
        {document.access.canDelete ? <button type="button" title="Delete draft" onClick={onDelete}><Trash2 size={15} /></button> : null}
      </div>
      <div className="post-author workspace-document-author">
        <span className="avatar">
          {owner?.avatarUrl ? <img src={owner.avatarUrl} alt="" /> : profileInitials(ownerName)}
        </span>
        <span>
          <strong>{ownerName}</strong>
          <small>Created {relativeTimeLabel(document.createdAt, document.createdAt)}</small>
        </span>
      </div>
      <div className="post-body">
        <div className="workspace-draft-line">
          <strong>Draft · {workspaceKindLabel[document.kind]}</strong>
          {document.notebookName ? <><b aria-hidden="true">•</b><span>{document.notebookName}</span></> : null}
          {document.lifecycle === "published" ? <span className="workspace-published-badge">Published checkpoint</span> : null}
        </div>
        <h2><button type="button" className="workspace-card-title-button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>{document.title}</button></h2>
        <SymposiumDocumentRenderer
          document={document.document}
          body={document.body}
          attachments={document.attachments}
          profiles={profiles}
          mode="feed"
        />
        <div className="workspace-card-footer">
          <span>Created {localDateTimeLabel(document.createdAt)}</span>
          <span>Edited {relativeTimeLabel(document.updatedAt, document.updatedAt)}</span>
          <span><FileText size={14} />Revision {document.revision}</span>
          {document.attachments.length ? <span><Paperclip size={14} />{document.attachments.length}</span> : null}
        </div>
        <div className="social-actions workspace-card-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" title="Draft discussion" onClick={onOpen}><MessageCircle size={16} /><span className="metric-label">Comments</span><strong>{document.commentCount}</strong></button>
          {document.access.canPublish ? <button type="button" title="Publish saved revision" onClick={onPublish}><Send size={16} /><span className="metric-label">Post</span></button> : null}
        </div>
      </div>
    </article>
  );
}
