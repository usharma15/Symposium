"use client";

import { ArrowLeft } from "lucide-react";
import {
  feedScopes,
  roomChips,
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
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

type OfficeMode = "desk" | "saved" | "notes";
type PatronageMode = "lobby" | "civic" | "private";

export function RoomView({
  room,
  items,
  officeMode,
  patronageMode,
  feedScope,
  roomChip,
  onFeedScope,
  onRoomChip,
  onPatronageMode,
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
  onOpenAttachmentPreview
}: {
  room: Room;
  items: InquiryItem[];
  officeMode?: OfficeMode;
  patronageMode?: PatronageMode;
  feedScope: FeedScope;
  roomChip: string;
  onFeedScope: (scope: FeedScope) => void;
  onRoomChip: (chip: string) => void;
  onPatronageMode: (mode: PatronageMode) => void;
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
}) {
  const roomTitle =
    room.id === "funding" && patronageMode === "civic"
      ? "Civic Patronage"
      : room.id === "funding" && patronageMode === "private"
        ? "Private Patronage"
        : officeMode === "saved"
          ? "Saved for later"
          : officeMode === "notes"
            ? "Notes"
            : room.name;
  const roomDescription =
    room.id === "funding" && patronageMode === "civic"
      ? "Crowdfunding, bounties, donations, microgrants, and public backing for work that deserves early oxygen."
      : room.id === "funding" && patronageMode === "private"
        ? "Investors, grants, family offices, funds, and larger patronage routes for serious research and institutions."
        : officeMode === "saved"
          ? "Work you marked for return."
          : officeMode === "notes"
            ? "Your desk notes and authored fragments."
            : room.description;

  return (
    <div className="room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

      <section className="feed-toolbar" aria-label="Feed controls">
        {room.id === "funding" && patronageMode !== "lobby" ? (
          <CanonicalLink
            className="community-back patronage-back"
            route={{ kind: "funding" }}
            onNavigate={() => onPatronageMode("lobby")}
          >
            <ArrowLeft size={16} />
            Patronage
          </CanonicalLink>
        ) : null}

        <div className="room-mini-title">
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{roomTitle}</h1>
          <p>{roomDescription}</p>
        </div>

        {room.id === "funding" ? (
          <div className="segmented patronage-switch" aria-label="Patronage section">
            <CanonicalLink
              route={{ kind: "funding", view: "civic" }}
              onNavigate={() => onPatronageMode("civic")}
              className={patronageMode === "civic" ? "active" : ""}
            >
              Civic
            </CanonicalLink>
            <CanonicalLink
              route={{ kind: "funding", view: "private" }}
              onNavigate={() => onPatronageMode("private")}
              className={patronageMode === "private" ? "active" : ""}
            >
              Private
            </CanonicalLink>
          </div>
        ) : null}

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

        {feedScope === "rooms" ? (
          <label className="topic-select">
            <span>Topic</span>
            <select value={roomChip} onChange={(event) => onRoomChip(event.target.value)}>
              {roomChips.map((chip) => (
                <option key={chip} value={chip}>
                  {chip}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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
      </section>
    </div>
  );
}
