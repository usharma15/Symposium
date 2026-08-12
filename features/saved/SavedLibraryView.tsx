"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  Bookmark,
  Folder,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Undo2
} from "lucide-react";
import type { PostActionHandler, CommentActionHandler } from "@/features/actions/actionTypes";
import type { AttachmentPreviewHandler } from "@/features/attachments/AttachmentViews";
import type { CommentAttachmentPreviewHandler } from "@/features/comments/CommentThread";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import { FeedPost } from "@/features/posts/PostViews";
import { ProfileCommentCard, type ProfileCommentActivity } from "@/features/profiles/ProfileViews";
import type { QuoteActionHandler } from "@/features/quotes/QuoteViews";
import { RoomRender } from "@/features/shell/SymposiumShellViews";
import type { InquiryComment, InquiryItem, ResearchProfile, Room } from "@/lib/mockData";
import { findCommentInTree, localDateTimeLabel, relativeTimeLabel } from "@/lib/symposiumCore";
import type {
  SavedLibraryEntryContract,
  SavedLibraryFolderContract,
  SavedLibraryResponseContract
} from "@/packages/contracts/src";

type SavedSection = "all" | "folder" | "archived";
type SavedSort =
  | "recently_saved"
  | "oldest_saved"
  | "alphabetical"
  | "likes"
  | "saves"
  | "comments"
  | "views"
  | "reshares"
  | "created_newest"
  | "created_oldest";

type AsyncPostActionHandler = (...args: Parameters<PostActionHandler>) => void | Promise<void>;
type AsyncCommentActionHandler = (...args: Parameters<CommentActionHandler>) => void | Promise<void>;

export type ResolvedSavedEntry = {
  entry: SavedLibraryEntryContract;
  item: InquiryItem | null;
  comment: InquiryComment | null;
  title: string;
  preview: string;
  createdAt: string;
  authorHandle: string;
  authorName: string;
  likes: number;
  saves: number;
  comments: number;
  views: number;
  reshares: number;
};

const sortOptions: Array<{ value: SavedSort; label: string }> = [
  { value: "recently_saved", label: "Recently added" },
  { value: "oldest_saved", label: "Oldest added" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "likes", label: "Most likes" },
  { value: "saves", label: "Most saves" },
  { value: "comments", label: "Most comments" },
  { value: "views", label: "Most views" },
  { value: "reshares", label: "Most reshares" },
  { value: "created_newest", label: "Date created · newest" },
  { value: "created_oldest", label: "Date created · oldest" }
];

const numberMetric = (value?: string) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const commentCount = (comments: InquiryComment[]): number => comments.reduce(
  (total, comment) => total + (comment.deletedAt ? 0 : 1) + commentCount(comment.replies ?? []),
  0
);

const textPreview = (value: string, fallback: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
};

export const resolveSavedLibraryEntry = (
  entry: SavedLibraryEntryContract,
  item: InquiryItem | undefined
): ResolvedSavedEntry => {
  const comment = entry.subjectType === "comment" && item
    ? findCommentInTree(item.comments, entry.subjectId) ?? null
    : null;
  const body = comment?.body ?? item?.body ?? item?.excerpt ?? "";
  const preview = textPreview(body, "This saved item is no longer available in its original context.");
  const postTitle = textPreview(item?.title ?? "", preview.slice(0, 96));
  const title = comment ? `Comment on ${postTitle}` : postTitle;
  const metrics = comment?.metrics ?? item?.metrics;
  return {
    entry,
    item: item ?? null,
    comment,
    title,
    preview,
    createdAt: comment?.createdAt ?? item?.createdAt ?? entry.savedAt,
    authorHandle: comment?.authorHandle ?? item?.authorHandle ?? "",
    authorName: comment?.author ?? item?.author ?? "Unavailable author",
    likes: numberMetric(metrics?.signal),
    saves: numberMetric(metrics?.saves),
    comments: comment ? commentCount(comment.replies ?? []) : Number(item?.commentCount ?? commentCount(item?.comments ?? [])),
    views: numberMetric(metrics?.reads),
    reshares: numberMetric(metrics?.forks)
  };
};

