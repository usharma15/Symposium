"use client";

import {
  ArrowDown,
  ArchiveX,
  BellOff,
  BellRing,
  Ban,
  Check,
  ExternalLink,
  File,
  Image as ImageIcon,
  Info,
  Link2,
  LoaderCircle,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from "react";
import type {
  ConversationParticipantContract,
  ConversationPageContract,
  ConversationSummaryContract,
  InquiryAttachmentContract,
  MessageContract,
  MessagePageContract
} from "@/packages/contracts/src";
import type { ResearchProfile } from "@/lib/mockData";
import {
  compactAttachmentFileName,
  formatAttachmentBytes,
  inferAttachmentContentType
} from "@/lib/attachmentRules";
import { cleanHandle } from "@/lib/symposiumCore";
import { profileInitials } from "@/features/identity/profilePresentation";
import {
  createClientMutationId,
  SymposiumApiError,
  symposiumApi
} from "@/features/api/symposiumApiClient";
import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import {
  attachmentIcon,
  buildPostAttachmentMetadata
} from "@/features/attachments/AttachmentViews";
import {
  createMessageDraftClientVersion,
  emptyMessageDraftState,
  parseStoredMessageDraft,
  reduceMessageDraft,
  storedMessageDraftFromState,
  type MessageDraftAction,
  type MessageDraftState,
  type StoredMessageDraft
} from "@/features/messages/messageDraftState";
import {
  attachmentMatchesMessageMediaKind,
  messageBodyLinks,
  messageMediaResultCount,
  rankMessagePeople,
  type MessageMediaKind
} from "@/features/messages/messageDiscoveryState";
import {
  activeConversationParticipants,
  conversationIdentityParticipant,
  currentConversationParticipant,
  messageSenderProfile,
  withoutConversationParticipant
} from "@/features/messages/messageParticipantState";
import {
  messageReadAcknowledgesSummary,
  messageReadFollowUpNeeded,
  messageReadViewportActive
} from "@/features/messages/messageReadState";
import {
  canonicalMessageFromLiveEvent,
  liveEventConversationId,
  mergeCanonicalMessage,
  messagingEventRequiresRefresh,
  type MessagingLiveEvent
} from "@/features/messages/messageLiveState";
import {
  mergeCanonicalMessagePage,
  mergeConversationPageAfterProjectionChange,
  reconcileDiscoveryMessage,
  upsertConversationProjection
} from "@/features/messages/messageProjectionState";
import { enqueueConversationSend } from "@/features/messages/messageSendQueue";

const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyMessagingLiveEvents: MessagingLiveEvent[] = [];
const mediaKinds: Array<{ id: MessageMediaKind; label: string; icon: ReactNode }> = [
  { id: "image", label: "Images", icon: <ImageIcon size={14} /> },
  { id: "video", label: "Videos", icon: <ImageIcon size={14} /> },
  { id: "document", label: "Docs", icon: <File size={14} /> },
  { id: "spreadsheet", label: "Sheets", icon: <File size={14} /> },
  { id: "presentation", label: "Slides", icon: <File size={14} /> },
  { id: "links", label: "Links", icon: <Link2 size={14} /> },
  { id: "code", label: "Code", icon: <File size={14} /> },
  { id: "starred", label: "Starred", icon: <Star size={14} /> }
];

const withActor = (path: string, actorHandle: string) => {
  const url = new URL(path, "https://symposium.invalid");
  url.searchParams.set("actorHandle", actorHandle);
  return `${url.pathname}?${url.searchParams.toString()}`;
};

const displayTime = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const displayLinkHost = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};

const conversationPeer = (conversation: ConversationSummaryContract | null, actorHandle: string) =>
  conversation?.participants.find((participant) => cleanHandle(participant.handle) !== cleanHandle(actorHandle)) ?? null;

const conversationName = (conversation: ConversationSummaryContract, actorHandle: string) =>
  conversation.kind === "group"
    ? conversation.title ?? "Private group"
    : conversationPeer(conversation, actorHandle)?.name ?? "Direct message";

const messageAttachmentUrl = (attachment: InquiryAttachmentContract, actorHandle: string) =>
  attachment.url ?? `/api/message-attachments/${encodeURIComponent(attachment.id)}?actorHandle=${encodeURIComponent(actorHandle)}`;

const localDraftKey = (actorHandle: string, conversationId: string) =>
  `symposium:message-draft:${cleanHandle(actorHandle)}:${conversationId}`;

const readLocalDraft = (actorHandle: string, conversationId: string) => {
  try {
    return parseStoredMessageDraft(window.localStorage.getItem(localDraftKey(actorHandle, conversationId)));
  } catch {
    return null;
  }
};

const removeLocalDraft = (actorHandle: string, conversationId: string) => {
  try {
    window.localStorage.removeItem(localDraftKey(actorHandle, conversationId));
  } catch {
    // In-memory draft state remains usable when browser storage is unavailable.
  }
};

const errorText = (error: unknown) => error instanceof Error ? error.message : "Messaging could not sync.";
const retryableMessagingFailure = (error: unknown) =>
  !(error instanceof SymposiumApiError) ||
  error.status === null ||
  error.status === 408 ||
  error.status === 425 ||
  error.status === 429 ||
  (error.status !== null && error.status >= 500);
const messagingLiveEventKey = (event: MessagingLiveEvent) =>
  event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}:${event.createdAt ?? "unknown"}`;

type PendingMessageAttachment = {
  attachment: InquiryAttachmentContract;
  previewUrl: string;
};

type FailedSendDraft = {
  sequence: number;
  body: string;
  baseRevision: number;
  updatedAt: string;
};

type MessageDraftSyncState = "idle" | "saving" | "saved" | "local";
type MessageDraftStorageState = "available" | "memory-only";

type ConversationDraftSnapshot = {
  body: string;
  revision: number;
  clientVersion: string | null;
  updatedAt: string | null;
};

const persistFailedMessageDraft = ({
  actorHandle,
  conversationId,
  failures,
  latestDraft
}: {
  actorHandle: string;
  conversationId: string;
  failures: FailedSendDraft[];
  latestDraft?: ConversationDraftSnapshot;
}) => {
  const orderedFailures = [...failures].sort((left, right) => left.sequence - right.sequence);
  const failedBody = orderedFailures.map((failure) => failure.body).filter(Boolean).join("\n");
  if (!failedBody) return true;
  const existing = readLocalDraft(actorHandle, conversationId);
  const restored: StoredMessageDraft = {
    version: 1,
    body: [failedBody, existing?.body ?? ""].filter(Boolean).join("\n"),
    clientVersion: createMessageDraftClientVersion(),
    baseRevision: latestDraft?.revision ?? existing?.baseRevision ?? Math.max(1, ...orderedFailures.map((failure) => failure.baseRevision)),
    updatedAt: new Date().toISOString(),
    recovery: existing?.recovery ?? null
  };
  try {
    window.localStorage.setItem(localDraftKey(actorHandle, conversationId), JSON.stringify(restored));
    return true;
  } catch {
    return false;
  }
};

const conversationDraftFromConflict = (error: unknown): ConversationDraftSnapshot | null => {
  if (!(error instanceof SymposiumApiError) || error.status !== 409 || !error.payload || typeof error.payload !== "object") return null;
  const draft = (error.payload as { draft?: unknown }).draft;
  if (!draft || typeof draft !== "object") return null;
  const value = draft as Partial<ConversationDraftSnapshot>;
  if (
    typeof value.body !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    (value.clientVersion !== null && typeof value.clientVersion !== "string") ||
    (value.updatedAt !== null && typeof value.updatedAt !== "string")
  ) return null;
  return value as ConversationDraftSnapshot;
};

const revokePendingAttachment = (entry: PendingMessageAttachment) => {
  if (entry.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
};

const discardPendingAttachment = (entry: PendingMessageAttachment, actorHandle: string) => {
  revokePendingAttachment(entry);
  return symposiumApi.request(`/api/attachments/${encodeURIComponent(entry.attachment.id)}?actorHandle=${encodeURIComponent(actorHandle)}`, {
    method: "DELETE",
    body: { actorHandle }
  }).catch(() => undefined);
};

const pendingPreviewAttachments = (entries: PendingMessageAttachment[]) =>
  entries.map((entry) => ({ ...entry.attachment, url: entry.previewUrl }));

const messagePreviewAttachments = (attachments: InquiryAttachmentContract[], actorHandle: string) =>
  attachments.map((attachment) => ({
    ...attachment,
    url: messageAttachmentUrl(attachment, actorHandle)
  }));

type MessageAttachmentPreview = {
  attachmentId: string;
  attachments: InquiryAttachmentContract[];
  contextTitle: string;
};

function CompactAttachmentFileName({ fileName, maxStemCharacters = 18 }: { fileName: string; maxStemCharacters?: number }) {
  const compact = compactAttachmentFileName(fileName, maxStemCharacters);
  const extension = compact.match(/\.[^.\s]{1,16}$/)?.[0] ?? "";
  const stem = extension ? compact.slice(0, -extension.length) : compact;
  return (
    <span className="compact-attachment-file-name" title={fileName}>
      <span className="compact-attachment-file-stem">{stem}</span>
      {extension ? <span className="compact-attachment-file-extension">{extension}</span> : null}
    </span>
  );
}

function Avatar({
  person,
  name,
  size = "small",
  group = false
}: {
  person?: { avatarUrl?: string; name: string };
  name: string;
  size?: "small" | "large";
  group?: boolean;
}) {
  return (
    <span className={`avatar ${size} messaging-avatar${group ? " group" : ""}`} aria-hidden="true">
      {group ? <Users size={size === "large" ? 25 : 16} strokeWidth={1.8} /> : person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : profileInitials(name)}
    </span>
  );
}

function AttachmentTile({
  attachment,
  actorHandle,
  onPreview
}: {
  attachment: InquiryAttachmentContract;
  actorHandle: string;
  onPreview: () => void;
}) {
  const url = messageAttachmentUrl(attachment, actorHandle);
  if (attachment.kind === "image") {
    return (
      <button className="message-attachment message-attachment-image" type="button" title={`Preview ${attachment.fileName}`} onClick={onPreview}>
        <img src={url} alt="" loading="lazy" />
        <CompactAttachmentFileName fileName={attachment.fileName} maxStemCharacters={24} />
      </button>
    );
  }
  if (attachment.kind === "video") {
    return (
      <div className="message-attachment message-attachment-video">
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Play ${attachment.fileName}`}
          onDoubleClick={(event) => {
            event.preventDefault();
            onPreview();
          }}
        />
        <button type="button" title={`Preview ${attachment.fileName}`} onClick={onPreview}>
          <CompactAttachmentFileName fileName={attachment.fileName} maxStemCharacters={24} />
          <small>{formatAttachmentBytes(attachment.byteSize)} · Open preview</small>
        </button>
      </div>
    );
  }
  return (
    <button className="message-attachment" type="button" title={`Preview ${attachment.fileName}`} onClick={onPreview}>
      {attachmentIcon(attachment)}
      <CompactAttachmentFileName fileName={attachment.fileName} maxStemCharacters={24} />
      <small>{formatAttachmentBytes(attachment.byteSize)}</small>
    </button>
  );
}

