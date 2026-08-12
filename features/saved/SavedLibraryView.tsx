"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Heart,
  MessageCircle,
  Pencil,
  RefreshCw,
  Repeat2,
  Search,
  Trash2,
  Undo2
} from "lucide-react";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { RoomRender } from "@/features/shell/SymposiumShellViews";
import type { InquiryComment, InquiryItem, ResearchProfile, Room } from "@/lib/mockData";
import {
  findCommentInTree,
  localDateTimeLabel,
  relativeTimeLabel
} from "@/lib/symposiumCore";
import type {
  SavedLibraryEntryContract,
  SavedLibraryFolderContract,
  SavedLibraryResponseContract
} from "@/packages/contracts/src";

type SavedSection = "all" | "folders" | "archived";
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

export function SavedLibraryView({
  room,
  actorHandle,
  profiles,
  onOpenNotes,
  onSelect,
  onOpenProfile
}: {
  room: Room;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenNotes: () => void;
  onSelect: (postId: string, commentId?: string | null) => void;
  onOpenProfile: (handle: string) => void;
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
  const resolvedEntries = useMemo(() => library.entries.map((entry) => resolveSavedLibraryEntry(entry, itemById.get(entry.postId))), [itemById, library.entries]);
  const selectedFolder = library.folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return resolvedEntries
      .filter((resolved) => section === "archived" ? Boolean(resolved.entry.archivedAt) : !resolved.entry.archivedAt)
      .filter((resolved) => section !== "folders" || !selectedFolderId || resolved.entry.folderId === selectedFolderId)
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
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
    }, "Folder removed; its saved items remain in All Saved");
  };

  const showFolderDirectory = section === "folders" && !selectedFolderId && !query.trim();

  return (
    <div className="room-layout workspace-room-layout saved-library-room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} />

      <aside className="feed-toolbar workspace-toolbar saved-library-toolbar" aria-label="Saved for later controls">
        <div className="room-mini-title">
          <p className="eyebrow">Private Office library</p>
          <h1>Saved for later</h1>
          <p>Posts and comments you marked for return.</p>
        </div>

        <nav className="workspace-tabs saved-library-tabs" aria-label="Saved library sections">
          <button type="button" className={section === "all" ? "active" : ""} onClick={() => { setSection("all"); setSelectedFolderId(null); }}>
            <Bookmark size={16} /><span>All Saved</span><small>{activeCount}</small>
          </button>
          <button type="button" className={section === "folders" ? "active" : ""} onClick={() => { setSection("folders"); setSelectedFolderId(null); }}>
            <FolderOpen size={16} /><span>Folders</span><small>{library.folders.length}</small>
          </button>
          <button type="button" className={section === "archived" ? "active" : ""} onClick={() => { setSection("archived"); setSelectedFolderId(null); }}>
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
          <p aria-live="polite">{status || (section === "archived" ? "Archived saves expire after 60 days." : "Organize without changing the original work.")}</p>
        </div>
      </aside>

      <main className="workspace-main-column saved-library-main">
        <header className="saved-library-heading">
          <div>
            {selectedFolder ? (
              <button type="button" className="saved-library-back" onClick={() => setSelectedFolderId(null)}><ArrowLeft size={15} /> All folders</button>
            ) : null}
            <p className="eyebrow">{section === "archived" ? "60-day holding shelf" : section === "folders" ? "Your private filing system" : "Complete saved collection"}</p>
            <h2>{selectedFolder?.name ?? (section === "archived" ? "Archived" : section === "folders" ? "Folders" : "All Saved")}</h2>
            <p>{section === "archived" ? "Restore anything you still want. Expiry removes only your save, never the original post or comment." : section === "folders" && !selectedFolder ? "File saved posts and comments into simple private collections." : `${visibleEntries.length} saved ${visibleEntries.length === 1 ? "item" : "items"}`}</p>
          </div>
        </header>

        {section === "folders" && !selectedFolderId ? (
          <form className="saved-library-folder-create" onSubmit={createFolder}>
            <FolderPlus size={18} />
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={80} placeholder="Create a folder" />
            <button type="submit" disabled={!newFolderName.trim() || busyKey === "folder:new"}>Create</button>
          </form>
        ) : null}

        {loading && !library.entries.length ? (
          <div className="empty-feed saved-library-empty"><strong>Loading every saved post and comment…</strong><span>The Office is reconciling the same canonical saves shown on your profile.</span></div>
        ) : showFolderDirectory ? (
          library.folders.length ? (
            <section className="saved-library-folder-grid" aria-label="Saved folders">
              {library.folders.map((folder) => (
                <article key={folder.id} className="saved-library-folder-card" data-testid={`saved-folder-${folder.id}`}>
                  <button type="button" className="saved-library-folder-open" onClick={() => setSelectedFolderId(folder.id)}>
                    <Folder size={28} />
                    <span><strong>{folder.name}</strong><small>{folder.itemCount} {folder.itemCount === 1 ? "item" : "items"}</small></span>
                  </button>
                  {editingFolderId === folder.id ? (
                    <form onSubmit={(event) => { event.preventDefault(); renameFolder(folder); }}>
                      <input value={editingFolderName} onChange={(event) => setEditingFolderName(event.target.value)} maxLength={80} autoFocus />
                      <button type="submit" disabled={!editingFolderName.trim() || busyKey === `folder:${folder.id}`}>Save</button>
                    </form>
                  ) : (
                    <div className="saved-library-folder-actions">
                      <button type="button" onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setConfirmDeleteFolderId(null); }}><Pencil size={14} /> Rename</button>
                      {confirmDeleteFolderId === folder.id ? (
                        <button type="button" className="danger" onClick={() => deleteFolder(folder)} disabled={busyKey === `folder:${folder.id}`}><Trash2 size={14} /> Confirm</button>
                      ) : (
                        <button type="button" onClick={() => { setConfirmDeleteFolderId(folder.id); setEditingFolderId(null); }}><Trash2 size={14} /> Delete</button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : (
            <div className="empty-feed saved-library-empty"><strong>No folders yet.</strong><span>Create one above, then file any saved post or comment into it.</span></div>
          )
        ) : visibleEntries.length ? (
          <section className="saved-library-list" aria-label="Saved items">
            {visibleEntries.map((resolved) => (
              <SavedLibraryCard
                key={entryKey(resolved.entry)}
                resolved={resolved}
                folders={library.folders}
                profiles={mergedProfiles}
                busy={busyKey === entryKey(resolved.entry)}
                onOpen={() => onSelect(resolved.entry.postId, resolved.entry.subjectType === "comment" ? resolved.entry.subjectId : null)}
                onOpenProfile={onOpenProfile}
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

const entryKey = (entry: SavedLibraryEntryContract) => `${entry.subjectType}:${entry.subjectId}`;

function SavedLibraryCard({
  resolved,
  folders,
  profiles,
  busy,
  onOpen,
  onOpenProfile,
  onFolder,
  onArchive
}: {
  resolved: ResolvedSavedEntry;
  folders: SavedLibraryFolderContract[];
  profiles: Record<string, ResearchProfile>;
  busy: boolean;
  onOpen: () => void;
  onOpenProfile: (handle: string) => void;
  onFolder: (folderId: string | null) => void;
  onArchive: (archived: boolean) => void;
}) {
  const person = profileForHandle(profiles, resolved.authorHandle || resolved.authorName);
  const displayName = person?.name ?? resolved.authorName;
  const expiresIn = resolved.entry.archiveExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(resolved.entry.archiveExpiresAt) - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;
  return (
    <article className={`saved-library-card ${resolved.entry.subjectType}`} data-testid={`saved-entry-${resolved.entry.subjectType}-${resolved.entry.subjectId}`}>
      <button type="button" className="saved-library-card-body" onClick={onOpen} disabled={!resolved.item}>
        <span className="saved-library-kind"><FileText size={14} /> {resolved.entry.subjectType === "comment" ? "Comment" : resolved.item?.postType ?? resolved.item?.kind ?? "Post"}</span>
        <h3>{resolved.title}</h3>
        <p>{resolved.preview}</p>
      </button>
      <footer>
        <div className="saved-library-author-line">
          <button type="button" onClick={() => onOpenProfile(person?.handle ?? resolved.authorHandle)} disabled={!person && !resolved.authorHandle}>
            <span className="avatar small">{person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : profileInitials(displayName)}</span>
            <span><strong>{displayName}</strong><small>Saved {relativeTimeLabel(resolved.entry.savedAt, "recently")}</small></span>
          </button>
          <span title={localDateTimeLabel(resolved.createdAt)}><CalendarDays size={14} /> Created {relativeTimeLabel(resolved.createdAt, "earlier")}</span>
        </div>
        <div className="saved-library-metrics" aria-label="Saved content metrics">
          <span title="Likes"><Heart size={14} /> {resolved.likes}</span>
          <span title="Saves"><Bookmark size={14} /> {resolved.saves}</span>
          <span title="Comments or replies"><MessageCircle size={14} /> {resolved.comments}</span>
          <span title="Views"><Eye size={14} /> {resolved.views}</span>
          <span title="Reshares"><Repeat2 size={14} /> {resolved.reshares}</span>
        </div>
        <div className="saved-library-card-controls">
          {!resolved.entry.archivedAt ? (
            <label>
              <Folder size={15} />
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
            {resolved.entry.archivedAt ? <><Undo2 size={15} /> Restore</> : <><Archive size={15} /> Archive</>}
          </button>
        </div>
      </footer>
    </article>
  );
}
