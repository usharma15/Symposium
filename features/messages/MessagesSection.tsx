"use client";

import {
  ArchiveX,
  BellOff,
  BellRing,
  Ban,
  Check,
  ExternalLink,
  File,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  MessageCircle,
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
  AttachmentKindContract,
  ConversationPageContract,
  ConversationSummaryContract,
  InquiryAttachmentContract,
  MessageContract,
  MessagePageContract
} from "@/packages/contracts/src";
import type { ResearchProfile } from "@/lib/mockData";
import { formatAttachmentBytes } from "@/lib/attachmentRules";
import { cleanHandle } from "@/lib/symposiumCore";
import { profileInitials } from "@/features/identity/profilePresentation";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import {
  emptyMessageDraftState,
  reduceMessageDraft,
  type MessageDraftState
} from "@/features/messages/messageDraftState";
import {
  canonicalMessageFromLiveEvent,
  liveEventConversationId,
  mergeCanonicalMessage,
  messagingEventRequiresRefresh,
  type MessagingLiveEvent
} from "@/features/messages/messageLiveState";

const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyMessagingLiveEvents: MessagingLiveEvent[] = [];
const mediaKinds: Array<{ id: AttachmentKindContract | "links" | "starred"; label: string; icon: ReactNode }> = [
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

const errorText = (error: unknown) => error instanceof Error ? error.message : "Messaging could not sync.";
const messagingLiveEventKey = (event: MessagingLiveEvent) =>
  event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}:${event.createdAt ?? "unknown"}`;

type PendingMessageAttachment = {
  attachment: InquiryAttachmentContract;
  previewUrl: string;
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

function Avatar({ person, name, size = "small" }: { person?: { avatarUrl?: string; name: string }; name: string; size?: "small" | "large" }) {
  return (
    <span className={`avatar ${size} messaging-avatar`} aria-hidden="true">
      {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : profileInitials(name)}
    </span>
  );
}

function AttachmentTile({ attachment, actorHandle }: { attachment: InquiryAttachmentContract; actorHandle: string }) {
  const url = messageAttachmentUrl(attachment, actorHandle);
  if (attachment.kind === "image") {
    return (
      <a className="message-attachment message-attachment-image" href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={attachment.fileName} />
        <span>{attachment.fileName}</span>
      </a>
    );
  }
  if (attachment.kind === "video") {
    return (
      <a className="message-attachment" href={url} target="_blank" rel="noreferrer">
        <ImageIcon size={17} />
        <span>{attachment.fileName}</span>
        <ExternalLink size={13} />
      </a>
    );
  }
  return (
    <a className="message-attachment" href={url} target="_blank" rel="noreferrer">
      <File size={17} />
      <span>{attachment.fileName}</span>
      <ExternalLink size={13} />
    </a>
  );
}

function MessageBubble({
  actorHandle,
  message,
  profiles,
  onEdit,
  onDelete,
  onStar
}: {
  actorHandle: string;
  message: MessageContract;
  profiles: Record<string, ResearchProfile>;
  onEdit: (message: MessageContract) => void;
  onDelete: (message: MessageContract, mode: "self" | "everyone") => void;
  onStar: (message: MessageContract) => void;
}) {
  const own = message.senderHandle ? cleanHandle(message.senderHandle) === cleanHandle(actorHandle) : false;
  const sender = message.senderHandle ? profiles[cleanHandle(message.senderHandle)] : undefined;
  const withinMutationWindow = Date.now() - new Date(message.createdAt).getTime() <= 15 * 60 * 1000;
  return (
    <article className={`message-bubble-row ${own ? "own" : "received"}`} data-message-id={message.id}>
      {!own ? <Avatar person={sender} name={sender?.name ?? message.senderHandle ?? "System"} /> : null}
      <div className={`message-bubble ${message.deletedAt ? "deleted" : ""}`}>
        {message.deletedAt ? (
          <p>This message was unsent.</p>
        ) : (
          <>
            {message.body ? <p>{message.body}</p> : null}
            {message.attachments.length ? (
              <div className="message-attachments">
                {message.attachments.map((attachment) => <AttachmentTile key={attachment.id} attachment={attachment} actorHandle={actorHandle} />)}
              </div>
            ) : null}
          </>
        )}
        <footer>
          <time dateTime={message.createdAt}>{displayTime(message.createdAt)}</time>
          {message.editedAt && !message.deletedAt ? <span>Edited</span> : null}
          {message.starred ? <Star size={11} fill="currentColor" /> : null}
        </footer>
        {!message.deletedAt ? (
          <div className="message-bubble-actions" aria-label="Message actions">
            <button type="button" title={message.starred ? "Unstar" : "Star"} onClick={() => onStar(message)}>
              <Star size={13} fill={message.starred ? "currentColor" : "none"} />
            </button>
            {own && withinMutationWindow ? (
              <button type="button" title="Edit message" onClick={() => onEdit(message)}><Pencil size={13} /></button>
            ) : null}
            <button type="button" title="Delete for me" onClick={() => onDelete(message, "self")}><ArchiveX size={13} /></button>
            {own && withinMutationWindow ? (
              <button type="button" title="Unsend for everyone" onClick={() => onDelete(message, "everyone")}><Trash2 size={13} /></button>
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
  onSelect
}: {
  active: boolean;
  actorHandle: string;
  conversation: ConversationSummaryContract;
  onSelect: () => void;
}) {
  const peer = conversationPeer(conversation, actorHandle);
  const title = conversationName(conversation, actorHandle);
  const preview = conversation.draftBody
    ? `Draft: ${conversation.draftBody}`
    : conversation.lastMessage?.deletedAt
      ? "Message unsent"
      : conversation.lastMessage?.body || (conversation.lastMessage?.attachments.length ? "Shared an attachment" : conversation.status === "invited" ? "Invitation waiting" : "No messages yet");
  return (
    <button className={`conversation-list-item ${active ? "active" : ""}`} type="button" onClick={onSelect}>
      <Avatar person={peer ?? undefined} name={title} />
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
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const people = Object.values(profiles)
    .filter((person) => cleanHandle(person.handle) !== cleanHandle(actorHandle))
    .filter((person) => !query.trim() || `${person.name} ${person.handle}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 40);
  return (
    <section className="new-conversation-panel" aria-label={groupMode ? "Create group" : "Start a chat"}>
      <header>
        <button type="button" className={!groupMode ? "active" : ""} onClick={() => setGroupMode(false)}>New chat</button>
        <button type="button" className={groupMode ? "active" : ""} onClick={() => setGroupMode(true)}>New group</button>
        <button type="button" title="Close" onClick={onClose}><X size={15} /></button>
      </header>
      {groupMode ? (
        <input value={title} maxLength={120} placeholder="Group name" onChange={(event) => setTitle(event.target.value)} />
      ) : null}
      <label className="message-person-search">
        <Search size={14} />
        <input value={query} placeholder="Search people" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="new-conversation-people">
        {people.map((person) => {
          const chosen = selected.includes(person.handle);
          return (
            <button
              key={person.handle}
              type="button"
              className={chosen ? "selected" : ""}
              onClick={() => groupMode
                ? setSelected((current) => chosen ? current.filter((handle) => handle !== person.handle) : [...current, person.handle])
                : onDirect(person.handle)}
            >
              <Avatar person={person} name={person.name} />
              <span><strong>{person.name}</strong><small>{person.handle}</small></span>
              {groupMode && chosen ? <Check size={15} /> : null}
            </button>
          );
        })}
        {!people.length ? <p>No people found.</p> : null}
      </div>
      {groupMode ? (
        <button
          className="create-message-group"
          type="button"
          disabled={busy || !title.trim() || !selected.length}
          onClick={() => {
            setBusy(true);
            void onGroup(title.trim(), selected).finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Users size={15} />}
          Create private group
        </button>
      ) : null}
    </section>
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
  quick = false
}: MessagingExperienceProps) {
  const [conversations, setConversations] = useState<ConversationSummaryContract[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationSummaryContract | null>(null);
  const [messages, setMessages] = useState<MessageContract[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [draftState, dispatchDraft] = useReducer(reduceMessageDraft, emptyMessageDraftState);
  const draft = draftState.body;
  const [pendingAttachments, setPendingAttachments] = useState<PendingMessageAttachment[]>([]);
  const [sendingCount, setSendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageContract[] | null>(null);
  const [mediaKind, setMediaKind] = useState<AttachmentKindContract | "links" | "starred" | null>(null);
  const [mediaResults, setMediaResults] = useState<MessageContract[]>([]);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const conversationSentinelRef = useRef<HTMLDivElement | null>(null);
  const draftStateRef = useRef<MessageDraftState>(draftState);
  const draftSaveTimerRef = useRef<number | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const readReceiptTimerRef = useRef<number | null>(null);
  const latestReadSequenceRef = useRef(0);
  const conversationListEpochRef = useRef(0);
  const conversationLoadEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingAttachmentsRef = useRef<PendingMessageAttachment[]>(pendingAttachments);
  const conversationsRef = useRef<ConversationSummaryContract[]>(conversations);
  const messagesRef = useRef<MessageContract[]>(messages);
  const processedLiveEventKeysRef = useRef<string[]>(liveEvents.map(messagingLiveEventKey));
  const processedLiveEventKeySetRef = useRef(new Set(processedLiveEventKeysRef.current));
  const selectedRef = useRef(selectedConversationId);
  selectedRef.current = selectedConversationId;
  draftStateRef.current = draftState;
  pendingAttachmentsRef.current = pendingAttachments;
  conversationsRef.current = conversations;
  messagesRef.current = messages;

  const loadConversations = useCallback(async (append = false) => {
    const requestEpoch = append ? conversationListEpochRef.current : conversationListEpochRef.current + 1;
    if (!append) conversationListEpochRef.current = requestEpoch;
    const cursor = append ? conversationCursor : null;
    const parameters = new URLSearchParams({ limit: quick ? "8" : "24" });
    if (cursor) parameters.set("cursor", cursor);
    try {
      const page = await symposiumApi.request<ConversationPageContract>(
        withActor(`/api/conversations?${parameters.toString()}`, actor.handle),
        { cache: "no-store" }
      );
      if (requestEpoch !== conversationListEpochRef.current) return;
      setConversations((current) => append
        ? [...current, ...page.conversations.filter((entry) => !current.some((existing) => existing.id === entry.id))]
        : page.conversations);
      setConversationCursor(page.nextCursor);
      setError("");
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [actor.handle, conversationCursor, quick]);

  const loadConversation = useCallback(async (conversationId: string, options: { older?: boolean; quiet?: boolean } = {}) => {
    const requestEpoch = options.older ? conversationLoadEpochRef.current : conversationLoadEpochRef.current + 1;
    if (!options.older) conversationLoadEpochRef.current = requestEpoch;
    if (!messageIdPattern.test(conversationId)) {
      const recipientHandle = cleanHandle(conversationId.replace(/^direct:/, ""));
      const recipient = profiles[recipientHandle];
      setConversation(null);
      setMessages([]);
      setMessageCursor(null);
      if (!options.quiet) setLoading(false);
      if (!recipient) setError("This profile is not available.");
      return;
    }
    if (options.older && !messageCursor) return;
    if (options.older) setLoadingOlder(true);
    else if (!options.quiet) setLoading(true);
    const parameters = new URLSearchParams({ limit: quick ? "30" : "50" });
    if (options.older && messageCursor) parameters.set("cursor", messageCursor);
    const priorScrollHeight = options.older ? historyRef.current?.scrollHeight ?? 0 : 0;
    try {
      const page = await symposiumApi.request<MessagePageContract>(
        withActor(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${parameters.toString()}`, actor.handle),
        { cache: "no-store" }
      );
      if (requestEpoch !== conversationLoadEpochRef.current || selectedRef.current !== conversationId) return;
      setConversation(page.conversation);
      setMessages((current) => options.older
        ? [...page.messages, ...current.filter((entry) => !page.messages.some((incoming) => incoming.id === entry.id))]
        : page.messages);
      setMessageCursor(page.nextCursor);
      setConversations((current) => current.map((entry) => entry.id === page.conversation.id ? page.conversation : entry));
      if (!options.older && page.conversation.status === "active") {
        const latest = page.messages.at(-1)?.sequence ?? page.conversation.lastMessage?.sequence ?? 0;
        if (latest > 0) {
          void symposiumApi.request(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
            method: "POST",
            body: { actorHandle: actor.handle, sequence: latest }
          }).catch(() => undefined);
        }
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
      setLoading(false);
      setLoadingOlder(false);
    }
  }, [actor.handle, messageCursor, profiles, quick]);

  useEffect(() => {
    void loadConversations(false);
  }, [actor.handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleReadReceipt = useCallback((conversationId: string, sequence: number) => {
    latestReadSequenceRef.current = Math.max(latestReadSequenceRef.current, sequence);
    if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
    readReceiptTimerRef.current = window.setTimeout(() => {
      readReceiptTimerRef.current = null;
      const latestSequence = latestReadSequenceRef.current;
      latestReadSequenceRef.current = 0;
      if (selectedRef.current !== conversationId || latestSequence <= 0) return;
      void symposiumApi.request(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: "POST",
        body: { actorHandle: actor.handle, sequence: latestSequence }
      }).catch(() => undefined);
    }, 140);
  }, [actor.handle]);

  const mergeLiveMessage = useCallback((incoming: MessageContract, kind: string) => {
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
        unreadCount: selected
          ? 0
          : kind === "message.sent" && incomingFromAnotherPerson && !alreadyHadMessage
            ? current.unreadCount + 1
            : current.unreadCount,
        updatedAt: kind === "message.sent" ? incoming.createdAt : current.updatedAt
      };
    };

    setConversation((current) => current?.id === incoming.conversationId ? mergeSummary(current) : current);
    setConversations((current) => current
      .map((entry) => entry.id === incoming.conversationId ? mergeSummary(entry) : entry)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt)));
  }, [actor.handle, scheduleReadReceipt]);

  useEffect(() => {
    for (const liveEvent of liveEvents) {
      const eventKey = messagingLiveEventKey(liveEvent);
      if (processedLiveEventKeySetRef.current.has(eventKey)) continue;
      processedLiveEventKeySetRef.current.add(eventKey);
      processedLiveEventKeysRef.current.push(eventKey);
      if (processedLiveEventKeysRef.current.length > 500) {
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
        if (!knownConversation || sequenceGap) void loadConversations(false);
        if (sequenceGap && selectedRef.current === canonicalMessage.conversationId) {
          void loadConversation(canonicalMessage.conversationId, { quiet: true });
        }
        continue;
      }
      if (liveEvent.kind === "message.star.updated") {
        const messageId = liveEvent.payload?.messageId;
        const active = liveEvent.payload?.active;
        if (typeof messageId === "string" && typeof active === "boolean") {
          setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, starred: active } : entry));
        }
        continue;
      }
      if (!messagingEventRequiresRefresh(liveEvent)) continue;
      if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null;
        void loadConversations(false);
        const eventConversationId = liveEventConversationId(liveEvent);
        const activeConversationId = selectedRef.current;
        if (activeConversationId && activeConversationId === eventConversationId && messageIdPattern.test(activeConversationId)) {
          void loadConversation(activeConversationId, { quiet: true });
        }
      }, 80);
    }
    return () => {
      if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = null;
    };
  }, [liveEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const attachment of pendingAttachmentsRef.current) void discardPendingAttachment(attachment, actor.handle);
    if (!selectedConversationId) {
      setConversation(null);
      setMessages([]);
      dispatchDraft({ type: "select", conversationId: null, localBody: null, serverBody: "", serverUpdatedAt: null });
      setPendingAttachments([]);
      setPreviewAttachmentId(null);
      return;
    }
    const local = window.localStorage.getItem(localDraftKey(actor.handle, selectedConversationId));
    const summary = conversations.find((entry) => entry.id === selectedConversationId);
    dispatchDraft({
      type: "select",
      conversationId: selectedConversationId,
      localBody: local,
      serverBody: summary?.draftBody ?? "",
      serverUpdatedAt: summary?.draftUpdatedAt ?? null
    });
    setPendingAttachments([]);
    setPreviewAttachmentId(null);
    shouldStickToBottomRef.current = true;
    setSearchResults(null);
    setMediaKind(null);
    void loadConversation(selectedConversationId);
  }, [actor.handle, selectedConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedConversationId || messageIdPattern.test(selectedConversationId)) return;
    const recipientHandle = cleanHandle(selectedConversationId.replace(/^direct:/, ""));
    if (!profiles[recipientHandle]) return;
    setError((current) => current === "This profile is not available." ? "" : current);
  }, [profiles, selectedConversationId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const attachment of pendingAttachmentsRef.current) void discardPendingAttachment(attachment, actor.handle);
      if (readReceiptTimerRef.current !== null) window.clearTimeout(readReceiptTimerRef.current);
    };
  }, [actor.handle]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const summary = conversations.find((entry) => entry.id === selectedConversationId);
    if (!summary) return;
    dispatchDraft({
      type: "server",
      conversationId: selectedConversationId,
      body: summary.draftBody,
      preserveLocal: document.activeElement === textareaRef.current,
      updatedAt: summary.draftUpdatedAt
    });
  }, [conversations, selectedConversationId]);

  const persistDraft = useCallback(async (conversationId: string, body: string) => {
    if (!messageIdPattern.test(conversationId)) return;
    try {
      const saved = await symposiumApi.request<{ body: string; updatedAt: string | null }>(`/api/conversations/${encodeURIComponent(conversationId)}/draft`, {
        method: "PATCH",
        body: { actorHandle: actor.handle, body }
      });
      dispatchDraft({ type: "saved", conversationId, body: saved.body, updatedAt: saved.updatedAt });
    } catch {
      // The immediately persisted local draft remains authoritative and will retry
      // on the next edit or blur without interrupting typing.
    }
  }, [actor.handle]);

  useEffect(() => {
    if (!selectedConversationId || draftState.conversationId !== selectedConversationId) return;
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
    if (draftState.body) window.localStorage.setItem(localDraftKey(actor.handle, selectedConversationId), draftState.body);
    else window.localStorage.removeItem(localDraftKey(actor.handle, selectedConversationId));
    if (draftState.dirty && messageIdPattern.test(selectedConversationId)) {
      const body = draftState.body;
      draftSaveTimerRef.current = window.setTimeout(() => {
        draftSaveTimerRef.current = null;
        void persistDraft(selectedConversationId, body);
      }, 900);
    }
    return () => {
      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    };
  }, [actor.handle, draftState, persistDraft, selectedConversationId]);

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

  const sendCurrent = async () => {
    if (!selectedConversationId || (!draft.trim() && !pendingAttachments.length)) return;
    setSendingCount((current) => current + 1);
    shouldStickToBottomRef.current = true;
    const originalDraft = draft;
    const originalAttachments = pendingAttachments;
    const attachmentIds = pendingAttachments.map((entry) => entry.attachment.id);
    dispatchDraft({ type: "clear", conversationId: selectedConversationId });
    setPendingAttachments([]);
    setPreviewAttachmentId(null);
    window.localStorage.removeItem(localDraftKey(actor.handle, selectedConversationId));
    try {
      const directRecipient = !messageIdPattern.test(selectedConversationId)
        ? cleanHandle(selectedConversationId.replace(/^direct:/, ""))
        : undefined;
      const data = await symposiumApi.request<{ message: MessageContract }>("/api/messages", {
        method: "POST",
        idempotencyKey: createClientMutationId("message-send"),
        body: {
          actorHandle: actor.handle,
          ...(directRecipient ? { recipientHandle: directRecipient } : { conversationId: selectedConversationId }),
          body: originalDraft.trim(),
          attachmentIds
        }
      });
      if (data.message.conversationId !== selectedConversationId) selectConversation(data.message.conversationId);
      else mergeLiveMessage(data.message, "message.sent");
      for (const attachment of originalAttachments) revokePendingAttachment(attachment);
    } catch (sendError) {
      const activeDraft = draftStateRef.current;
      if (activeDraft.conversationId === selectedConversationId) {
        const bodyTypedWhileSending = activeDraft.body === originalDraft ? "" : activeDraft.body;
        const restoredBody = bodyTypedWhileSending
          ? `${originalDraft}${originalDraft ? "\n" : ""}${bodyTypedWhileSending}`
          : originalDraft;
        dispatchDraft({ type: "edit", conversationId: selectedConversationId, body: restoredBody });
        if (restoredBody) window.localStorage.setItem(localDraftKey(actor.handle, selectedConversationId), restoredBody);
      }
      setPendingAttachments((current) => [
        ...originalAttachments,
        ...current.filter((entry) => !originalAttachments.some((original) => original.attachment.id === entry.attachment.id))
      ].slice(0, 10));
      setError(errorText(sendError));
    } finally {
      setSendingCount((current) => Math.max(0, current - 1));
    }
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadConversationId = selectedConversationId;
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 10 - pendingAttachments.length));
    event.target.value = "";
    if (!uploadConversationId || !files.length) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map(async (file) => ({
        attachment: await uploadConfirmedAttachment({
          actorHandle: actor.handle,
          file,
          idempotencyKey: createClientMutationId("message-attachment"),
          metadata: { surface: "message" },
          ownerType: "message"
        }),
        previewUrl: URL.createObjectURL(file)
      })));
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

  const updateMessage = (incoming: MessageContract) =>
    setMessages((current) => mergeCanonicalMessage(current, incoming));

  const star = async (message: MessageContract) => {
    try {
      await symposiumApi.request(`/api/conversations/${message.conversationId}/messages/${message.id}/star`, {
        method: "POST", body: { actorHandle: actor.handle, active: !message.starred }
      });
      setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, starred: !message.starred } : entry));
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const edit = async (message: MessageContract) => {
    const body = window.prompt("Edit message", message.body)?.trim();
    if (!body || body === message.body) return;
    try {
      const data = await symposiumApi.request<{ message: MessageContract }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
        method: "PATCH", body: { actorHandle: actor.handle, body, expectedRevision: message.revision }
      });
      updateMessage(data.message);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const removeMessage = async (message: MessageContract, mode: "self" | "everyone") => {
    if (!window.confirm(mode === "everyone" ? "Unsend this message for everyone?" : "Delete this message for you?")) return;
    try {
      const data = await symposiumApi.request<{ message?: MessageContract }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
        method: "DELETE", body: { actorHandle: actor.handle, mode, expectedRevision: mode === "everyone" ? message.revision : undefined }
      });
      if (mode === "self") setMessages((current) => current.filter((entry) => entry.id !== message.id));
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
      setConversation(updated);
      setConversations((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const resolveInvite = async (action: "accept" | "decline") => {
    if (!conversation) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/invitation`, {
        method: "POST", body: { actorHandle: actor.handle, action }
      });
      if (action === "decline") selectConversation(null);
      await loadConversations(false);
      if (action === "accept") await loadConversation(conversation.id);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const clearChat = async () => {
    if (!conversation || !window.confirm("Clear all of this chat's current messages and attachments for you? This cannot be undone.")) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/clear`, { method: "POST", body: { actorHandle: actor.handle } });
      setMessages([]);
      dispatchDraft({ type: "clear", conversationId: conversation.id });
      window.localStorage.removeItem(localDraftKey(actor.handle, conversation.id));
      await loadConversations(false);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const deleteChat = async () => {
    if (!conversation || !window.confirm("Delete this chat for you? It will stay hidden until you deliberately start a new connection.")) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}`, { method: "DELETE", body: { actorHandle: actor.handle } });
      window.localStorage.removeItem(localDraftKey(actor.handle, conversation.id));
      selectConversation(null);
      await loadConversations(false);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const peer = conversationPeer(conversation, actor.handle);
  const syntheticHandle = selectedConversationId && !messageIdPattern.test(selectedConversationId)
    ? cleanHandle(selectedConversationId.replace(/^direct:/, ""))
    : null;
  const syntheticProfile = syntheticHandle ? profiles[syntheticHandle] : undefined;
  const selectedTitle = conversation ? conversationName(conversation, actor.handle) : syntheticProfile?.name ?? "New message";

  const blockPeer = async () => {
    const target = peer?.handle ?? syntheticHandle;
    if (!target) return;
    const active = !conversation?.blockedByViewer;
    if (active && !window.confirm(`Block ${peer?.name ?? target}? They will not be able to message or invite you.`)) return;
    try {
      await symposiumApi.request("/api/blocks", { method: "POST", body: { actorHandle: actor.handle, targetHandle: target, active } });
      if (conversation) setConversation({ ...conversation, blockedByViewer: active });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const searchChat = async () => {
    if (!conversation || !searchQuery.trim()) return setSearchResults(null);
    try {
      const parameters = new URLSearchParams({ query: searchQuery.trim(), limit: "24" });
      const result = await symposiumApi.request<{ messages: MessageContract[] }>(withActor(`/api/conversations/${conversation.id}/search?${parameters}`, actor.handle), { cache: "no-store" });
      setSearchResults(result.messages);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const loadMedia = async (kind: AttachmentKindContract | "links" | "starred") => {
    if (!conversation) return;
    setMediaKind(kind);
    try {
      const endpoint = kind === "starred"
        ? `/api/conversations/${conversation.id}/starred?limit=24`
        : `/api/conversations/${conversation.id}/search?kind=${encodeURIComponent(kind)}&limit=24`;
      const result = await symposiumApi.request<{ messages: MessageContract[] }>(withActor(endpoint, actor.handle), { cache: "no-store" });
      setMediaResults(result.messages);
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const invitePerson = async () => {
    if (!conversation || conversation.kind !== "group") return;
    const handle = window.prompt("Invite by handle")?.trim();
    if (!handle) return;
    try {
      await symposiumApi.request(`/api/conversations/${conversation.id}/invitations`, {
        method: "POST", body: { actorHandle: actor.handle, handles: [handle] }
      });
      await loadConversation(conversation.id, { quiet: true });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const updateParticipantRole = async (handle: string, role: "admin" | "member") => {
    if (!conversation) return;
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
      await loadConversation(conversation.id, { quiet: true });
    } catch (actionError) { setError(errorText(actionError)); }
  };

  const compactConversations = quick ? conversations.slice(0, selectedConversationId ? 5 : 8) : conversations;

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
        <div className="conversation-list" aria-busy={loading}>
          {compactConversations.map((entry) => (
            <ConversationListItem key={entry.id} active={selectedConversationId === entry.id} actorHandle={actor.handle} conversation={entry} onSelect={() => selectConversation(entry.id)} />
          ))}
          {!loading && !compactConversations.length ? <p className="messages-empty-list">No chats yet. Start one from a profile or the + button.</p> : null}
          {loading ? <LoaderCircle className="spin messages-list-loader" size={18} /> : null}
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
              const handle = peer?.handle ?? syntheticHandle;
              if (handle) onOpenProfile(handle);
            }}>
              <Avatar person={peer ?? syntheticProfile} name={selectedTitle} />
              <span><strong>{selectedTitle}</strong><small>{conversation?.kind === "group" ? `${conversation.participants.length} people` : peer?.handle ?? syntheticHandle}</small></span>
            </button>
            {quick && onOpenFull ? <button type="button" title="Open full messages" onClick={() => onOpenFull(selectedConversationId)}><ExternalLink size={16} /></button> : null}
          </header>
          {conversation?.status === "invited" ? (
            <div className="message-invitation-gate">
              <Users size={24} />
              <strong>You were invited to {selectedTitle}</strong>
              <p>Accept to see the existing group history and participate.</p>
              <span><button type="button" onClick={() => void resolveInvite("decline")}>Decline</button><button type="button" className="primary" onClick={() => void resolveInvite("accept")}>Accept</button></span>
            </div>
          ) : (
            <>
              <div
                className="message-history"
                ref={historyRef}
                aria-live="polite"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  shouldStickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 90;
                }}
              >
                {messageCursor ? <button className="load-older-messages" type="button" disabled={loadingOlder} onClick={() => selectedConversationId && void loadConversation(selectedConversationId, { older: true })}>{loadingOlder ? "Loading…" : "Load older messages"}</button> : null}
                {!loading && !messages.length ? <div className="empty-message-thread"><MessageCircle size={30} /><strong>{syntheticProfile ? `Start a conversation with ${syntheticProfile.name}` : "No messages here yet"}</strong><p>Messages and attachments will appear here.</p></div> : null}
                {messages.map((message) => <MessageBubble key={message.id} actorHandle={actor.handle} message={message} profiles={profiles} onEdit={edit} onDelete={removeMessage} onStar={star} />)}
              </div>
              <div className={`message-composer${pendingAttachments.length ? " has-attachments" : ""}`}>
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
                            onClick={() => setPreviewAttachmentId(attachment.id)}
                          >
                            {attachment.kind === "image"
                              ? <img src={entry.previewUrl} alt="" />
                              : <span className={`message-composer-file-kind kind-${attachment.kind}`}><File size={18} /><small>{attachment.kind}</small></span>}
                            <span className="message-composer-attachment-copy">
                              <strong>{attachment.fileName}</strong>
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
                              if (previewAttachmentId === attachment.id) setPreviewAttachmentId(null);
                            }}
                          ><X size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <label className="message-attach-button" title="Attach files">
                  {uploading ? <LoaderCircle className="spin" size={18} /> : <Paperclip size={18} />}
                  <input type="file" multiple disabled={uploading || pendingAttachments.length >= 10} onChange={uploadFiles} />
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
                    if (body) window.localStorage.setItem(localDraftKey(actor.handle, selectedConversationId), body);
                    else window.localStorage.removeItem(localDraftKey(actor.handle, selectedConversationId));
                    dispatchDraft({ type: "edit", conversationId: selectedConversationId, body });
                  }}
                  onBlur={() => {
                    const current = draftStateRef.current;
                    if (current.conversationId && current.dirty) {
                      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current);
                      draftSaveTimerRef.current = null;
                      void persistDraft(current.conversationId, current.body);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendCurrent();
                    }
                  }}
                />
                <button className="send-message-button" type="button" title={sendingCount ? "Send another message" : "Send"} disabled={uploading || (!draft.trim() && !pendingAttachments.length)} onClick={() => void sendCurrent()}>
                  {sendingCount ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
                </button>
              </div>
            </>
          )}
        </main>
      ) : (
        <main className="messages-no-selection"><MessageCircle size={36} /><strong>Select a chat</strong><p>Choose a conversation or start a new one.</p></main>
      )}

      {!quick && selectedConversationId ? (
        <aside className="messages-info-panel">
          <header>
            <Avatar person={peer ?? syntheticProfile} name={selectedTitle} size="large" />
            <strong>{selectedTitle}</strong>
            <small>{conversation?.kind === "group" ? "Private group" : peer?.handle ?? syntheticHandle}</small>
            {conversation?.kind === "direct" && peer ? <p>{profiles[peer.handle]?.bio}</p> : null}
          </header>
          {conversation ? (
            <>
              <form className="message-search-chat" onSubmit={(event) => { event.preventDefault(); void searchChat(); }}>
                <Search size={14} /><input value={searchQuery} placeholder="Search this chat" onChange={(event) => setSearchQuery(event.target.value)} /><button type="submit">Search</button>
              </form>
              {searchResults ? (
                <div className="message-info-results"><strong>{searchResults.length} result{searchResults.length === 1 ? "" : "s"}</strong>{searchResults.map((entry) => <button type="button" key={entry.id} onClick={() => document.querySelector(`[data-message-id="${entry.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{entry.body || "Attachment"}<small>{displayTime(entry.createdAt)}</small></button>)}</div>
              ) : null}
              <div className="message-info-actions">
                <button type="button" onClick={() => void changePreference({ pinned: !conversation.pinned })}>{conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />}{conversation.pinned ? "Unpin chat" : "Pin chat"}</button>
                <button type="button" onClick={() => void changePreference({ muted: !conversation.muted })}>{conversation.muted ? <BellRing size={15} /> : <BellOff size={15} />}{conversation.muted ? "Unmute notifications" : "Mute notifications"}</button>
                {conversation.kind === "group" && ["owner", "admin"].includes(conversation.role) ? <button type="button" onClick={() => void invitePerson()}><UserPlus size={15} />Invite people</button> : null}
              </div>
              {conversation.kind === "group" ? (
                <div className="message-participants">
                  <strong>People</strong>
                  {conversation.participants.map((participant) => {
                    const ownParticipant = cleanHandle(participant.handle) === cleanHandle(actor.handle);
                    const canRemove = !ownParticipant && participant.role !== "owner" && (
                      conversation.role === "owner" || (conversation.role === "admin" && participant.role === "member")
                    ) && ["active", "invited"].includes(participant.status);
                    return (
                      <div className="message-participant-row" key={participant.handle}>
                        <button type="button" onClick={() => onOpenProfile(participant.handle)}>
                          <Avatar person={participant} name={participant.name} />
                          <span>{participant.name}<small>{participant.role} · {participant.status}</small></span>
                        </button>
                        {conversation.role === "owner" && !ownParticipant && participant.role !== "owner" && participant.status === "active" ? (
                          <select value={participant.role} aria-label={`Role for ${participant.name}`} onChange={(event) => void updateParticipantRole(participant.handle, event.target.value as "admin" | "member")}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : null}
                        {canRemove ? <button className="remove-message-participant" type="button" title={`Remove ${participant.name}`} onClick={() => void removeParticipant(participant.handle, participant.name)}><X size={13} /></button> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="message-media-browser">
                <strong>Shared in this chat</strong>
                <div>{mediaKinds.map((kind) => <button type="button" className={mediaKind === kind.id ? "active" : ""} key={kind.id} onClick={() => void loadMedia(kind.id)}>{kind.icon}{kind.label}</button>)}</div>
                {mediaKind ? <div className="message-media-results">{mediaResults.flatMap((entry) => entry.attachments.length ? entry.attachments.map((attachment) => <AttachmentTile key={`${entry.id}:${attachment.id}`} attachment={attachment} actorHandle={actor.handle} />) : entry.body ? [<button type="button" key={entry.id} onClick={() => document.querySelector(`[data-message-id="${entry.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{entry.body}</button>] : [])}{!mediaResults.length ? <p>Nothing here yet.</p> : null}</div> : null}
              </div>
              <div className="message-danger-actions">
                <button type="button" onClick={() => void clearChat()}><ArchiveX size={15} />Clear chat</button>
                <button type="button" onClick={() => void deleteChat()}><Trash2 size={15} />Delete chat</button>
                {conversation.kind === "direct" ? <button type="button" onClick={() => void blockPeer()}><Ban size={15} />{conversation.blockedByViewer ? "Unblock user" : "Block user"}</button> : null}
              </div>
            </>
          ) : null}
        </aside>
      ) : null}
      {error ? <div className="messaging-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}><X size={14} /></button></div> : null}
      {previewAttachmentId ? (
        <AttachmentPreviewModal
          attachments={pendingPreviewAttachments(pendingAttachments)}
          contextTitle="Message attachments"
          attachmentId={previewAttachmentId}
          onClose={() => setPreviewAttachmentId(null)}
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