function SharedMessageResults({
  actorHandle,
  kind,
  messages,
  onPreviewAttachment,
  onJumpToMessage
}: {
  actorHandle: string;
  kind: MessageMediaKind;
  messages: MessageContract[];
  onPreviewAttachment: (message: MessageContract, attachmentId: string) => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  if (kind === "links") {
    return messages.flatMap((message) => messageBodyLinks(message.body).map((url) => (
      <a className="message-shared-link" href={url} target="_blank" rel="noreferrer" key={`${message.id}:${url}`}>
        <Link2 size={14} />
        <span><strong>{displayLinkHost(url)}</strong><small>{url}</small></span>
        <ExternalLink size={12} />
      </a>
    )));
  }
  if (kind === "starred") {
    return messages.map((message) => (
      <div className="message-shared-starred" key={message.id}>
        <button type="button" onClick={() => onJumpToMessage(message.id)}>
          <Star size={13} fill="currentColor" />
          <span>{message.body || (message.attachments.length ? "Shared attachments" : "Starred message")}</span>
          <small>{displayTime(message.createdAt)}</small>
        </button>
        {message.attachments.length ? (
          <div className="message-shared-starred-attachments">
            {message.attachments.map((attachment) => (
              <AttachmentTile
                key={`${message.id}:${attachment.id}`}
                attachment={attachment}
                actorHandle={actorHandle}
                onPreview={() => onPreviewAttachment(message, attachment.id)}
              />
            ))}
          </div>
        ) : null}
      </div>
    ));
  }
  return messages.flatMap((message) => message.attachments
    .filter((attachment) => attachmentMatchesMessageMediaKind(attachment, kind))
    .map((attachment) => (
      <AttachmentTile
        key={`${message.id}:${attachment.id}`}
        attachment={attachment}
        actorHandle={actorHandle}
        onPreview={() => onPreviewAttachment(message, attachment.id)}
      />
    )));
}

function MessageBubble({
  actorHandle,
  message,
  sender,
  showSenderIdentity,
  onEdit,
  onDelete,
  onStar,
  onPreviewAttachment
}: {
  actorHandle: string;
  message: MessageContract;
  sender?: ConversationParticipantContract | ResearchProfile;
  showSenderIdentity: boolean;
  onEdit: (message: MessageContract, body: string) => Promise<boolean>;
  onDelete: (message: MessageContract, mode: "self" | "everyone") => void;
  onStar: (message: MessageContract) => void;
  onPreviewAttachment: (message: MessageContract, attachmentId: string) => void;
}) {
  const own = message.senderHandle ? cleanHandle(message.senderHandle) === cleanHandle(actorHandle) : false;
  const withinMutationWindow = Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setEditBody(message.body);
  }, [editing, message.body]);

  useEffect(() => {
    setActionsOpen(false);
  }, [message.deletedAt, message.revision]);

  useEffect(() => {
    const textarea = editTextareaRef.current;
    if (!editing || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 288)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 288 ? "auto" : "hidden";
  }, [editBody, editing]);

  const cancelEdit = () => {
    if (savingEdit) return;
    setEditBody(message.body);
    setEditing(false);
  };

  const saveEdit = async () => {
    const body = editBody.trim();
    if (!body || savingEdit) return;
    if (body === message.body) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    const saved = await onEdit(message, body);
    setSavingEdit(false);
    if (saved) setEditing(false);
  };

  return (
    <article className={`message-bubble-row ${own ? "own" : "received"}`} data-message-id={message.id}>
      {!own ? <Avatar person={sender} name={sender?.name ?? message.senderHandle ?? "System"} /> : null}
      <div className={`message-bubble ${message.deletedAt ? "deleted" : ""}`}>
        {message.deletedAt ? (
          <p>This message was unsent.</p>
        ) : (
          <>
            {showSenderIdentity && !own ? (
              <strong className="message-sender-name">{sender?.name ?? message.senderHandle ?? "Unknown sender"}</strong>
            ) : null}
            {editing ? (
              <form className="message-inline-edit" onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
                <textarea
                  ref={editTextareaRef}
                  rows={1}
                  maxLength={8000}
                  value={editBody}
                  autoFocus
                  aria-label="Edit message"
                  disabled={savingEdit}
                  onChange={(event) => setEditBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEdit();
                    } else if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void saveEdit();
                    }
                  }}
                />
                <div>
                  <button type="button" disabled={savingEdit} onClick={cancelEdit}><X size={13} />Cancel</button>
                  <button type="submit" disabled={savingEdit || !editBody.trim()}>
                    {savingEdit ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}Save
                  </button>
                </div>
                <small>Enter to save · Shift + Enter for a new line</small>
              </form>
            ) : message.body ? <p>{message.body}</p> : null}
            {message.attachments.length ? (
              <div className="message-attachments">
                {message.attachments.map((attachment) => (
                  <AttachmentTile
                    key={attachment.id}
                    attachment={attachment}
                    actorHandle={actorHandle}
                    onPreview={() => onPreviewAttachment(message, attachment.id)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
        <footer>
          {!message.deletedAt && !editing ? (
            <button
              className="message-actions-toggle"
              type="button"
              title="Message options"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((open) => !open)}
            ><MoreHorizontal size={13} /></button>
          ) : null}
          <time dateTime={message.createdAt}>{displayTime(message.createdAt)}</time>
          {message.editedAt && !message.deletedAt ? <span>Edited</span> : null}
          {message.starred ? <Star size={11} fill="currentColor" /> : null}
        </footer>
        {!message.deletedAt && !editing ? (
          <div className={`message-bubble-actions ${actionsOpen ? "open" : ""}`} aria-label="Message actions">
            <button type="button" title={message.starred ? "Unstar" : "Star"} onClick={() => { setActionsOpen(false); onStar(message); }}>
              <Star size={13} fill={message.starred ? "currentColor" : "none"} />
            </button>
            {own && withinMutationWindow && message.body ? (
              <button type="button" title="Edit message" onClick={() => { setActionsOpen(false); setEditBody(message.body); setEditing(true); }}><Pencil size={13} /></button>
            ) : null}
            <button type="button" title="Delete for me" onClick={() => { setActionsOpen(false); onDelete(message, "self"); }}><ArchiveX size={13} /></button>
            {own && withinMutationWindow ? (
              <button type="button" title="Unsend for everyone" onClick={() => { setActionsOpen(false); onDelete(message, "everyone"); }}><Trash2 size={13} /></button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ConversationListItem({
  active,
  actorHandle,
  conversation,
  profiles,
  onSelect
}: {
  active: boolean;
  actorHandle: string;
  conversation: ConversationSummaryContract;
  profiles: Record<string, ResearchProfile>;
  onSelect: () => void;
}) {
  const currentPeer = conversationIdentityParticipant(conversation, actorHandle, profiles);
  const title = conversation.kind === "direct" ? currentPeer?.name ?? conversationName(conversation, actorHandle) : conversationName(conversation, actorHandle);
  const preview = conversation.draftBody
    ? `Draft: ${conversation.draftBody}`
    : conversation.lastMessage?.deletedAt
      ? "Message unsent"
      : conversation.lastMessage?.body || (conversation.lastMessage?.attachments.length ? "Shared an attachment" : "No messages yet");
  return (
    <button className={`conversation-list-item ${active ? "active" : ""}`} type="button" onClick={onSelect}>
      <Avatar person={currentPeer} name={title} group={conversation.kind === "group"} />
      <span className="conversation-list-copy">
        <span>
          <strong>{title}</strong>
          {conversation.pinned ? <Pin size={11} /> : null}
          {conversation.muted ? <BellOff size={11} /> : null}
          {conversation.lastMessage ? <time>{displayTime(conversation.lastMessage.createdAt)}</time> : null}
        </span>
        <small className={conversation.draftBody ? "draft" : ""}>{preview}</small>
      </span>
      {conversation.unreadCount ? <b className="message-unread-count">{Math.min(conversation.unreadCount, 99)}</b> : null}
    </button>
  );
}

function NewConversationPanel({
  actorHandle,
  profiles,
  onClose,
  onDirect,
  onGroup
}: {
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onClose: () => void;
  onDirect: (handle: string) => void;
  onGroup: (title: string, handles: string[]) => Promise<void>;
}) {
  const [groupMode, setGroupMode] = useState(false);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [results, setResults] = useState<ResearchProfile[]>([]);
  const [selected, setSelected] = useState<ResearchProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      setSearchError("");
      return;
    }
    let cancelled = false;
    setResults([]);
    setLoading(true);
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ q: term, limit: "40" });
      void symposiumApi.request<{ profiles: Record<string, ResearchProfile> }>(`/api/profiles?${parameters.toString()}`, { cache: "no-store" })
        .then((data) => {
          if (cancelled) return;
          setResults(rankMessagePeople(Object.values(data.profiles), term, actorHandle));
          setSearchError("");
        })
        .catch(() => {
          if (cancelled) return;
          setResults(rankMessagePeople(Object.values(profiles), term, actorHandle));
          setSearchError("Live search is temporarily unavailable. Showing loaded people.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actorHandle, profiles, query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const selectedHandles = new Set(selected.map((person) => cleanHandle(person.handle)));
  const currentResults = results.map((person) => profiles[cleanHandle(person.handle)] ?? person);
  const currentSelected = selected.map((person) => profiles[cleanHandle(person.handle)] ?? person);
  const unselectedResults = groupMode
    ? currentResults.filter((person) => !selectedHandles.has(cleanHandle(person.handle)))
    : currentResults;
  const toggleSelected = (person: ResearchProfile) => {
    const handle = cleanHandle(person.handle);
    setSelected((current) => current.some((entry) => cleanHandle(entry.handle) === handle)
      ? current.filter((entry) => cleanHandle(entry.handle) !== handle)
      : current.length < 49 ? [...current, person] : current);
  };

  return (
    <section className="new-conversation-panel" role="dialog" aria-modal="false" aria-label={groupMode ? "Create group" : "Start a chat"}>
      <header>
        <button type="button" className={!groupMode ? "active" : ""} onClick={() => { setGroupMode(false); setQuery(""); }}>New chat</button>
        <button type="button" className={groupMode ? "active" : ""} onClick={() => { setGroupMode(true); setQuery(""); }}>New group</button>
        <button type="button" title="Close" onClick={onClose}><X size={15} /></button>
      </header>
      {groupMode ? (
        <input value={title} maxLength={120} placeholder="Group name" onChange={(event) => setTitle(event.target.value)} />
      ) : null}
      <label className="message-person-search">
        <Search size={14} />
        <input value={query} autoFocus placeholder="Search by name or username" onChange={(event) => setQuery(event.target.value)} />
        {loading ? <LoaderCircle className="spin" size={14} /> : null}
      </label>
      <div className={`new-conversation-people${query.trim() ? " has-query" : " selection-only"}`} aria-busy={loading}>
        {query.trim() ? (
          <div className="new-conversation-results">
            {unselectedResults.map((person) => (
            <button
              key={person.handle}
              type="button"
              onClick={() => groupMode ? toggleSelected(person) : onDirect(person.handle)}
            >
              <Avatar person={person} name={person.name} />
              <span><strong>{person.name}</strong><small>{person.handle}</small></span>
              {groupMode ? <Plus size={15} /> : null}
            </button>
            ))}
            {!loading && !unselectedResults.length ? <p>{groupMode && selected.length ? "No more people found." : "No people found."}</p> : null}
          </div>
        ) : null}
        {groupMode && selected.length ? (
          <section className="new-conversation-selected" aria-label="People added to this group">
            <strong>Added to group <small>{selected.length}/49</small></strong>
            {currentSelected.map((person) => (
              <button className="selected" type="button" key={person.handle} onClick={() => toggleSelected(person)}>
                <Avatar person={person} name={person.name} />
                <span><strong>{person.name}</strong><small>{person.handle}</small></span>
                <Check size={15} />
              </button>
            ))}
          </section>
        ) : null}
        {!query.trim() && !selected.length ? (
          <p className="new-conversation-guidance">{groupMode
            ? "Search for people to add. Your selected members will stay here while you build the group."
            : "Search for someone by name or username to start a chat."}</p>
        ) : null}
      </div>
      {searchError ? <small className="new-conversation-search-error">{searchError}</small> : null}
      {groupMode ? (
        <button
          className="create-message-group"
          type="button"
          disabled={busy || !title.trim() || !selected.length}
          onClick={() => {
            setBusy(true);
            void onGroup(title.trim(), selected.map((person) => person.handle)).finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Users size={15} />}
          Create group{selected.length ? ` with ${selected.length}` : ""}
        </button>
      ) : null}
    </section>
  );
}

function AddPeopleDialog({
  actorHandle,
  profiles,
  participants,
  onClose,
  onAdd
}: {
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  participants: ConversationParticipantContract[];
  onClose: () => void;
  onAdd: (handles: string[]) => Promise<boolean>;
}) {
  const activeHandles = useMemo(
    () => new Set(participants.filter((participant) => participant.status === "active").map((participant) => cleanHandle(participant.handle))),
    [participants]
  );
  const remainingPlaces = Math.max(0, 50 - activeHandles.size);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResearchProfile[]>([]);
  const [selected, setSelected] = useState<ResearchProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [adding, setAdding] = useState(false);

  const eligible = useCallback((person: ResearchProfile) => {
    const handle = cleanHandle(person.handle);
    return handle !== cleanHandle(actorHandle) && !activeHandles.has(handle);
  }, [activeHandles, actorHandle]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(Object.values(profiles).filter(eligible).slice(0, 30));
      setLoading(false);
      setSearchError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const parameters = new URLSearchParams({ q: term, limit: "40", actorHandle });
      void symposiumApi.request<{ profiles: Record<string, ResearchProfile> }>(`/api/profiles?${parameters.toString()}`, { cache: "no-store" })
        .then((data) => {
          if (cancelled) return;
          setResults(rankMessagePeople(Object.values(data.profiles).filter(eligible), term, actorHandle));
          setSearchError("");
        })
        .catch(() => {
          if (cancelled) return;
          setResults(rankMessagePeople(Object.values(profiles).filter(eligible), term, actorHandle, 30));
          setSearchError("Live search is temporarily unavailable. Showing loaded people.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actorHandle, eligible, profiles, query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !adding) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [adding, onClose]);

  const toggle = (person: ResearchProfile) => {
    const handle = cleanHandle(person.handle);
    setSelected((current) => current.some((entry) => cleanHandle(entry.handle) === handle)
      ? current.filter((entry) => cleanHandle(entry.handle) !== handle)
      : current.length < remainingPlaces ? [...current, person] : current);
  };

  const submit = async () => {
    if (!selected.length || adding) return;
    setAdding(true);
    const added = await onAdd(selected.map((person) => person.handle));
    setAdding(false);
    if (added) onClose();
  };
  const currentSelected = selected.map((person) => profiles[cleanHandle(person.handle)] ?? person);
  const currentResults = results.map((person) => profiles[cleanHandle(person.handle)] ?? person);

  return (
    <div className="message-add-people-backdrop" role="presentation" onClick={() => { if (!adding) onClose(); }}>
      <section className="message-add-people-dialog" role="dialog" aria-modal="true" aria-labelledby="message-add-people-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <span><UserPlus size={18} /><strong id="message-add-people-title">Add people</strong></span>
          <button type="button" title="Close" disabled={adding} onClick={onClose}><X size={16} /></button>
        </header>
        <p>New members join immediately and can see the existing group history.</p>
        {remainingPlaces ? (
          <>
            <label className="message-add-people-search">
              <Search size={15} />
              <input value={query} autoFocus placeholder="Search by name or handle" onChange={(event) => setQuery(event.target.value)} />
              {loading ? <LoaderCircle className="spin" size={15} /> : null}
            </label>
            {selected.length ? (
              <div className="message-add-people-selected" aria-label="Selected people">
                {currentSelected.map((person) => (
                  <button type="button" key={person.handle} onClick={() => toggle(person)}>
                    <Avatar person={person} name={person.name} />
                    <span>{person.name}</span>
                    <X size={12} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="message-add-people-results" aria-busy={loading}>
              {currentResults.map((person) => {
                const chosen = selected.some((entry) => cleanHandle(entry.handle) === cleanHandle(person.handle));
                return (
                  <button type="button" className={chosen ? "selected" : ""} key={person.handle} onClick={() => toggle(person)}>
                    <Avatar person={person} name={person.name} />
                    <span><strong>{person.name}</strong><small>{person.handle}</small></span>
                    {chosen ? <Check size={15} /> : <Plus size={15} />}
                  </button>
                );
              })}
              {!loading && !results.length ? <p>No eligible people found.</p> : null}
            </div>
            {searchError ? <small className="message-add-people-search-error">{searchError}</small> : null}
          </>
        ) : <p className="message-add-people-limit">This group has reached its 50-person limit.</p>}
        <footer>
          <small>{activeHandles.size} of 50 places used</small>
          <span>
            <button type="button" disabled={adding} onClick={onClose}>Cancel</button>
            <button type="button" disabled={adding || !selected.length} onClick={() => void submit()}>
              {adding ? <LoaderCircle className="spin" size={14} /> : <UserPlus size={14} />}
              Add {selected.length ? selected.length : ""}
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}

type MessagingExperienceProps = {
  actor: ResearchProfile;
  profiles: Record<string, ResearchProfile>;
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string | null) => void;
  onOpenProfile: (handle: string) => void;
  onOpenFull?: (conversationId: string | null) => void;
  onClose?: () => void;
  liveEvents?: MessagingLiveEvent[];
  onTabletContextChange?: (context: { conversationId: string; title: string; content: string } | null) => void;
  quick?: boolean;
};

export function MessagingExperience({
  actor,
  profiles,
  selectedConversationId,
  onSelectConversation,
  onOpenProfile,
  onOpenFull,
  onClose,
  liveEvents = emptyMessagingLiveEvents,
  onTabletContextChange,
  quick = false
}: MessagingExperienceProps) {
  const [conversations, setConversations] = useState<ConversationSummaryContract[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationSummaryContract | null>(null);
  const [messages, setMessages] = useState<MessageContract[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [draftState, dispatchDraft] = useReducer(reduceMessageDraft, emptyMessageDraftState);
  const draft = draftState.body;
  const [draftSyncState, setDraftSyncState] = useState<MessageDraftSyncState>("idle");
  const [draftStorageState, setDraftStorageState] = useState<MessageDraftStorageState>("available");
  const [draftServerHydrated, setDraftServerHydrated] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingMessageAttachment[]>([]);
  const [sendingCount, setSendingCount] = useState(0);
  const [conversationListLoading, setConversationListLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(Boolean(selectedConversationId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<"info" | "people" | "shared">("info");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageContract[] | null>(null);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mediaKind, setMediaKind] = useState<MessageMediaKind | null>(null);
  const [mediaResults, setMediaResults] = useState<MessageContract[]>([]);
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<MessageAttachmentPreview | null>(null);
  const [historyContextMessageId, setHistoryContextMessageId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const conversationSentinelRef = useRef<HTMLDivElement | null>(null);
  const draftStateRef = useRef<MessageDraftState>(draftState);
  const draftServerHydratedRef = useRef(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftRetryTimerRef = useRef<number | null>(null);
  const draftRetryAttemptRef = useRef(0);
  const persistDraftRef = useRef<(conversationId: string, body: string, expectedRevision: number, clientVersion: string) => void>(() => undefined);
  const failedSendAttachmentsRef = useRef(new Map<string, PendingMessageAttachment[]>());
  const failedSendDraftsRef = useRef(new Map<string, FailedSendDraft[]>());
  const latestSendDraftRef = useRef(new Map<string, ConversationDraftSnapshot>());
  const pendingSendCountsRef = useRef(new Map<string, number>());
  const sendConversationAliasesRef = useRef(new Map<string, string>());
  const locallyHiddenMessageIdsRef = useRef(new Set<string>());
  const sendRequestQueuesRef = useRef(new Map<string, Promise<void>>());
  const sendSequenceRef = useRef(0);
  const sendSessionRef = useRef({ actorHandle: actor.handle, generation: 1 });
  const liveRefreshTimerRef = useRef<number | null>(null);
  const liveRefreshConversationIdRef = useRef<string | null>(null);
  const readReceiptTimerRef = useRef<number | null>(null);
  const readReceiptConversationRef = useRef<string | null>(null);
  const readReceiptInFlightRef = useRef(false);
  const flushReadReceiptRef = useRef<() => void>(() => undefined);
  const latestReadSequenceRef = useRef(0);
  const conversationListEpochRef = useRef(0);
  const conversationLoadEpochRef = useRef(0);
  const conversationProjectionEpochRef = useRef(0);
  const conversationProjectionEpochByIdRef = useRef(new Map<string, number>());
  const messageProjectionEpochByConversationRef = useRef(new Map<string, number>());
  const conversationSummaryEpochRef = useRef(new Map<string, number>());
  const conversationSummaryRetryTimersRef = useRef(new Map<string, number>());
  const conversationSummaryRetryAttemptsRef = useRef(new Map<string, number>());
  const loadConversationRef = useRef<(conversationId: string, options?: { older?: boolean; quiet?: boolean }) => void>(() => undefined);
  const mediaLoadEpochRef = useRef(0);
  const searchLoadEpochRef = useRef(0);
  const discoveryRefreshTimerRef = useRef<number | null>(null);
  const refreshDiscoveryRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(true);
  const pendingAttachmentsRef = useRef<PendingMessageAttachment[]>(pendingAttachments);
  const conversationsRef = useRef<ConversationSummaryContract[]>(conversations);
  const messagesRef = useRef<MessageContract[]>(messages);
  const searchResultsRef = useRef<MessageContract[] | null>(searchResults);
  const mediaKindRef = useRef<MessageMediaKind | null>(mediaKind);
  const processedLiveEventKeysRef = useRef<string[]>(liveEvents.map(messagingLiveEventKey));
  const processedLiveEventKeySetRef = useRef(new Set(processedLiveEventKeysRef.current));
  const selectedRef = useRef(selectedConversationId);
  if (sendSessionRef.current.actorHandle !== actor.handle) {
    sendSessionRef.current = {
      actorHandle: actor.handle,
      generation: sendSessionRef.current.generation + 1
    };
  }
  selectedRef.current = selectedConversationId;
  draftStateRef.current = draftState;
  pendingAttachmentsRef.current = pendingAttachments;
  conversationsRef.current = conversations;
  messagesRef.current = messages;
  searchResultsRef.current = searchResults;
  mediaKindRef.current = mediaKind;

  const markConversationProjectionChanged = useCallback((conversationId: string) => {
    conversationProjectionEpochRef.current += 1;
    conversationProjectionEpochByIdRef.current.set(
      conversationId,
      (conversationProjectionEpochByIdRef.current.get(conversationId) ?? 0) + 1
    );
  }, []);

  const markMessageProjectionChanged = useCallback((conversationId: string) => {
    messageProjectionEpochByConversationRef.current.set(
      conversationId,
      (messageProjectionEpochByConversationRef.current.get(conversationId) ?? 0) + 1
    );
  }, []);

  const applyDraftAction = useCallback((action: MessageDraftAction) => {
    const next = reduceMessageDraft(draftStateRef.current, action);
    draftStateRef.current = next;
    dispatchDraft(action);
    return next;
  }, []);

  const flushReadReceipt = useCallback(() => {
    const conversationId = readReceiptConversationRef.current;
    const sequence = latestReadSequenceRef.current;
    if (
      !conversationId ||
      selectedRef.current !== conversationId ||
      sequence <= 0 ||
      readReceiptInFlightRef.current ||
      !messageReadViewportActive({
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        nearLatestMessage: shouldStickToBottomRef.current
      })
    ) return;
    readReceiptInFlightRef.current = true;
    void symposiumApi.request(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: "POST",
      body: { actorHandle: actor.handle, sequence }
    }).then(() => {
      if (readReceiptConversationRef.current === conversationId && latestReadSequenceRef.current <= sequence) {
        latestReadSequenceRef.current = 0;
      }
      setConversation((current) => current?.id === conversationId && messageReadAcknowledgesSummary(current.lastMessage?.sequence ?? 0, sequence)
        ? { ...current, unreadCount: 0 }
        : current);
      setConversations((current) => current.map((entry) => entry.id === conversationId && messageReadAcknowledgesSummary(entry.lastMessage?.sequence ?? 0, sequence)
        ? { ...entry, unreadCount: 0 }
        : entry));
    }).catch(() => {
      // Keep the pending sequence so focus, visibility, scroll, or a later live
      // event can retry without falsely presenting the conversation as read.
      if (readReceiptTimerRef.current === null) {
        readReceiptTimerRef.current = window.setTimeout(() => {
          readReceiptTimerRef.current = null;
          flushReadReceiptRef.current();
        }, 2_000);
      }
    }).finally(() => {
      readReceiptInFlightRef.current = false;
      const pendingConversationId = readReceiptConversationRef.current;
      if (messageReadFollowUpNeeded({
        pendingConversationId,
        pendingSequence: latestReadSequenceRef.current,
        acknowledgedConversationId: conversationId,
        acknowledgedSequence: sequence
      })) {
        if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
        readReceiptTimerRef.current = window.setTimeout(() => {
          readReceiptTimerRef.current = null;
          flushReadReceiptRef.current();
        }, 0);
      }
    });
  }, [actor.handle]);
  flushReadReceiptRef.current = flushReadReceipt;

  const scheduleReadReceipt = useCallback((conversationId: string, sequence: number) => {
    if (readReceiptConversationRef.current !== conversationId) {
      readReceiptConversationRef.current = conversationId;
      latestReadSequenceRef.current = 0;
    }
    latestReadSequenceRef.current = Math.max(latestReadSequenceRef.current, sequence);
    if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
    readReceiptTimerRef.current = window.setTimeout(() => {
      readReceiptTimerRef.current = null;
      flushReadReceiptRef.current();
    }, 140);
  }, []);

  useEffect(() => {
    if (!onTabletContextChange) return;
    if (!conversation) {
      onTabletContextChange(null);
      return;
    }
    onTabletContextChange({
      conversationId: conversation.id,
      title: conversationName(conversation, actor.handle),
      content: messages.slice(-12).map((message) => {
        const sender = message.senderHandle ? cleanHandle(message.senderHandle) : "system";
        const body = message.deletedAt ? "[deleted message]" : message.body;
        return `${sender}: ${body || (message.attachments.length ? "[shared attachments]" : "")}`;
      }).join("\n")
    });
  }, [actor.handle, conversation, messages, onTabletContextChange]);

  const loadConversations = useCallback(async (append = false) => {
    const requestEpoch = append ? conversationListEpochRef.current : conversationListEpochRef.current + 1;
    if (!append) conversationListEpochRef.current = requestEpoch;
    const projectionEpoch = conversationProjectionEpochRef.current;
    const cursor = append ? conversationCursor : null;
    const parameters = new URLSearchParams({ limit: quick ? "8" : "24" });
    if (cursor) parameters.set("cursor", cursor);
    try {
      const page = await symposiumApi.request<ConversationPageContract>(
        withActor(`/api/conversations?${parameters.toString()}`, actor.handle),
        { cache: "no-store" }
      );
      if (requestEpoch !== conversationListEpochRef.current) return;
      const projectionChanged = projectionEpoch !== conversationProjectionEpochRef.current;
      setConversations((current) => projectionChanged
        ? mergeConversationPageAfterProjectionChange(current, page.conversations)
        : append
          ? [...current, ...page.conversations.filter((entry) => !current.some((existing) => existing.id === entry.id))]
          : page.conversations);
      setConversationCursor(page.nextCursor);
      setError("");
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (requestEpoch === conversationListEpochRef.current) setConversationListLoading(false);
    }
  }, [actor.handle, conversationCursor, quick]);

  const loadConversation = useCallback(async (conversationId: string, options: { older?: boolean; quiet?: boolean } = {}) => {
    const requestEpoch = options.older ? conversationLoadEpochRef.current : conversationLoadEpochRef.current + 1;
    if (!options.older) conversationLoadEpochRef.current = requestEpoch;
    const projectionEpoch = messageProjectionEpochByConversationRef.current.get(conversationId) ?? 0;
    if (!messageIdPattern.test(conversationId)) {
      const recipientHandle = cleanHandle(conversationId.replace(/^direct:/, ""));
      const recipient = profiles[recipientHandle];
      setConversation(null);
      setMessages([]);
      setMessageCursor(null);
      if (!options.quiet) setConversationLoading(false);
      if (!recipient) setError("This profile is not available.");
      return;
    }
    if (options.older && !messageCursor) return;
    if (options.older) setLoadingOlder(true);
    else if (!options.quiet) setConversationLoading(true);
    const parameters = new URLSearchParams({ limit: quick ? "30" : "50" });
    if (options.older && messageCursor) parameters.set("cursor", messageCursor);
    const priorScrollHeight = options.older ? historyRef.current?.scrollHeight ?? 0 : 0;
    try {
      const page = await symposiumApi.request<MessagePageContract>(
        withActor(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${parameters.toString()}`, actor.handle),
        { cache: "no-store" }
      );
      if (requestEpoch !== conversationLoadEpochRef.current || selectedRef.current !== conversationId) return;
      if (
        !options.older &&
        projectionEpoch !== (messageProjectionEpochByConversationRef.current.get(conversationId) ?? 0)
      ) {
        void loadConversationRef.current(conversationId, { quiet: options.quiet });
        return;
      }
      setConversation(page.conversation);
      if (!draftServerHydratedRef.current) {
        const local = readLocalDraft(actor.handle, conversationId);
        const hydratedDraft = applyDraftAction({
          type: "select",
          conversationId,
          localDraft: local,
          serverBody: page.conversation.draftBody,
          serverRevision: page.conversation.draftRevision ?? 1,
          serverClientVersion: page.conversation.draftClientVersion ?? null,
          serverUpdatedAt: page.conversation.draftUpdatedAt
        });
        draftServerHydratedRef.current = true;
        setDraftServerHydrated(true);
        setDraftSyncState(hydratedDraft.dirty ? "local" : "idle");
      }
      const visiblePageMessages = page.messages.filter((message) => !locallyHiddenMessageIdsRef.current.has(message.id));
      setMessages((current) => options.older
        ? mergeCanonicalMessagePage(current, visiblePageMessages)
        : visiblePageMessages);
      if (!options.older) setHistoryContextMessageId(null);
      setMessageCursor(page.nextCursor);
      setConversations((current) => current.map((entry) => entry.id === page.conversation.id ? page.conversation : entry));
      if (!options.older && page.conversation.status === "active") {
        const latest = page.messages.at(-1)?.sequence ?? page.conversation.lastMessage?.sequence ?? 0;
        if (latest > 0) scheduleReadReceipt(conversationId, latest);
      }
      setError("");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const history = historyRef.current;
          if (!history) return;
          if (options.older) history.scrollTop += history.scrollHeight - priorScrollHeight;
          else if (shouldStickToBottomRef.current) history.scrollTop = history.scrollHeight;
        });
      });
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (requestEpoch === conversationLoadEpochRef.current && selectedRef.current === conversationId) {
        if (!options.quiet) setConversationLoading(false);
        setLoadingOlder(false);
      }
    }
  }, [actor.handle, messageCursor, profiles, quick, scheduleReadReceipt]);
  loadConversationRef.current = loadConversation;

  const loadConversationSummary = useCallback(async (conversationId: string) => {
    if (!messageIdPattern.test(conversationId)) return;
    const pendingRetry = conversationSummaryRetryTimersRef.current.get(conversationId);
    if (pendingRetry !== undefined) window.clearTimeout(pendingRetry);
    conversationSummaryRetryTimersRef.current.delete(conversationId);
    const requestEpoch = (conversationSummaryEpochRef.current.get(conversationId) ?? 0) + 1;
    conversationSummaryEpochRef.current.set(conversationId, requestEpoch);
    const projectionEpoch = conversationProjectionEpochByIdRef.current.get(conversationId) ?? 0;
    const requestActorHandle = actor.handle;
    const requestGeneration = sendSessionRef.current.generation;
    try {
      const result = await symposiumApi.request<{ conversation: ConversationSummaryContract }>(
        withActor(`/api/conversations/${encodeURIComponent(conversationId)}`, requestActorHandle),
        { cache: "no-store" }
      );
      if (
        conversationSummaryEpochRef.current.get(conversationId) !== requestEpoch ||
        sendSessionRef.current.actorHandle !== requestActorHandle ||
        sendSessionRef.current.generation !== requestGeneration
      ) return;
      conversationSummaryRetryAttemptsRef.current.delete(conversationId);
      if (projectionEpoch !== (conversationProjectionEpochByIdRef.current.get(conversationId) ?? 0)) {
        void loadConversationSummaryRef.current(conversationId);
        return;
      }
      const summary = result.conversation;
      setConversations((current) => upsertConversationProjection(current, summary));
      if (selectedRef.current === conversationId) {
        setConversation(summary);
        const next = applyDraftAction({
          type: "server",
          conversationId,
          body: summary.draftBody,
          revision: summary.draftRevision,
          clientVersion: summary.draftClientVersion,
          preserveLocal: draftStateRef.current.dirty,
          updatedAt: summary.draftUpdatedAt
        });
        setDraftSyncState(next.dirty ? "local" : "idle");
      }
    } catch (loadError) {
      if (
        conversationSummaryEpochRef.current.get(conversationId) !== requestEpoch ||
        sendSessionRef.current.actorHandle !== requestActorHandle ||
        sendSessionRef.current.generation !== requestGeneration
      ) return;
      if (loadError instanceof SymposiumApiError && loadError.status === 404) {
        conversationSummaryRetryAttemptsRef.current.delete(conversationId);
        conversationListEpochRef.current += 1;
        setConversations((current) => current.filter((entry) => entry.id !== conversationId));
        if (selectedRef.current === conversationId) selectConversation(null);
        return;
      }
      setError(errorText(loadError));
      if (!retryableMessagingFailure(loadError)) {
        conversationSummaryRetryAttemptsRef.current.delete(conversationId);
        return;
      }
      const attempt = Math.min(6, (conversationSummaryRetryAttemptsRef.current.get(conversationId) ?? 0) + 1);
      conversationSummaryRetryAttemptsRef.current.set(conversationId, attempt);
      const retryTimer = window.setTimeout(() => {
        conversationSummaryRetryTimersRef.current.delete(conversationId);
        loadConversationSummaryRef.current(conversationId);
      }, Math.min(30_000, 1_000 * (2 ** (attempt - 1))));
      conversationSummaryRetryTimersRef.current.set(conversationId, retryTimer);
    }
  }, [actor.handle, applyDraftAction]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadConversationSummaryRef = useRef(loadConversationSummary);
  loadConversationSummaryRef.current = loadConversationSummary;

  useEffect(() => {
    setConversationListLoading(true);
    void loadConversations(false);
  }, [actor.handle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const flushWhenActive = () => flushReadReceiptRef.current();
    window.addEventListener("focus", flushWhenActive);
    window.addEventListener("online", flushWhenActive);
    document.addEventListener("visibilitychange", flushWhenActive);
    return () => {
      window.removeEventListener("focus", flushWhenActive);
      window.removeEventListener("online", flushWhenActive);
      document.removeEventListener("visibilitychange", flushWhenActive);
    };
  }, []);

  const mergeLiveMessage = useCallback((incoming: MessageContract, kind: string) => {
    markMessageProjectionChanged(incoming.conversationId);
    markConversationProjectionChanged(incoming.conversationId);
    const selected = selectedRef.current === incoming.conversationId;
    if (selected) {
      setMessages((current) => kind === "message.sent" || current.some((message) => message.id === incoming.id)
        ? mergeCanonicalMessage(current, incoming)
        : current);
      if (kind === "message.sent" && cleanHandle(incoming.senderHandle ?? "") !== cleanHandle(actor.handle)) {
        scheduleReadReceipt(incoming.conversationId, incoming.sequence);
      }
      window.requestAnimationFrame(() => {
        const history = historyRef.current;
        if (history && shouldStickToBottomRef.current) history.scrollTop = history.scrollHeight;
      });
      setSearchResults((current) => current ? reconcileDiscoveryMessage(current, incoming) : current);
      setMediaResults((current) => reconcileDiscoveryMessage(current, incoming));
      if (searchResultsRef.current || mediaKindRef.current) {
        searchLoadEpochRef.current += 1;
        mediaLoadEpochRef.current += 1;
        if (discoveryRefreshTimerRef.current !== null) window.clearTimeout(discoveryRefreshTimerRef.current);
        discoveryRefreshTimerRef.current = window.setTimeout(() => {
          discoveryRefreshTimerRef.current = null;
          refreshDiscoveryRef.current();
        }, 0);
      }
    }

    const mergeSummary = (current: ConversationSummaryContract) => {
      const alreadyHadMessage = current.lastMessage?.id === incoming.id;
      const incomingFromAnotherPerson = cleanHandle(incoming.senderHandle ?? "") !== cleanHandle(actor.handle);
      const shouldReplaceLast = !current.lastMessage || incoming.sequence >= current.lastMessage.sequence;
      const summaryMessage = alreadyHadMessage && !incoming.deletedAt
        ? { ...incoming, starred: current.lastMessage!.starred }
        : incoming;
      return {
        ...current,
        lastMessage: shouldReplaceLast ? summaryMessage : current.lastMessage,
        unreadCount: kind === "message.sent" && incomingFromAnotherPerson && !alreadyHadMessage
            ? current.unreadCount + 1
            : current.unreadCount,
        updatedAt: kind === "message.sent" && shouldReplaceLast ? incoming.createdAt : current.updatedAt
      };
    };

    setConversation((current) => current?.id === incoming.conversationId ? mergeSummary(current) : current);
    setConversations((current) => current
      .map((entry) => entry.id === incoming.conversationId ? mergeSummary(entry) : entry)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt)));
  }, [actor.handle, markConversationProjectionChanged, markMessageProjectionChanged, scheduleReadReceipt]);

  useEffect(() => {
    let shouldRefreshConversations = false;
    for (const liveEvent of liveEvents) {
      const eventKey = messagingLiveEventKey(liveEvent);
      if (processedLiveEventKeySetRef.current.has(eventKey)) continue;
      processedLiveEventKeySetRef.current.add(eventKey);
      processedLiveEventKeysRef.current.push(eventKey);
      if (processedLiveEventKeysRef.current.length > 1000) {
        const discardedKey = processedLiveEventKeysRef.current.shift();
        if (discardedKey) processedLiveEventKeySetRef.current.delete(discardedKey);
      }

      const canonicalMessage = canonicalMessageFromLiveEvent(liveEvent);
      if (canonicalMessage) {
        const knownConversation = conversationsRef.current.find((entry) => entry.id === canonicalMessage.conversationId);
        const activeSequence = selectedRef.current === canonicalMessage.conversationId
          ? messagesRef.current.at(-1)?.sequence ?? 0
          : 0;
        const knownSequence = Math.max(activeSequence, knownConversation?.lastMessage?.sequence ?? 0);
        const sequenceGap = liveEvent.kind === "message.sent" && knownSequence > 0 && canonicalMessage.sequence > knownSequence + 1;
        mergeLiveMessage(canonicalMessage, liveEvent.kind);
        if (!knownConversation) void loadConversationSummary(canonicalMessage.conversationId);
        if (sequenceGap && selectedRef.current === canonicalMessage.conversationId) {
          void loadConversation(canonicalMessage.conversationId, { quiet: true });
        }
        continue;
      }
      if (liveEvent.kind === "message.star.updated") {
        const messageId = liveEvent.payload?.messageId;
        const active = liveEvent.payload?.active;
        if (typeof messageId === "string" && typeof active === "boolean") {
          markMessageProjectionChanged(liveEventConversationId(liveEvent));
          markConversationProjectionChanged(liveEventConversationId(liveEvent));
          const updateStar = (entry: MessageContract) => entry.id === messageId ? { ...entry, starred: active } : entry;
          setMessages((current) => current.map(updateStar));
          setSearchResults((current) => current?.map(updateStar) ?? current);
          setMediaResults((current) => mediaKindRef.current === "starred" && !active
            ? current.filter((entry) => entry.id !== messageId)
            : current.map(updateStar));
          setConversation((current) => current?.lastMessage?.id === messageId
            ? { ...current, lastMessage: updateStar(current.lastMessage) }
            : current);
          setConversations((current) => current.map((entry) => entry.lastMessage?.id === messageId
            ? { ...entry, lastMessage: updateStar(entry.lastMessage) }
            : entry));
          if (mediaKindRef.current === "starred") {
            mediaLoadEpochRef.current += 1;
            if (discoveryRefreshTimerRef.current !== null) window.clearTimeout(discoveryRefreshTimerRef.current);
            discoveryRefreshTimerRef.current = window.setTimeout(() => {
              discoveryRefreshTimerRef.current = null;
              refreshDiscoveryRef.current();
            }, 0);
          }
        }
        continue;
      }
      if (liveEvent.kind === "conversation.draft.updated" || liveEvent.kind === "conversation.read") {
        const conversationId = liveEventConversationId(liveEvent);
        markConversationProjectionChanged(conversationId);
        void loadConversationSummary(conversationId);
        continue;
      }
      if (!messagingEventRequiresRefresh(liveEvent)) continue;
      const eventConversationId = liveEventConversationId(liveEvent);
      markConversationProjectionChanged(eventConversationId);
      shouldRefreshConversations = true;
      const activeConversationId = selectedRef.current;
      if (activeConversationId && activeConversationId === eventConversationId && messageIdPattern.test(activeConversationId)) {
        liveRefreshConversationIdRef.current = activeConversationId;
      }
    }
    if (shouldRefreshConversations && liveRefreshTimerRef.current === null) {
      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null;
        void loadConversations(false);
        const conversationId = liveRefreshConversationIdRef.current;
        liveRefreshConversationIdRef.current = null;
        if (conversationId && selectedRef.current === conversationId) {
          void loadConversation(conversationId, { quiet: true });
        }
      }, 0);
    }
  }, [liveEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = null;
    liveRefreshConversationIdRef.current = null;
    if (discoveryRefreshTimerRef.current !== null) window.clearTimeout(discoveryRefreshTimerRef.current);
    discoveryRefreshTimerRef.current = null;
  }, []);

  useEffect(() => {
    for (const attachment of pendingAttachmentsRef.current) void discardPendingAttachment(attachment, actor.handle);
    if (!selectedConversationId) {
      draftServerHydratedRef.current = false;
      setDraftServerHydrated(false);
      readReceiptConversationRef.current = null;
      latestReadSequenceRef.current = 0;
      if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
      readReceiptTimerRef.current = null;
      setConversation(null);
      setMessages([]);
      setMessageCursor(null);
      setHistoryContextMessageId(null);
      setConversationLoading(false);
      applyDraftAction({
        type: "select",
        conversationId: null,
        localDraft: null,
        serverBody: "",
        serverRevision: 1,
        serverClientVersion: null,
        serverUpdatedAt: null
      });
      setDraftSyncState("idle");
      setPendingAttachments([]);
      setAttachmentPreview(null);
      return;
    }
    const failedConversationKey = Array.from(failedSendDraftsRef.current.keys()).find((key) =>
      !pendingSendCountsRef.current.get(key) &&
      (sendConversationAliasesRef.current.get(key) ?? key) === selectedConversationId
    );
    const failedDrafts = failedConversationKey
      ? (failedSendDraftsRef.current.get(failedConversationKey) ?? []).sort((left, right) => left.sequence - right.sequence)
      : [];
    const failedBody = failedDrafts.map((failure) => failure.body).filter(Boolean).join("\n");
    const storedLocal = readLocalDraft(actor.handle, selectedConversationId);
    const latestFailedDraft = failedConversationKey
      ? latestSendDraftRef.current.get(selectedConversationId) ?? latestSendDraftRef.current.get(failedConversationKey)
      : null;
    const local = failedBody ? {
      version: 1 as const,
      body: [failedBody, storedLocal?.body ?? ""].filter(Boolean).join("\n"),
      clientVersion: createMessageDraftClientVersion(),
      baseRevision: latestFailedDraft?.revision ?? storedLocal?.baseRevision ?? Math.max(1, ...failedDrafts.map((failure) => failure.baseRevision)),
      updatedAt: new Date().toISOString(),
      recovery: storedLocal?.recovery ?? null
    } : storedLocal;
    if (failedConversationKey) failedSendDraftsRef.current.delete(failedConversationKey);
    if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
    readReceiptTimerRef.current = null;
    const summary = conversations.find((entry) => entry.id === selectedConversationId);
    const canonicalReady = !messageIdPattern.test(selectedConversationId) || Boolean(summary);
    draftServerHydratedRef.current = canonicalReady;
    setDraftServerHydrated(canonicalReady);
    setConversation(summary ?? null);
    setMessages([]);
    setMessageCursor(null);
    setHistoryContextMessageId(null);
    setConversationLoading(messageIdPattern.test(selectedConversationId));
    const selectedDraft = applyDraftAction({
      type: "select",
      conversationId: selectedConversationId,
      localDraft: local,
      serverBody: summary?.draftBody ?? "",
      serverRevision: summary?.draftRevision ?? 1,
      serverClientVersion: summary?.draftClientVersion ?? null,
      serverUpdatedAt: summary?.draftUpdatedAt ?? null
    });
    setDraftSyncState(selectedDraft.dirty ? "local" : "idle");
    const failedAttachments = failedSendAttachmentsRef.current.get(selectedConversationId) ??
      (failedConversationKey ? failedSendAttachmentsRef.current.get(failedConversationKey) ?? [] : []);
    failedSendAttachmentsRef.current.delete(selectedConversationId);
    if (failedConversationKey) failedSendAttachmentsRef.current.delete(failedConversationKey);
    setPendingAttachments(failedAttachments);
    setAttachmentPreview(null);
    setAddPeopleOpen(false);
    setInfoTab("info");
    shouldStickToBottomRef.current = true;
    readReceiptConversationRef.current = selectedConversationId;
    latestReadSequenceRef.current = 0;
    setSearchResults(null);
    setSearchCursor(null);
    setSearchLoading(false);
    setMediaKind(null);
    setMediaResults([]);
    setMediaCursor(null);
    setMediaLoading(false);
    void loadConversation(selectedConversationId);
  }, [actor.handle, selectedConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedConversationId || !messageIdPattern.test(selectedConversationId)) return;
    const summary = conversations.find((entry) => entry.id === selectedConversationId);
    if (!summary) return;
    setConversation((current) => current?.id === selectedConversationId ? current : summary);
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId || messageIdPattern.test(selectedConversationId)) return;
    const recipientHandle = cleanHandle(selectedConversationId.replace(/^direct:/, ""));
    if (!profiles[recipientHandle]) return;
    setError((current) => current === "This profile is not available." ? "" : current);
  }, [profiles, selectedConversationId]);

  useEffect(() => {
    mountedRef.current = true;
    setSendingCount(0);
    return () => {
      mountedRef.current = false;
      conversationListEpochRef.current += 1;
      conversationLoadEpochRef.current += 1;
      conversationProjectionEpochRef.current += 1;
      conversationProjectionEpochByIdRef.current.clear();
      messageProjectionEpochByConversationRef.current.clear();
      conversationSummaryEpochRef.current.clear();
      for (const timer of conversationSummaryRetryTimersRef.current.values()) window.clearTimeout(timer);
      conversationSummaryRetryTimersRef.current.clear();
      conversationSummaryRetryAttemptsRef.current.clear();
      locallyHiddenMessageIdsRef.current.clear();
      if (draftRetryTimerRef.current !== null) window.clearTimeout(draftRetryTimerRef.current);
      draftRetryTimerRef.current = null;
      draftRetryAttemptRef.current = 0;
      for (const attachment of pendingAttachmentsRef.current) void discardPendingAttachment(attachment, actor.handle);
      for (const [conversationId, failures] of failedSendDraftsRef.current) {
        const restoredConversationId = sendConversationAliasesRef.current.get(conversationId) ?? conversationId;
        persistFailedMessageDraft({
          actorHandle: actor.handle,
          conversationId: restoredConversationId,
          failures,
          latestDraft: latestSendDraftRef.current.get(restoredConversationId) ?? latestSendDraftRef.current.get(conversationId)
        });
      }
      for (const attachments of failedSendAttachmentsRef.current.values()) {
        for (const attachment of attachments) void discardPendingAttachment(attachment, actor.handle);
      }
      failedSendAttachmentsRef.current.clear();
      failedSendDraftsRef.current.clear();
      latestSendDraftRef.current.clear();
      pendingSendCountsRef.current.clear();
      sendConversationAliasesRef.current.clear();
      sendRequestQueuesRef.current.clear();
      if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
    };
  }, [actor.handle]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const summary = conversations.find((entry) => entry.id === selectedConversationId);
    if (!summary) return;
    if (!draftServerHydratedRef.current) {
      const local = readLocalDraft(actor.handle, selectedConversationId);
      const hydratedDraft = applyDraftAction({
        type: "select",
        conversationId: selectedConversationId,
        localDraft: local,
        serverBody: summary.draftBody,
        serverRevision: summary.draftRevision,
        serverClientVersion: summary.draftClientVersion,
        serverUpdatedAt: summary.draftUpdatedAt
      });
      draftServerHydratedRef.current = true;
      setDraftServerHydrated(true);
      setDraftSyncState(hydratedDraft.dirty ? "local" : "idle");
      return;
    }
    applyDraftAction({
      type: "server",
      conversationId: selectedConversationId,
      body: summary.draftBody,
      revision: summary.draftRevision ?? 1,
      clientVersion: summary.draftClientVersion ?? null,
      preserveLocal: draftStateRef.current.dirty,
      updatedAt: summary.draftUpdatedAt
    });
  }, [conversations, selectedConversationId]);

  const persistDraft = useCallback(async (
    conversationId: string,
    body: string,
    expectedRevision: number,
    clientVersion: string
  ) => {
    if (!messageIdPattern.test(conversationId)) return;
    if (draftRetryTimerRef.current !== null) window.clearTimeout(draftRetryTimerRef.current);
    draftRetryTimerRef.current = null;
    const requestActorHandle = actor.handle;
    const requestGeneration = sendSessionRef.current.generation;
    const ownsDraftSurface = () => mountedRef.current &&
      sendSessionRef.current.actorHandle === requestActorHandle &&
      sendSessionRef.current.generation === requestGeneration;
    if (selectedRef.current === conversationId) setDraftSyncState("saving");
    try {
      const saved = await symposiumApi.request<{
        conflict?: false;
        draft?: ConversationDraftSnapshot;
        body?: string;
        updatedAt?: string | null;
      }>(`/api/conversations/${encodeURIComponent(conversationId)}/draft`, {
        method: "PATCH",
        idempotencyKey: createClientMutationId("message-draft-save"),
        body: { actorHandle: requestActorHandle, body, expectedRevision, clientVersion }
      });
      if (!ownsDraftSurface()) return;
      draftRetryAttemptRef.current = 0;
      const savedDraft = saved.draft ?? {
        body: saved.body ?? body,
        revision: expectedRevision + 1,
        clientVersion,
        updatedAt: saved.updatedAt ?? new Date().toISOString()
      };
      const next = applyDraftAction({
        type: "saved",
        conversationId,
        body: savedDraft.body,
        revision: savedDraft.revision,
        clientVersion: savedDraft.clientVersion ?? clientVersion,
        updatedAt: savedDraft.updatedAt
      });
      if (selectedRef.current === conversationId) {
        setDraftSyncState(next.dirty ? "local" : "saved");
      }
    } catch (saveError) {
      if (!ownsDraftSurface()) return;
      const canonical = conversationDraftFromConflict(saveError);
      if (canonical) {
        draftRetryAttemptRef.current = 0;
        const requestWasAlreadyApplied = canonical.body === body && canonical.clientVersion === clientVersion;
        const next = applyDraftAction(requestWasAlreadyApplied ? {
          type: "saved",
          conversationId,
          body: canonical.body,
          revision: canonical.revision,
          clientVersion,
          updatedAt: canonical.updatedAt
        } : {
          type: "server",
          conversationId,
          body: canonical.body,
          revision: canonical.revision,
          clientVersion: canonical.clientVersion,
          preserveLocal: true,
          updatedAt: canonical.updatedAt
        });
        if (selectedRef.current === conversationId) setDraftSyncState(next.dirty ? "local" : "saved");
        return;
      }
      if (selectedRef.current === conversationId) setDraftSyncState("local");
      if (!retryableMessagingFailure(saveError)) {
        setError(errorText(saveError));
        return;
      }
      const retryAttempt = Math.min(6, draftRetryAttemptRef.current + 1);
      draftRetryAttemptRef.current = retryAttempt;
      const retryDelay = Math.min(30_000, 1_000 * (2 ** (retryAttempt - 1)));
      draftRetryTimerRef.current = window.setTimeout(() => {
        draftRetryTimerRef.current = null;
        const current = draftStateRef.current;
        if (
          ownsDraftSurface() &&
          current.conversationId === conversationId &&
          current.dirty &&
          current.clientVersion
        ) {
          persistDraftRef.current(
            conversationId,
            current.body,
            current.serverRevision,
            current.clientVersion
          );
        }
      }, retryDelay);
    }
  }, [actor.handle, applyDraftAction]);
  persistDraftRef.current = persistDraft;

  useEffect(() => {
    if (!selectedConversationId || draftState.conversationId !== selectedConversationId) return;
    if (messageIdPattern.test(selectedConversationId) && !draftServerHydrated) return;
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
    if (draftRetryTimerRef.current !== null) window.clearTimeout(draftRetryTimerRef.current);
    draftRetryTimerRef.current = null;
    draftRetryAttemptRef.current = 0;
    const storageKey = localDraftKey(actor.handle, selectedConversationId);
    const storedDraft = storedMessageDraftFromState(draftState);
    try {
      if (storedDraft) window.localStorage.setItem(storageKey, JSON.stringify(storedDraft));
      else window.localStorage.removeItem(storageKey);
      setDraftStorageState("available");
    } catch {
      // The in-memory editor remains authoritative when browser storage is full or unavailable.
      setDraftStorageState("memory-only");
    }
    if (draftState.dirty && draftState.clientVersion && messageIdPattern.test(selectedConversationId)) {
      const body = draftState.body;
      const expectedRevision = draftState.serverRevision;
      const clientVersion = draftState.clientVersion;
      draftSaveTimerRef.current = window.setTimeout(() => {
        draftSaveTimerRef.current = null;
        void persistDraft(selectedConversationId, body, expectedRevision, clientVersion);
      }, 900);
    }
    return () => {
      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    };
  }, [actor.handle, draftServerHydrated, draftState, persistDraft, selectedConversationId]);

  useEffect(() => {
    const retryWhenActive = () => {
      if (document.visibilityState !== "visible") return;
      const current = draftStateRef.current;
      if (!current.conversationId || !current.dirty || !current.clientVersion) return;
      if (draftRetryTimerRef.current !== null) window.clearTimeout(draftRetryTimerRef.current);
      draftRetryTimerRef.current = null;
      draftRetryAttemptRef.current = 0;
      persistDraftRef.current(
        current.conversationId,
        current.body,
        current.serverRevision,
        current.clientVersion
      );
    };
    window.addEventListener("focus", retryWhenActive);
    window.addEventListener("online", retryWhenActive);
    document.addEventListener("visibilitychange", retryWhenActive);
    return () => {
      window.removeEventListener("focus", retryWhenActive);
      window.removeEventListener("online", retryWhenActive);
      document.removeEventListener("visibilitychange", retryWhenActive);
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 288)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 288 ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    const sentinel = conversationSentinelRef.current;
    if (!sentinel || !conversationCursor || quick) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadConversations(true);
    }, { rootMargin: "140px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conversationCursor, loadConversations, quick]);

  const selectConversation = (id: string | null) => {
    setNewConversationOpen(false);
    onSelectConversation(id);
  };

  const createGroup = async (title: string, handles: string[]) => {
    try {
      const result = await symposiumApi.request<{ conversationId: string }>("/api/conversations/groups", {
        method: "POST",
        idempotencyKey: createClientMutationId("conversation-group"),
        body: { actorHandle: actor.handle, title, inviteeHandles: handles }
      });
      setNewConversationOpen(false);
      selectConversation(result.conversationId);
      await loadConversations(false);
    } catch (createError) {
      setError(errorText(createError));
    }
  };

  const restoreFailedSends = (conversationId: string) => {
    const restoredConversationId = sendConversationAliasesRef.current.get(conversationId) ?? conversationId;
    const failures = (failedSendDraftsRef.current.get(conversationId) ?? [])
      .sort((left, right) => left.sequence - right.sequence);
    failedSendDraftsRef.current.delete(conversationId);
    const failedBody = failures.map((failure) => failure.body).filter(Boolean).join("\n");

    if (mountedRef.current && selectedRef.current === restoredConversationId) {
      const activeDraft = draftStateRef.current;
      if (failedBody && activeDraft.conversationId === restoredConversationId) {
        const restoredBody = [failedBody, activeDraft.body].filter(Boolean).join("\n");
        const next = applyDraftAction({
          type: "edit",
          conversationId: restoredConversationId,
          body: restoredBody,
          clientVersion: createMessageDraftClientVersion(),
          updatedAt: new Date().toISOString()
        });
        setDraftSyncState(next.dirty ? "local" : "idle");
      }
      const failedAttachments = failedSendAttachmentsRef.current.get(conversationId) ?? [];
      failedSendAttachmentsRef.current.delete(conversationId);
      if (failedAttachments.length) {
        setPendingAttachments((current) => [
          ...failedAttachments,
          ...current.filter((entry) => !failedAttachments.some((failed) => failed.attachment.id === entry.attachment.id))
        ].slice(0, 10));
      }
      return;
    }

    if (!failedBody) {
      if (!mountedRef.current) {
        const failedAttachments = failedSendAttachmentsRef.current.get(conversationId) ?? [];
        failedSendAttachmentsRef.current.delete(conversationId);
        for (const attachment of failedAttachments) void discardPendingAttachment(attachment, actor.handle);
      }
      return;
    }
    const latestDraft = latestSendDraftRef.current.get(restoredConversationId) ?? latestSendDraftRef.current.get(conversationId);
    if (!persistFailedMessageDraft({
      actorHandle: actor.handle,
      conversationId: restoredConversationId,
      failures,
      latestDraft
    })) {
      // Failed text remains in memory until this mounted messaging surface closes.
      failedSendDraftsRef.current.set(conversationId, failures);
    }
    if (!mountedRef.current) {
      const failedAttachments = failedSendAttachmentsRef.current.get(conversationId) ?? [];
      failedSendAttachmentsRef.current.delete(conversationId);
      for (const attachment of failedAttachments) void discardPendingAttachment(attachment, actor.handle);
    }
  };

  const sendCurrent = () => {
    if (!selectedConversationId || conversation?.status === "removed" || conversation?.blockedByViewer || (!draft.trim() && !pendingAttachments.length)) return;
    const sendConversationId = selectedConversationId;
    const sendActorHandle = actor.handle;
    const sendGeneration = sendSessionRef.current.generation;
    const ownsSendSurface = () => mountedRef.current &&
      sendSessionRef.current.actorHandle === sendActorHandle &&
      sendSessionRef.current.generation === sendGeneration;
    const sendSequence = sendSequenceRef.current + 1;
    sendSequenceRef.current = sendSequence;
    pendingSendCountsRef.current.set(sendConversationId, (pendingSendCountsRef.current.get(sendConversationId) ?? 0) + 1);
    setSendingCount((current) => current + 1);
    shouldStickToBottomRef.current = true;
    const originalDraft = draft;
    const originalDraftRevision = draftStateRef.current.serverRevision;
    const originalDraftClientVersion = draftStateRef.current.clientVersion ?? createMessageDraftClientVersion();
    const originalAttachments = pendingAttachments;
    const attachmentIds = pendingAttachments.map((entry) => entry.attachment.id);
    applyDraftAction({ type: "clear", conversationId: sendConversationId });
    setDraftSyncState("idle");
    setPendingAttachments([]);
    setAttachmentPreview(null);
    removeLocalDraft(sendActorHandle, sendConversationId);
    const performSend = async () => {
      try {
        const directRecipient = !messageIdPattern.test(sendConversationId)
          ? cleanHandle(sendConversationId.replace(/^direct:/, ""))
          : undefined;
        const data = await symposiumApi.request<{ message: MessageContract; draft?: ConversationDraftSnapshot }>("/api/messages", {
          method: "POST",
          idempotencyKey: createClientMutationId("message-send"),
          body: {
            actorHandle: sendActorHandle,
            ...(directRecipient ? { recipientHandle: directRecipient } : { conversationId: sendConversationId }),
            body: originalDraft.trim(),
            attachmentIds,
            draftRevision: originalDraftRevision,
            draftClientVersion: originalDraftClientVersion
          }
        });
        const serverDraft = data.draft ?? {
          body: "",
          revision: originalDraftRevision + 1,
          clientVersion: null,
          updatedAt: new Date().toISOString()
        };
        for (const attachment of originalAttachments) revokePendingAttachment(attachment);
        if (!ownsSendSurface()) return;
        latestSendDraftRef.current.set(sendConversationId, serverDraft);
        latestSendDraftRef.current.set(data.message.conversationId, serverDraft);
        if (data.message.conversationId !== sendConversationId) {
          sendConversationAliasesRef.current.set(sendConversationId, data.message.conversationId);
        }
        applyDraftAction({
          type: "server",
          conversationId: sendConversationId,
          body: serverDraft.body,
          revision: serverDraft.revision,
          clientVersion: serverDraft.clientVersion,
          preserveLocal: draftStateRef.current.dirty,
          updatedAt: serverDraft.updatedAt
        });
        if (data.message.conversationId !== sendConversationId) selectConversation(data.message.conversationId);
        else mergeLiveMessage(data.message, "message.sent");
      } catch (sendError) {
        const failure = {
          sequence: sendSequence,
          body: originalDraft,
          baseRevision: originalDraftRevision,
          updatedAt: new Date().toISOString()
        };
        if (!ownsSendSurface()) {
          persistFailedMessageDraft({
            actorHandle: sendActorHandle,
            conversationId: sendConversationId,
            failures: [failure]
          });
          for (const attachment of originalAttachments) void discardPendingAttachment(attachment, sendActorHandle);
          return;
        }
        const failedDrafts = failedSendDraftsRef.current.get(sendConversationId) ?? [];
        failedSendDraftsRef.current.set(sendConversationId, [
          ...failedDrafts,
          failure
        ]);
        const waitingAttachments = failedSendAttachmentsRef.current.get(sendConversationId) ?? [];
        failedSendAttachmentsRef.current.set(sendConversationId, [
          ...waitingAttachments,
          ...originalAttachments.filter((entry) => !waitingAttachments.some((existing) => existing.attachment.id === entry.attachment.id))
        ].slice(0, 10));
        setError(errorText(sendError));
      } finally {
        if (!ownsSendSurface()) return;
        setSendingCount((current) => Math.max(0, current - 1));
        const remaining = Math.max(0, (pendingSendCountsRef.current.get(sendConversationId) ?? 1) - 1);
        if (remaining) pendingSendCountsRef.current.set(sendConversationId, remaining);
        else {
          pendingSendCountsRef.current.delete(sendConversationId);
          restoreFailedSends(sendConversationId);
        }
      }
    };
    void enqueueConversationSend(sendRequestQueuesRef.current, sendConversationId, performSend);
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadConversationId = selectedConversationId;
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 10 - pendingAttachments.length));
    event.target.value = "";
    if (!uploadConversationId || !files.length || conversation?.status === "removed" || conversation?.blockedByViewer) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map(async (file) => {
        const contentType = inferAttachmentContentType(file.name, file.type);
        const previewMetadata = await buildPostAttachmentMetadata(file, contentType);
        return {
          attachment: await uploadConfirmedAttachment({
            actorHandle: actor.handle,
            file,
            idempotencyKey: createClientMutationId("message-attachment"),
            metadata: { ...previewMetadata, surface: "message" },
            ownerType: "message"
          }),
          previewUrl: URL.createObjectURL(file)
        };
      }));
      const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (!mountedRef.current || selectedRef.current !== uploadConversationId) {
        for (const attachment of uploaded) void discardPendingAttachment(attachment, actor.handle);
      } else {
        setPendingAttachments((current) => [
          ...current,
          ...uploaded
        ].slice(0, 10));
      }
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length && selectedRef.current === uploadConversationId) {
        const firstError = failures[0] as PromiseRejectedResult;
        setError(failures.length === 1 ? errorText(firstError.reason) : `${failures.length} attachments could not be uploaded. ${errorText(firstError.reason)}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const updateMessage = (incoming: MessageContract) => {
    markMessageProjectionChanged(incoming.conversationId);
    markConversationProjectionChanged(incoming.conversationId);
    setMessages((current) => mergeCanonicalMessage(current, incoming));
    setSearchResults((current) => current ? reconcileDiscoveryMessage(current, incoming) : current);
    setMediaResults((current) => reconcileDiscoveryMessage(current, incoming));
    const updateSummary = (current: ConversationSummaryContract) => current.lastMessage?.id === incoming.id
      ? { ...current, lastMessage: { ...incoming, starred: incoming.deletedAt ? false : current.lastMessage.starred } }
      : current;
    setConversation((current) => current?.id === incoming.conversationId ? updateSummary(current) : current);
    setConversations((current) => current.map((entry) => entry.id === incoming.conversationId ? updateSummary(entry) : entry));
  };

  const star = async (message: MessageContract) => {
    try {
      await symposiumApi.request(`/api/conversations/${message.conversationId}/messages/${message.id}/star`, {
        method: "POST", body: { actorHandle: actor.handle, active: !message.starred }
      });
      markMessageProjectionChanged(message.conversationId);
      markConversationProjectionChanged(message.conversationId);
      const active = !message.starred;
      const updateStar = (entry: MessageContract) => entry.id === message.id ? { ...entry, starred: active } : entry;
      setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, starred: !message.starred } : entry));
      setSearchResults((current) => current?.map(updateStar) ?? current);
      setMediaResults((current) => mediaKindRef.current === "starred" && !active
        ? current.filter((entry) => entry.id !== message.id)
        : current.map(updateStar));
      setConversation((current) => current?.lastMessage?.id === message.id
        ? { ...current, lastMessage: updateStar(current.lastMessage) }
        : current);
      setConversations((current) => current.map((entry) => entry.lastMessage?.id === message.id
        ? { ...entry, lastMessage: updateStar(entry.lastMessage) }
        : entry));
      if (mediaKindRef.current === "starred") refreshDiscoveryRef.current();
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const edit = async (message: MessageContract, body: string) => {
    if (!body || body === message.body) return true;
    try {
      const data = await symposiumApi.request<{ message: MessageContract }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
        method: "PATCH", body: { actorHandle: actor.handle, body, expectedRevision: message.revision }
      });
      updateMessage(data.message);
      return true;
    } catch (actionError) {
      setError(errorText(actionError));
      return false;
    }
  };

  const removeMessage = async (message: MessageContract, mode: "self" | "everyone") => {
    if (!window.confirm(mode === "everyone" ? "Unsend this message for everyone?" : "Delete this message for you?")) return;
    try {
      const data = await symposiumApi.request<{ message?: MessageContract }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
        method: "DELETE", body: { actorHandle: actor.handle, mode, expectedRevision: mode === "everyone" ? message.revision : undefined }
      });
      if (mode === "self") {
        markMessageProjectionChanged(message.conversationId);
        markConversationProjectionChanged(message.conversationId);
        locallyHiddenMessageIdsRef.current.add(message.id);
        setMessages((current) => current.filter((entry) => entry.id !== message.id));
        setSearchResults((current) => current?.filter((entry) => entry.id !== message.id) ?? current);
        setMediaResults((current) => current.filter((entry) => entry.id !== message.id));
        void loadConversationSummary(message.conversationId);
      }
      else updateMessage(data.message ?? { ...message, body: "", attachments: [], deletedAt: new Date().toISOString(), revision: message.revision + 1 });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const changePreference = async (preference: { muted?: boolean; pinned?: boolean }) => {
    if (!conversation) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/preferences`, {
        method: "PATCH", body: { actorHandle: actor.handle, ...preference }
      });
      const updated = { ...conversation, ...preference };
      markConversationProjectionChanged(conversation.id);
      setConversation(updated);
      setConversations((current) => current
        .map((entry) => entry.id === updated.id ? updated : entry)
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt)));
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const clearChat = async () => {
    if (!conversation || !window.confirm("Clear all of this chat's current messages and attachments for you? This cannot be undone.")) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/clear`, { method: "POST", body: { actorHandle: actor.handle } });
      markMessageProjectionChanged(conversation.id);
      markConversationProjectionChanged(conversation.id);
      setMessages([]);
      setHistoryContextMessageId(null);
      applyDraftAction({ type: "clear", conversationId: conversation.id });
      removeLocalDraft(actor.handle, conversation.id);
      await loadConversations(false);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const deleteChat = async () => {
    if (!conversation || !window.confirm("Delete this chat for you? It will stay hidden until you deliberately start a new connection.")) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}`, { method: "DELETE", body: { actorHandle: actor.handle } });
      conversationListEpochRef.current += 1;
      markConversationProjectionChanged(conversation.id);
      markMessageProjectionChanged(conversation.id);
      removeLocalDraft(actor.handle, conversation.id);
      setConversations((current) => current.filter((entry) => entry.id !== conversation.id));
      selectConversation(null);
      await loadConversations(false);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const currentPeer = conversationIdentityParticipant(conversation, actor.handle, profiles);
  const syntheticHandle = selectedConversationId && !messageIdPattern.test(selectedConversationId)
    ? cleanHandle(selectedConversationId.replace(/^direct:/, ""))
    : null;
  const syntheticProfile = syntheticHandle ? profiles[syntheticHandle] : undefined;
  const selectedTitle = conversation
    ? conversation.kind === "direct" ? currentPeer?.name ?? conversationName(conversation, actor.handle) : conversationName(conversation, actor.handle)
    : syntheticProfile?.name ?? (conversationLoading ? "Loading conversation…" : "Conversation unavailable");

  const blockPeer = async () => {
    const target = currentPeer?.handle ?? syntheticHandle;
    if (!target) return;
    const active = !conversation?.blockedByViewer;
    if (active && !window.confirm(`Block ${currentPeer?.name ?? target}? They will not be able to message you directly or add you to groups. Messages in groups you already share will remain visible.`)) return;
    try {
      await symposiumApi.request("/api/blocks", { method: "POST", body: { actorHandle: actor.handle, targetHandle: target, active } });
      if (conversation) setConversation({ ...conversation, blockedByViewer: active });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const searchChat = async (append = false) => {
    if (!conversation || !searchQuery.trim()) {
      setSearchResults(null);
      setSearchCursor(null);
      return;
    }
    const conversationId = conversation.id;
    const requestEpoch = searchLoadEpochRef.current + 1;
    searchLoadEpochRef.current = requestEpoch;
    setSearchLoading(true);
    try {
      const parameters = new URLSearchParams({ query: searchQuery.trim(), limit: "24" });
      if (append && searchCursor) parameters.set("cursor", searchCursor);
      const result = await symposiumApi.request<{ messages: MessageContract[]; nextCursor: string | null }>(withActor(`/api/conversations/${conversationId}/search?${parameters}`, actor.handle), { cache: "no-store" });
      if (requestEpoch !== searchLoadEpochRef.current || selectedRef.current !== conversationId) return;
      setSearchResults((current) => append && current
        ? [...current, ...result.messages.filter((message) => !current.some((entry) => entry.id === message.id))]
        : result.messages);
      setSearchCursor(result.nextCursor);
    } catch (actionError) { setError(errorText(actionError)); }
    finally {
      if (requestEpoch === searchLoadEpochRef.current) setSearchLoading(false);
    }
  };

  const loadMedia = async (kind: MessageMediaKind, append = false) => {
    if (!conversation) return;
    const conversationId = conversation.id;
    const requestEpoch = mediaLoadEpochRef.current + 1;
    mediaLoadEpochRef.current = requestEpoch;
    setMediaKind(kind);
    setMediaLoading(true);
    if (!append) {
      setMediaResults([]);
      setMediaCursor(null);
    }
    try {
      const cursor = append && mediaKind === kind ? mediaCursor : null;
      const parameters = new URLSearchParams({ limit: "24" });
      if (cursor) parameters.set("cursor", cursor);
      const endpoint = kind === "starred"
        ? `/api/conversations/${conversationId}/starred?${parameters.toString()}`
        : `/api/conversations/${conversationId}/search?kind=${encodeURIComponent(kind)}&${parameters.toString()}`;
      const result = await symposiumApi.request<{ messages: MessageContract[]; nextCursor: string | null }>(withActor(endpoint, actor.handle), { cache: "no-store" });
      if (requestEpoch !== mediaLoadEpochRef.current || selectedRef.current !== conversationId) return;
      setMediaResults((current) => append
        ? [...current, ...result.messages.filter((message) => !current.some((entry) => entry.id === message.id))]
        : result.messages);
      setMediaCursor(result.nextCursor);
    } catch (actionError) { setError(errorText(actionError)); }
    finally {
      if (requestEpoch === mediaLoadEpochRef.current) setMediaLoading(false);
    }
  };
  refreshDiscoveryRef.current = () => {
    if (searchResultsRef.current && searchQuery.trim()) void searchChat(false);
    const activeMediaKind = mediaKindRef.current;
    if (activeMediaKind) void loadMedia(activeMediaKind, false);
  };

  const addPeople = async (handles: string[]) => {
    if (!conversation || conversation.kind !== "group" || !handles.length) return false;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/participants`, {
        method: "POST",
        body: { actorHandle: actor.handle, handles }
      });
      await loadConversation(conversation.id, { quiet: true });
      return true;
    } catch (actionError) {
      setError(errorText(actionError));
      return false;
    }
  };

  const openMessageAttachmentPreview = (message: MessageContract, attachmentId: string) => {
    setAttachmentPreview({
      attachmentId,
      attachments: messagePreviewAttachments(message.attachments, actor.handle),
      contextTitle: "Message attachments"
    });
  };

  const updateParticipantRole = async (handle: string, role: "owner" | "admin" | "member") => {
    if (!conversation) return;
    if (role === "owner" && !window.confirm(`Transfer ownership of ${conversationName(conversation, actor.handle)} to ${handle}? You will remain an administrator.`)) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/participants/${encodeURIComponent(handle)}`, {
        method: "PATCH", body: { actorHandle: actor.handle, role }
      });
      await loadConversation(conversation.id, { quiet: true });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const removeParticipant = async (handle: string, name: string) => {
    if (!conversation || !window.confirm(`Remove ${name} from this group? They will retain earlier history but receive no later messages.`)) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/participants/${encodeURIComponent(handle)}`, {
        method: "DELETE", body: { actorHandle: actor.handle }
      });
      setConversation((current) => current?.id === conversation.id ? withoutConversationParticipant(current, handle) : current);
      setConversations((current) => current.map((entry) => entry.id === conversation.id ? withoutConversationParticipant(entry, handle) : entry));
      await loadConversation(conversation.id, { quiet: true });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const leaveGroup = async () => {
    if (!conversation || conversation.kind !== "group" || conversation.role === "owner") return;
    if (!window.confirm(`Leave ${conversationName(conversation, actor.handle)}? You will need to be added again to rejoin.`)) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/leave`, {
        method: "POST",
        body: { actorHandle: actor.handle }
      });
      removeLocalDraft(actor.handle, conversation.id);
      selectConversation(null);
      await loadConversations(false);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const compactConversations = quick ? conversations.slice(0, selectedConversationId ? 5 : 8) : conversations;
  const activeParticipants = activeConversationParticipants(conversation?.participants ?? [])
    .map((participant) => currentConversationParticipant(participant, profiles));
  const sharedResultCount = mediaKind ? messageMediaResultCount(mediaResults, mediaKind) : 0;
  const jumpToMessage = async (messageId: string) => {
    setInfoTab("info");
    const scrollToTarget = () => document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (document.querySelector(`[data-message-id="${messageId}"]`)) {
      window.requestAnimationFrame(scrollToTarget);
      return;
    }
    if (!conversation) return;
    const conversationId = conversation.id;
    const visibleMessageIdsAtStart = new Set(messagesRef.current.map((message) => message.id));
    shouldStickToBottomRef.current = false;
    setConversationLoading(true);
    const loadContext = async (attempt: number): Promise<void> => {
      const requestEpoch = conversationLoadEpochRef.current + 1;
      conversationLoadEpochRef.current = requestEpoch;
      const projectionEpoch = messageProjectionEpochByConversationRef.current.get(conversationId) ?? 0;
      try {
        const page = await symposiumApi.request<MessagePageContract>(
          withActor(`/api/conversations/${conversationId}/messages/${messageId}/context`, actor.handle),
          { cache: "no-store" }
        );
        if (requestEpoch !== conversationLoadEpochRef.current || selectedRef.current !== conversationId) return;
        const latestProjectionEpoch = messageProjectionEpochByConversationRef.current.get(conversationId) ?? 0;
        if (projectionEpoch !== latestProjectionEpoch && attempt < 2) {
          await loadContext(attempt + 1);
          return;
        }
        const canonicalPage = projectionEpoch === latestProjectionEpoch
          ? page.messages
          : messagesRef.current.reduce((current, message) => {
              const belongsToRequestedContext = current.some((entry) => entry.id === message.id);
              const arrivedDuringRequest = !visibleMessageIdsAtStart.has(message.id);
              return belongsToRequestedContext || arrivedDuringRequest
                ? mergeCanonicalMessagePage(current, [message])
                : current;
            }, page.messages);
        setConversation(page.conversation);
        setMessages(canonicalPage);
        setMessageCursor(page.nextCursor);
        setHistoryContextMessageId(messageId);
        window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToTarget));
      } catch (actionError) {
        if (requestEpoch === conversationLoadEpochRef.current) setError(errorText(actionError));
      }
    };
    try {
      await loadContext(0);
    } finally {
      if (selectedRef.current === conversationId) setConversationLoading(false);
    }
  };

  return (
    <section className={`messaging-experience ${quick ? "quick" : "full"}`} aria-label={quick ? "Quick messages" : "Messages"}>
      <aside className="messages-conversations-panel">
        <header>
          <span><MessageCircle size={18} /><strong>Messages</strong></span>
          <span>
            <button type="button" title="New chat or group" onClick={() => setNewConversationOpen((open) => !open)}><Plus size={17} /></button>
            {quick && onClose ? <button type="button" title="Close messages" onClick={onClose}><X size={17} /></button> : null}
          </span>
        </header>
        {newConversationOpen ? (
          <NewConversationPanel actorHandle={actor.handle} profiles={profiles} onClose={() => setNewConversationOpen(false)} onDirect={(handle) => selectConversation(`direct:${cleanHandle(handle)}`)} onGroup={createGroup} />
        ) : null}
        <div className="conversation-list" aria-busy={conversationListLoading}>
          {compactConversations.map((entry) => (
            <ConversationListItem key={entry.id} active={selectedConversationId === entry.id} actorHandle={actor.handle} conversation={entry} profiles={profiles} onSelect={() => selectConversation(entry.id)} />
          ))}
          {!conversationListLoading && !compactConversations.length ? <p className="messages-empty-list">No chats yet. Start one from a profile or the + button.</p> : null}
          {conversationListLoading ? <LoaderCircle className="spin messages-list-loader" size={18} /> : null}
          <div ref={conversationSentinelRef} className="conversation-scroll-sentinel" />
        </div>
        {quick && onOpenFull ? (
          <button className="open-full-messages" type="button" onClick={() => onOpenFull(selectedConversationId)}>
            Open full messages <ExternalLink size={14} />
          </button>
        ) : null}
      </aside>

      {selectedConversationId ? (
        <main className="messages-thread-panel">
          <header>
            <button type="button" className="message-thread-identity" onClick={() => {
              const handle = currentPeer?.handle ?? syntheticHandle;
              if (handle) onOpenProfile(handle);
            }}>
              <Avatar person={currentPeer ?? syntheticProfile} name={selectedTitle} group={conversation?.kind === "group"} />
              <span><strong>{selectedTitle}</strong><small>{conversation?.kind === "group" ? `${activeParticipants.length} people` : currentPeer?.handle ?? syntheticHandle ?? (conversationLoading ? "Syncing chat…" : "")}</small></span>
            </button>
            {quick && onOpenFull ? <button type="button" title="Open full messages" onClick={() => onOpenFull(selectedConversationId)}><ExternalLink size={16} /></button> : null}
          </header>
          <div
            className="message-history"
            ref={historyRef}
            aria-live="polite"
            aria-busy={conversationLoading}
            onScroll={(event) => {
              const target = event.currentTarget;
              shouldStickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 90;
              if (shouldStickToBottomRef.current) flushReadReceiptRef.current();
            }}
          >
            {historyContextMessageId ? (
              <button
                className="return-to-latest-messages"
                type="button"
                disabled={conversationLoading}
                onClick={() => {
                  if (!selectedConversationId) return;
                  shouldStickToBottomRef.current = true;
                  void loadConversation(selectedConversationId);
                }}
              >
                <ArrowDown size={13} />
                {conversationLoading ? "Returning…" : "Return to latest"}
              </button>
            ) : null}
            {messageCursor ? <button className="load-older-messages" type="button" disabled={loadingOlder} onClick={() => selectedConversationId && void loadConversation(selectedConversationId, { older: true })}>{loadingOlder ? "Loading…" : "Load older messages"}</button> : null}
            {conversationLoading && !messages.length ? <div className="message-thread-loading"><LoaderCircle className="spin" size={22} /><span>Syncing this chat…</span></div> : null}
            {!conversationLoading && !messages.length ? <div className="empty-message-thread"><MessageCircle size={30} /><strong>{syntheticProfile ? `Start a conversation with ${syntheticProfile.name}` : "No messages here yet"}</strong><p>Messages and attachments will appear here.</p></div> : null}
            {messages.map((message) => {
              const sender = messageSenderProfile(message, conversation?.participants ?? [], profiles);
              return (
                <MessageBubble
                  key={message.id}
                  actorHandle={actor.handle}
                  message={message}
                  sender={sender}
                  showSenderIdentity={conversation?.kind === "group"}
                  onEdit={edit}
                  onDelete={removeMessage}
                  onStar={star}
                  onPreviewAttachment={openMessageAttachmentPreview}
                />
              );
            })}
          </div>
          <div className={`message-composer${pendingAttachments.length ? " has-attachments" : ""}${draftSyncState !== "idle" || draftState.recovery ? " has-status" : ""}`}>
            {pendingAttachments.length ? (
              <div className="message-composer-attachments" role="list" aria-label="Attachments ready to send">
                {pendingAttachments.map((entry) => {
                  const attachment = entry.attachment;
                  return (
                    <div className="message-composer-attachment" role="listitem" key={attachment.id}>
                      <button
                        className="message-composer-attachment-preview"
                        type="button"
                        title={`Preview ${attachment.fileName}`}
                        onClick={() => setAttachmentPreview({
                          attachmentId: attachment.id,
                          attachments: pendingPreviewAttachments(pendingAttachments),
                          contextTitle: "Message attachments"
                        })}
                      >
                        {attachment.kind === "image"
                          ? <img src={entry.previewUrl} alt="" />
                          : <span className={`message-composer-file-kind kind-${attachment.kind}`}><File size={18} /><small>{attachment.kind}</small></span>}
                        <span className="message-composer-attachment-copy">
                          <strong><CompactAttachmentFileName fileName={attachment.fileName} /></strong>
                          <small>{formatAttachmentBytes(attachment.byteSize)}</small>
                        </span>
                      </button>
                      <button
                        className="message-composer-attachment-remove"
                        type="button"
                        title={`Remove ${attachment.fileName}`}
                        onClick={() => {
                          void discardPendingAttachment(entry, actor.handle);
                          setPendingAttachments((current) => current.filter((candidate) => candidate.attachment.id !== attachment.id));
                          if (attachmentPreview?.attachmentId === attachment.id) setAttachmentPreview(null);
                        }}
                      ><X size={13} /></button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <label className="message-attach-button" title="Attach files">
              {uploading ? <LoaderCircle className="spin" size={18} /> : <Paperclip size={18} />}
              <input type="file" multiple disabled={uploading || pendingAttachments.length >= 10 || conversation?.status === "removed" || conversation?.blockedByViewer} onChange={uploadFiles} />
            </label>
            <textarea
              ref={textareaRef}
              rows={1}
              maxLength={8000}
              value={draft}
              placeholder={conversation?.status === "removed" ? "You are no longer in this group" : conversation?.blockedByViewer ? "Unblock this person to send a message" : "Write a message"}
              disabled={conversation?.status === "removed" || conversation?.blockedByViewer}
              onChange={(event) => {
                if (!selectedConversationId) return;
                const body = event.target.value;
                const next = applyDraftAction({
                  type: "edit",
                  conversationId: selectedConversationId,
                  body,
                  clientVersion: createMessageDraftClientVersion(),
                  updatedAt: new Date().toISOString()
                });
                setDraftSyncState(next.dirty ? "local" : "idle");
              }}
              onBlur={() => {
                const current = draftStateRef.current;
                if (current.conversationId && current.dirty) {
                  if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
                  draftSaveTimerRef.current = null;
                  if (current.clientVersion) {
                    void persistDraft(current.conversationId, current.body, current.serverRevision, current.clientVersion);
                  }
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendCurrent();
                }
              }}
            />
            {draftSyncState !== "idle" || draftState.recovery ? (
              <div className="message-draft-status" aria-live="polite">
                {draftSyncState !== "idle" ? (
                  <small className={`message-draft-sync ${draftSyncState}`}>
                    {draftSyncState === "saving"
                      ? "Saving draft…"
                      : draftSyncState === "saved"
                        ? "Draft saved"
                        : draftStorageState === "memory-only"
                          ? "Held in this tab · cloud sync pending"
                          : "Saved on this device · cloud sync pending"}
                  </small>
                ) : null}
                {draftState.recovery ? (
                  <small className="message-draft-recovery">
                    Newer cloud draft loaded.
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedConversationId) return;
                        const next = applyDraftAction({
                          type: "restore",
                          conversationId: selectedConversationId,
                          clientVersion: createMessageDraftClientVersion(),
                          updatedAt: new Date().toISOString()
                        });
                        setDraftSyncState(next.dirty ? "local" : "idle");
                        textareaRef.current?.focus();
                      }}
                    >Restore this device’s draft</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedConversationId) return;
                        applyDraftAction({ type: "discard-recovery", conversationId: selectedConversationId });
                      }}
                    >Dismiss</button>
                  </small>
                ) : null}
              </div>
            ) : null}
            <button className="send-message-button" type="button" title={sendingCount ? "Send another message" : "Send"} disabled={uploading || conversation?.status === "removed" || conversation?.blockedByViewer || (!draft.trim() && !pendingAttachments.length)} onClick={() => void sendCurrent()}>
              {sendingCount ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </main>
      ) : (
        <main className="messages-no-selection"><MessageCircle size={36} /><strong>Select a chat</strong><p>Choose a conversation or start a new one.</p></main>
      )}

      {!quick && selectedConversationId ? (
        <aside className="messages-info-panel">
          <header>
            <Avatar person={currentPeer ?? syntheticProfile} name={selectedTitle} size="large" group={conversation?.kind === "group"} />
            <strong>{selectedTitle}</strong>
            <small>{conversation?.kind === "group" ? `${activeParticipants.length} people · Private group` : currentPeer?.handle ?? syntheticHandle ?? (conversationLoading ? "Syncing chat…" : "")}</small>
          </header>
          {conversation ? (
            <>
              <nav className="message-info-tabs" role="tablist" aria-label="Chat details">
                <button type="button" role="tab" aria-selected={infoTab === "info"} className={infoTab === "info" ? "active" : ""} onClick={() => setInfoTab("info")}><Info size={14} />Info</button>
                {conversation.kind === "group" ? <button type="button" role="tab" aria-selected={infoTab === "people"} className={infoTab === "people" ? "active" : ""} onClick={() => setInfoTab("people")}><Users size={14} />People</button> : null}
                <button type="button" role="tab" aria-selected={infoTab === "shared"} className={infoTab === "shared" ? "active" : ""} onClick={() => { setInfoTab("shared"); if (!mediaKind) void loadMedia("image"); }}><File size={14} />Shared</button>
              </nav>
              <div className="message-info-tab-content">
                {infoTab === "info" ? (
                  <section className="message-info-tab-panel" role="tabpanel">
                    {conversation.kind === "direct" && currentPeer && profiles[cleanHandle(currentPeer.handle)]?.bio ? <p className="message-peer-bio">{profiles[cleanHandle(currentPeer.handle)]?.bio}</p> : null}
                    <form className="message-search-chat" onSubmit={(event) => { event.preventDefault(); void searchChat(); }}>
                      <Search size={14} /><input value={searchQuery} placeholder="Search this chat" onChange={(event) => { searchLoadEpochRef.current += 1; setSearchLoading(false); setSearchQuery(event.target.value); setSearchResults(null); setSearchCursor(null); }} /><button type="submit" disabled={searchLoading}>{searchLoading ? "Searching…" : "Search"}</button>
                    </form>
                    {searchResults ? (
                      <div className="message-info-results"><strong>{searchResults.length} result{searchResults.length === 1 ? "" : "s"} loaded</strong>{searchResults.map((entry) => <button type="button" key={entry.id} onClick={() => void jumpToMessage(entry.id)}>{entry.body || "Attachment"}<small>{displayTime(entry.createdAt)}</small></button>)}{searchCursor ? <button className="message-media-more" type="button" disabled={searchLoading} onClick={() => void searchChat(true)}>{searchLoading ? "Loading…" : "Load more results"}</button> : null}</div>
                    ) : null}
                    <div className="message-info-actions">
                      <button type="button" onClick={() => void changePreference({ pinned: !conversation.pinned })}>{conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />}{conversation.pinned ? "Unpin chat" : "Pin chat"}</button>
                      <button type="button" title="Muted chats remain unread in Messages but do not contribute to the top unread badge" onClick={() => void changePreference({ muted: !conversation.muted })}>{conversation.muted ? <BellRing size={15} /> : <BellOff size={15} />}{conversation.muted ? "Unmute notifications" : "Mute notifications"}</button>
                      {conversation.kind === "group" ? <button type="button" onClick={() => setInfoTab("people")}><Users size={15} />View {activeParticipants.length} people</button> : null}
                    </div>
                    <div className="message-danger-actions">
                      <button type="button" onClick={() => void clearChat()}><ArchiveX size={15} />Clear chat</button>
                      {conversation.kind === "group" && conversation.status === "active" && conversation.role !== "owner"
                        ? <button type="button" onClick={() => void leaveGroup()}><LogOut size={15} />Leave group</button>
                        : conversation.kind !== "group" || conversation.status !== "active"
                          ? <button type="button" onClick={() => void deleteChat()}><Trash2 size={15} />Delete chat</button>
                          : null}
                      {conversation.kind === "direct" ? <button type="button" onClick={() => void blockPeer()}><Ban size={15} />{conversation.blockedByViewer ? "Unblock user" : "Block user"}</button> : null}
                      {conversation.kind === "group" && conversation.status === "active" && conversation.role === "owner"
                        ? <small>Transfer ownership from the People tab before leaving this group.</small>
                        : null}
                    </div>
                  </section>
                ) : null}
                {infoTab === "people" && conversation.kind === "group" ? (
                  <section className="message-people-tab-panel" role="tabpanel">
                    <header>
                      <span><strong>People</strong><small>{activeParticipants.length} active</small></span>
                      {["owner", "admin"].includes(conversation.role) ? <button type="button" onClick={() => setAddPeopleOpen(true)}><UserPlus size={14} />Add people</button> : null}
                    </header>
                    <div className="message-participants">
                      {activeParticipants.map((participant) => {
                        const ownParticipant = cleanHandle(participant.handle) === cleanHandle(actor.handle);
                        const canRemove = !ownParticipant && participant.role !== "owner" && (
                          conversation.role === "owner" || (conversation.role === "admin" && participant.role === "member")
                        ) && participant.status === "active";
                        return (
                          <div className="message-participant-row" key={participant.handle}>
                            <button type="button" onClick={() => onOpenProfile(participant.handle)}>
                              <Avatar person={participant} name={participant.name} />
                              <span>{participant.name}<small>{participant.role}</small></span>
                            </button>
                            {conversation.role === "owner" && !ownParticipant && participant.role !== "owner" && participant.status === "active" ? (
                              <select value={participant.role} aria-label={`Role for ${participant.name}`} onChange={(event) => void updateParticipantRole(participant.handle, event.target.value as "owner" | "admin" | "member")}>
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                                <option value="owner">Transfer ownership</option>
                              </select>
                            ) : null}
                            {canRemove ? <button className="remove-message-participant" type="button" title={`Remove ${participant.name}`} onClick={() => void removeParticipant(participant.handle, participant.name)}><X size={13} /></button> : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {infoTab === "shared" ? (
                  <section className="message-shared-tab-panel" role="tabpanel">
                    <header><span><strong>Shared in this chat</strong><small>{mediaKind ? `${sharedResultCount} loaded` : "Choose a type"}</small></span></header>
                    <div className="message-media-filters">{mediaKinds.map((kind) => <button type="button" className={mediaKind === kind.id ? "active" : ""} key={kind.id} onClick={() => void loadMedia(kind.id)}>{kind.icon}<span>{kind.label}</span></button>)}</div>
                    <div className="message-media-results" aria-busy={mediaLoading}>
                      {mediaKind ? <SharedMessageResults actorHandle={actor.handle} kind={mediaKind} messages={mediaResults} onPreviewAttachment={openMessageAttachmentPreview} onJumpToMessage={jumpToMessage} /> : null}
                      {mediaLoading && !mediaResults.length ? <p className="message-media-loading"><LoaderCircle className="spin" size={17} />Loading shared items…</p> : null}
                      {!mediaLoading && mediaKind && !sharedResultCount ? <p>Nothing shared here yet.</p> : null}
                      {mediaCursor && !mediaLoading && mediaKind ? <button className="message-media-more" type="button" onClick={() => void loadMedia(mediaKind, true)}>Load more</button> : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>
      ) : null}
      {error ? <div className="messaging-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={14} /></button></div> : null}
      {addPeopleOpen && conversation?.kind === "group" ? (
        <AddPeopleDialog
          actorHandle={actor.handle}
          profiles={profiles}
          participants={conversation.participants}
          onClose={() => setAddPeopleOpen(false)}
          onAdd={addPeople}
        />
      ) : null}
      {attachmentPreview ? (
        <AttachmentPreviewModal
          attachments={attachmentPreview.attachments}
          contextTitle={attachmentPreview.contextTitle}
          attachmentId={attachmentPreview.attachmentId}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
    </section>
  );
}

export function MessagesStage(props: Omit<MessagingExperienceProps, "quick" | "onClose" | "onOpenFull">) {
  return <MessagingExperience {...props} />;
}

export function MessagesQuickAccess(props: Omit<MessagingExperienceProps, "quick">) {
  return (
    <div className="modal-backdrop messages-backdrop" role="presentation" onClick={props.onClose}>
      <div className="messages-quick-shell" onClick={(event) => event.stopPropagation()}>
        <MessagingExperience {...props} quick />
      </div>
    </div>
  );
}
