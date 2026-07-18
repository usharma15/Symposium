"use client";

import {
  feedScopes,
  type FeedScope,
  type InquiryItem,
  type ResearchProfile,
  type Room
} from "@/lib/mockData";
import type { PostActionHandler } from "@/features/actions/actionTypes";
import type { QuoteActionHandler } from "@/features/quotes/QuoteViews";
import type { AttachmentPreviewHandler } from "@/features/attachments/AttachmentViews";
import { FeedPost } from "@/features/posts/PostViews";
import { RoomRender } from "@/features/shell/SymposiumShellViews";

type OfficeMode = "desk" | "saved" | "notes";
export function RoomView({
  room,
  items,
  officeMode,
  feedScope,
  onFeedScope,
  onSelect,
  onOpenProfile,
  onAction,
  onQuote,
  onOpenQuote,
  onEditPost,
  onDeletePost,
  onOpenNotes,
  onOpenSaved,
  actorHandle,
  profiles,
  onOpenAttachmentPreview,
  hasMore,
  loadingMore,
  onLoadMore
}: {
  room: Room;
  items: InquiryItem[];
  officeMode?: OfficeMode;
  feedScope: FeedScope;
  onFeedScope: (scope: FeedScope) => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenNotes: () => void;
  onOpenSaved: () => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const roomTitle = officeMode === "saved"
          ? "Saved for later"
          : officeMode === "notes"
            ? "Notes"
            : room.name;
  const roomDescription = officeMode === "saved"
          ? "Work you marked for return."
          : officeMode === "notes"
            ? "Your desk notes and authored fragments."
            : room.description;

  return (
    <div className="room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

      <section className="feed-toolbar" aria-label="Feed controls">
        <div className="room-mini-title">
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{roomTitle}</h1>
          <p>{roomDescription}</p>
        </div>

        <div className="segmented">
          {feedScopes.map((scope) => (
            <button
              key={scope.id}
              type="button"
              className={feedScope === scope.id ? "active" : ""}
              onClick={() => onFeedScope(scope.id)}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {room.id === "office" ? (
          <div className="office-feed-note">
            {officeMode === "saved" ? "Saved items are sorted by your latest action." : "Notes are local for now."}
          </div>
        ) : null}
      </section>

      <section className="feed-stream" aria-label={`${room.name} feed`}>
        {items.length ? (
          items.map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onQuote={onQuote}
              onOpenQuote={onOpenQuote}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              actorHandle={actorHandle}
              profiles={profiles}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No work in this slice yet.</strong>
            <span>Try another room, topic, or search.</span>
          </div>
        )}
        {hasMore && onLoadMore ? (
          <button
            className="feed-load-more"
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading…" : "Show more"}
          </button>
        ) : null}
      </section>
    </div>
  );
}