export const compareSavedLibraryEntries = (sort: SavedSort) => (left: ResolvedSavedEntry, right: ResolvedSavedEntry) => {
  const stable = () => right.entry.subjectId.localeCompare(left.entry.subjectId);
  if (sort === "recently_saved") return Date.parse(right.entry.savedAt) - Date.parse(left.entry.savedAt) || stable();
  if (sort === "oldest_saved") return Date.parse(left.entry.savedAt) - Date.parse(right.entry.savedAt) || stable();
  if (sort === "alphabetical") return left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || stable();
  if (sort === "created_newest") return Date.parse(right.createdAt) - Date.parse(left.createdAt) || stable();
  if (sort === "created_oldest") return Date.parse(left.createdAt) - Date.parse(right.createdAt) || stable();
  return right[sort] - left[sort] || Date.parse(right.entry.savedAt) - Date.parse(left.entry.savedAt) || stable();
};

const emptyLibrary: SavedLibraryResponseContract = { entries: [], folders: [], items: [], profiles: {} };
const entryKey = (entry: SavedLibraryEntryContract) => `${entry.subjectType}:${entry.subjectId}`;

export function SavedLibraryView({
  room,
  actorHandle,
  profiles,
  onOpenNotes,
  onSelect,
  onOpenProfile,
  onAction,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditPost,
  onDeletePost,
  onEditComment,
  onDeleteComment,
  onOpenAttachmentPreview,
  onOpenCommentAttachmentPreview
}: {
  room: Room;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenNotes: () => void;
  onSelect: (postId: string, commentId?: string | null) => void;
  onOpenProfile: (handle: string) => void;
  onAction: AsyncPostActionHandler;
  onCommentAction: AsyncCommentActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onOpenCommentAttachmentPreview: CommentAttachmentPreviewHandler;
}) {
  const [library, setLibrary] = useState<SavedLibraryResponseContract>(emptyLibrary);
  const [section, setSection] = useState<SavedSection>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [sort, setSort] = useState<SavedSort>("recently_saved");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);

  const load = useCallback(async (announce = false) => {
    setLoading(true);
    try {
      const next = await symposiumApi.request<SavedLibraryResponseContract>(
        `/api/saved-library?actorHandle=${encodeURIComponent(actorHandle)}`,
        { cache: "no-store" }
      );
      setLibrary(next);
      setSelectedFolderId((current) => current && next.folders.some((folder) => folder.id === current) ? current : null);
      if (announce) setStatus("Saved library refreshed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saved library could not load");
    } finally {
      setLoading(false);
    }
  }, [actorHandle]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemById = useMemo(() => new Map(library.items.map((item) => [item.id, item])), [library.items]);
  const resolvedEntries = useMemo(
    () => library.entries.map((entry) => resolveSavedLibraryEntry(entry, itemById.get(entry.postId))),
    [itemById, library.entries]
  );
  const selectedFolder = library.folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return resolvedEntries
      .filter((resolved) => section === "archived" ? Boolean(resolved.entry.archivedAt) : !resolved.entry.archivedAt)
      .filter((resolved) => section !== "folder" || resolved.entry.folderId === selectedFolderId)
      .filter((resolved) => !normalizedQuery || `${resolved.title} ${resolved.preview} ${resolved.authorName}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(compareSavedLibraryEntries(sort));
  }, [query, resolvedEntries, section, selectedFolderId, sort]);
  const activeCount = library.entries.filter((entry) => !entry.archivedAt).length;
  const archivedCount = library.entries.length - activeCount;
  const mergedProfiles = { ...profiles, ...library.profiles };

  const mutate = useCallback(async (key: string, action: () => Promise<void>, success: string) => {
    setBusyKey(key);
    setStatus("");
    try {
      await action();
      await load();
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saved library could not be changed");
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const updateEntry = (entry: SavedLibraryEntryContract, change: { folderId?: string | null; archived?: boolean }) =>
    mutate(entryKey(entry), async () => {
      await symposiumApi.request("/api/saved-library/entries", {
        method: "PATCH",
        actorHandle,
        idempotencyKey: createClientMutationId("saved-library-entry"),
        body: {
          subjectType: entry.subjectType,
          subjectId: entry.subjectId,
          expectedRevision: entry.revision,
          ...change
        }
      });
    }, change.archived === true ? "Moved to Archive for 60 days" : change.archived === false ? "Restored to All Saved" : "Folder updated");

  const createFolder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    void mutate("folder:new", async () => {
      await symposiumApi.request("/api/saved-library/folders", {
        method: "POST",
        actorHandle,
        idempotencyKey: createClientMutationId("saved-library-folder-create"),
        body: { name }
      });
      setNewFolderName("");
    }, "Folder created");
  };

  const renameFolder = (folder: SavedLibraryFolderContract) => {
    const name = editingFolderName.trim();
    if (!name) return;
    void mutate(`folder:${folder.id}`, async () => {
      await symposiumApi.request(`/api/saved-library/folders/${encodeURIComponent(folder.id)}`, {
        method: "PATCH",
        actorHandle,
        idempotencyKey: createClientMutationId("saved-library-folder-update"),
        body: { name, expectedRevision: folder.revision }
      });
      setEditingFolderId(null);
      setEditingFolderName("");
    }, "Folder renamed");
  };

  const deleteFolder = (folder: SavedLibraryFolderContract) => {
    void mutate(`folder:${folder.id}`, async () => {
      await symposiumApi.request(`/api/saved-library/folders/${encodeURIComponent(folder.id)}`, {
        method: "DELETE",
        actorHandle,
        idempotencyKey: createClientMutationId("saved-library-folder-delete"),
        body: { expectedRevision: folder.revision }
      });
      setConfirmDeleteFolderId(null);
      if (selectedFolderId === folder.id) {
        setSection("all");
        setSelectedFolderId(null);
      }
    }, "Folder removed; its saved items remain in All Saved");
  };

  const chooseAll = () => {
    setSection("all");
    setSelectedFolderId(null);
  };
  const chooseArchived = () => {
    setSection("archived");
    setSelectedFolderId(null);
  };
  const chooseFolder = (folderId: string) => {
    setSection("folder");
    setSelectedFolderId(folderId);
  };

  const handlePostAction: PostActionHandler = (itemId, action, options) => {
    void Promise.resolve(onAction(itemId, action, options)).then(() => {
      if (action !== "read") return load();
    }).catch(() => undefined);
  };
  const handleCommentAction: CommentActionHandler = (itemId, commentId, action, options) => {
    void Promise.resolve(onCommentAction(itemId, commentId, action, options)).then(() => {
      if (action !== "read") return load();
    }).catch(() => undefined);
  };

  return (
    <div className="room-layout workspace-room-layout saved-library-room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} />

      <aside className="feed-toolbar workspace-toolbar saved-library-toolbar" aria-label="Saved for later controls">
        <div className="room-mini-title">
          <p className="eyebrow">Private Office library</p>
          <h1>Saved for later</h1>
          <p>Posts and comments you marked for return.</p>
        </div>

        <nav className="saved-library-nav" aria-label="Saved library sections and folders">
          <button type="button" className={section === "all" ? "active" : ""} onClick={chooseAll}>
            <Bookmark size={16} /><span>All Saved</span><small>{activeCount}</small>
          </button>

          <div className="saved-library-folder-heading">
            <strong>Folders</strong><small>{library.folders.length}</small>
          </div>
          <form className="saved-library-folder-create" onSubmit={createFolder}>
            <FolderPlus size={15} />
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={80} placeholder="Create a folder" />
            <button type="submit" disabled={!newFolderName.trim() || busyKey === "folder:new"}>Create</button>
          </form>
          <div className="saved-library-folder-list" aria-label="Saved folders">
            {library.folders.map((folder) => (
              <div key={folder.id} className={`saved-library-folder-row${selectedFolderId === folder.id && section === "folder" ? " active" : ""}`} data-testid={`saved-folder-${folder.id}`}>
                {editingFolderId === folder.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); renameFolder(folder); }}>
                    <input value={editingFolderName} onChange={(event) => setEditingFolderName(event.target.value)} maxLength={80} autoFocus />
                    <button type="submit" disabled={!editingFolderName.trim() || busyKey === `folder:${folder.id}`}>Save</button>
                  </form>
                ) : (
                  <>
                    <button type="button" className="saved-library-folder-open" onClick={() => chooseFolder(folder.id)}>
                      <Folder size={15} />
                      <span>{folder.name}</span>
                      <small>{folder.itemCount}</small>
                    </button>
                    <div className="saved-library-folder-actions">
                      <button type="button" title={`Rename ${folder.name}`} aria-label={`Rename ${folder.name}`} onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setConfirmDeleteFolderId(null); }}><Pencil size={12} /></button>
                      {confirmDeleteFolderId === folder.id ? (
                        <button type="button" className="danger confirm" onClick={() => deleteFolder(folder)} disabled={busyKey === `folder:${folder.id}`}>Confirm</button>
                      ) : (
                        <button type="button" title={`Delete ${folder.name}`} aria-label={`Delete ${folder.name}`} onClick={() => { setConfirmDeleteFolderId(folder.id); setEditingFolderId(null); }}><Trash2 size={12} /></button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            {!library.folders.length ? <p>No folders yet.</p> : null}
          </div>

          <button type="button" className={section === "archived" ? "active" : ""} onClick={chooseArchived}>
            <Archive size={16} /><span>Archived</span><small>{archivedCount}</small>
          </button>
        </nav>

        <label className="workspace-search saved-library-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved work" />
        </label>

        <label className="saved-library-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SavedSort)}>
            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <div className="saved-library-toolbar-foot">
          <button type="button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          <p aria-live="polite">{status || (section === "archived" ? "Archived saves expire after 60 days." : selectedFolder ? selectedFolder.name : "Organize without changing the original work.")}</p>
        </div>
      </aside>

      <main className="workspace-main-column saved-library-main">
        {loading && !library.entries.length ? (
          <div className="empty-feed saved-library-empty"><strong>Loading every saved post and comment…</strong><span>The Office is reconciling the same canonical saves shown on your profile.</span></div>
        ) : visibleEntries.length ? (
          <section className="feed-stream saved-library-list" aria-label={section === "archived" ? "Archived saves" : selectedFolder?.name ?? "All saved items"}>
            {visibleEntries.map((resolved) => (
              <SavedLibraryFeedEntry
                key={entryKey(resolved.entry)}
                resolved={resolved}
                folders={library.folders}
                profiles={mergedProfiles}
                actorHandle={actorHandle}
                busy={busyKey === entryKey(resolved.entry)}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onAction={handlePostAction}
                onCommentAction={handleCommentAction}
                onQuote={onQuote}
                onOpenQuote={onOpenQuote}
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onOpenAttachmentPreview={onOpenAttachmentPreview}
                onOpenCommentAttachmentPreview={onOpenCommentAttachmentPreview}
                onFolder={(folderId) => void updateEntry(resolved.entry, { folderId })}
                onArchive={(archived) => void updateEntry(resolved.entry, { archived })}
              />
            ))}
          </section>
        ) : (
          <div className="empty-feed saved-library-empty">
            <strong>{query.trim() ? "No saved work matches that search." : section === "archived" ? "Archive is empty." : selectedFolder ? "This folder is empty." : "Nothing saved yet."}</strong>
            <span>{section === "archived" ? "Archived saves stay here for 60 days unless restored." : "Save a post or comment anywhere on Symposium and it will appear here."}</span>
          </div>
        )}
      </main>
    </div>
  );
}

function SavedLibraryFeedEntry({
  resolved,
  folders,
  profiles,
  actorHandle,
  busy,
  onSelect,
  onOpenProfile,
  onAction,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditPost,
  onDeletePost,
  onEditComment,
  onDeleteComment,
  onOpenAttachmentPreview,
  onOpenCommentAttachmentPreview,
  onFolder,
  onArchive
}: {
  resolved: ResolvedSavedEntry;
  folders: SavedLibraryFolderContract[];
  profiles: Record<string, ResearchProfile>;
  actorHandle: string;
  busy: boolean;
  onSelect: (postId: string, commentId?: string | null) => void;
  onOpenProfile: (handle: string) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onOpenCommentAttachmentPreview: CommentAttachmentPreviewHandler;
  onFolder: (folderId: string | null) => void;
  onArchive: (archived: boolean) => void;
}) {
  const expiresIn = resolved.entry.archiveExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(resolved.entry.archiveExpiresAt) - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;
  const commentActivity: ProfileCommentActivity | null = resolved.item && resolved.comment ? {
    id: entryKey(resolved.entry),
    item: resolved.item,
    comment: resolved.comment,
    kind: "save",
    label: "Saved comment",
    recency: Date.parse(resolved.entry.savedAt)
  } : null;

  return (
    <div className={`saved-library-feed-entry ${resolved.entry.subjectType}`} data-testid={`saved-entry-${resolved.entry.subjectType}-${resolved.entry.subjectId}`}>
      {resolved.entry.subjectType === "post" && resolved.item ? (
        <FeedPost
          item={resolved.item}
          onSelect={onSelect}
          onOpenProfile={onOpenProfile}
          onAction={onAction}
          onQuote={onQuote}
          onOpenQuote={onOpenQuote}
          onEditPost={onEditPost}
          onDeletePost={onDeletePost}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          actorHandle={actorHandle}
          profiles={profiles}
        />
      ) : commentActivity ? (
        <ProfileCommentCard
          activity={commentActivity}
          profiles={profiles}
          onSelect={onSelect}
          onOpenProfile={onOpenProfile}
          onCommentAction={onCommentAction}
          onQuote={onQuote}
          onOpenQuote={onOpenQuote}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onOpenAttachmentPreview={onOpenCommentAttachmentPreview}
          onOpenCommunity={() => undefined}
          actorHandle={actorHandle}
        />
      ) : (
        <button type="button" className="saved-library-unavailable" onClick={() => onSelect(resolved.entry.postId, resolved.entry.subjectType === "comment" ? resolved.entry.subjectId : null)}>
          <strong>{resolved.title}</strong><span>{resolved.preview}</span>
        </button>
      )}

      <div className="saved-library-item-controls" aria-label="Saved item organization">
        <span title={localDateTimeLabel(resolved.entry.savedAt)}>Saved {relativeTimeLabel(resolved.entry.savedAt, "recently")}</span>
        {!resolved.entry.archivedAt ? (
          <label>
            <Folder size={14} />
            <span className="sr-only">Folder</span>
            <select value={resolved.entry.folderId ?? ""} onChange={(event) => onFolder(event.target.value || null)} disabled={busy}>
              <option value="">Unfiled</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
        ) : (
          <span className="saved-library-expiry"><Archive size={14} /> {expiresIn} {expiresIn === 1 ? "day" : "days"} left</span>
        )}
        <button type="button" onClick={() => onArchive(!resolved.entry.archivedAt)} disabled={busy}>
          {resolved.entry.archivedAt ? <><Undo2 size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
        </button>
      </div>
    </div>
  );
}
