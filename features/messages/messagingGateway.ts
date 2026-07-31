import type {
  ConversationPageContract,
  ConversationSummaryContract,
  InquiryAttachmentContract,
  MessageContract,
  MessagePageContract
} from "@/packages/contracts/src";
import type { ResearchProfile } from "@/lib/mockData";
import {
  createClientMutationId,
  SymposiumApiError,
  symposiumApi,
  type SymposiumApiRequestOptions
} from "@/features/api/symposiumApiClient";
import type { MessageMediaKind } from "@/features/messages/messageDiscoveryState";

export type ConversationDraftSnapshot = {
  body: string;
  revision: number;
  clientVersion: string | null;
  updatedAt: string | null;
};

export type MessageDiscoveryPage = {
  messages: MessageContract[];
  nextCursor: string | null;
};

export const retryableMessagingFailure = (error: unknown) =>
  !(error instanceof SymposiumApiError) ||
  error.status === null ||
  error.status === 408 ||
  error.status === 425 ||
  error.status === 429 ||
  (error.status !== null && error.status >= 500);

export const missingMessagingResource = (error: unknown) =>
  error instanceof SymposiumApiError && error.status === 404;

export const conversationDraftFromConflict = (error: unknown): ConversationDraftSnapshot | null => {
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

type Request = <T>(path: string, options?: SymposiumApiRequestOptions) => Promise<T>;

const withActor = (path: string, actorHandle: string) => {
  const url = new URL(path, "https://symposium.invalid");
  url.searchParams.set("actorHandle", actorHandle);
  return `${url.pathname}?${url.searchParams.toString()}`;
};

/**
 * The single browser-side transport authority for Messaging. Presentation and
 * reconciliation code consume these domain operations instead of constructing
 * routes, request bodies, or idempotency scopes themselves.
 */
export const createMessagingGateway = (request: Request) => ({
  attachmentUrl: (attachment: InquiryAttachmentContract, actorHandle: string) =>
    attachment.url ?? `/api/message-attachments/${encodeURIComponent(attachment.id)}?actorHandle=${encodeURIComponent(actorHandle)}`,

  searchProfiles: (query: string, limit = 40, actorHandle?: string) => {
    const parameters = new URLSearchParams({ q: query, limit: String(limit) });
    if (actorHandle) parameters.set("actorHandle", actorHandle);
    return request<{ profiles: Record<string, ResearchProfile> }>(
      `/api/profiles?${parameters.toString()}`,
      { cache: "no-store" }
    );
  },

  discardAttachment: (attachmentId: string, actorHandle: string) => request<void>(
    `/api/attachments/${encodeURIComponent(attachmentId)}?actorHandle=${encodeURIComponent(actorHandle)}`,
    { method: "DELETE", body: { actorHandle } }
  ),

  markRead: (conversationId: string, actorHandle: string, sequence: number) => request<void>(
    `/api/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "POST", body: { actorHandle, sequence } }
  ),

  listConversations: (actorHandle: string, limit: number, cursor?: string | null) => {
    const parameters = new URLSearchParams({ limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    return request<ConversationPageContract>(
      withActor(`/api/conversations?${parameters.toString()}`, actorHandle),
      { cache: "no-store" }
    );
  },

  getMessages: (
    conversationId: string,
    actorHandle: string,
    limit: number,
    cursor?: string | null
  ) => {
    const parameters = new URLSearchParams({ limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    return request<MessagePageContract>(
      withActor(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${parameters.toString()}`, actorHandle),
      { cache: "no-store" }
    );
  },

  getConversation: (conversationId: string, actorHandle: string) => request<{
    conversation: ConversationSummaryContract;
  }>(withActor(`/api/conversations/${encodeURIComponent(conversationId)}`, actorHandle), { cache: "no-store" }),

  saveDraft: (
    conversationId: string,
    actorHandle: string,
    body: string,
    expectedRevision: number,
    clientVersion: string
  ) => request<{
    conflict?: false;
    draft?: ConversationDraftSnapshot;
    body?: string;
    updatedAt?: string | null;
  }>(`/api/conversations/${encodeURIComponent(conversationId)}/draft`, {
    method: "PATCH",
    idempotencyKey: createClientMutationId("message-draft-save"),
    body: { actorHandle, body, expectedRevision, clientVersion }
  }),

  createGroup: (actorHandle: string, title: string, inviteeHandles: string[]) => request<{
    conversationId: string;
  }>("/api/conversations/groups", {
    method: "POST",
    idempotencyKey: createClientMutationId("conversation-group"),
    body: { actorHandle, title, inviteeHandles }
  }),

  sendMessage: ({
    actorHandle,
    conversationId,
    recipientHandle,
    body,
    attachmentIds,
    draftRevision,
    draftClientVersion
  }: {
    actorHandle: string;
    conversationId?: string;
    recipientHandle?: string;
    body: string;
    attachmentIds: string[];
    draftRevision: number;
    draftClientVersion: string;
  }) => request<{ message: MessageContract; draft?: ConversationDraftSnapshot }>("/api/messages", {
    method: "POST",
    idempotencyKey: createClientMutationId("message-send"),
    body: {
      actorHandle,
      ...(recipientHandle ? { recipientHandle } : { conversationId }),
      body,
      attachmentIds,
      draftRevision,
      draftClientVersion
    }
  }),

  setStarred: (message: MessageContract, actorHandle: string, active: boolean) => request<void>(
    `/api/conversations/${message.conversationId}/messages/${message.id}/star`,
    { method: "POST", body: { actorHandle, active } }
  ),

  editMessage: (message: MessageContract, actorHandle: string, body: string) => request<{
    message: MessageContract;
  }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
    method: "PATCH",
    body: { actorHandle, body, expectedRevision: message.revision }
  }),

  deleteMessage: (message: MessageContract, actorHandle: string, mode: "self" | "everyone") => request<{
    message?: MessageContract;
  }>(`/api/conversations/${message.conversationId}/messages/${message.id}`, {
    method: "DELETE",
    body: { actorHandle, mode, expectedRevision: mode === "everyone" ? message.revision : undefined }
  }),

  changePreferences: (
    conversationId: string,
    actorHandle: string,
    preference: { muted?: boolean; pinned?: boolean }
  ) => request<void>(`/api/conversations/${conversationId}/preferences`, {
    method: "PATCH",
    body: { actorHandle, ...preference }
  }),

  clearConversation: (conversationId: string, actorHandle: string) => request<void>(
    `/api/conversations/${conversationId}/clear`,
    { method: "POST", body: { actorHandle } }
  ),

  deleteConversation: (conversationId: string, actorHandle: string) => request<void>(
    `/api/conversations/${conversationId}`,
    { method: "DELETE", body: { actorHandle } }
  ),

  setBlocked: (actorHandle: string, targetHandle: string, active: boolean) => request<void>("/api/blocks", {
    method: "POST",
    body: { actorHandle, targetHandle, active }
  }),

  searchMessages: (
    conversationId: string,
    actorHandle: string,
    query: string,
    limit: number,
    cursor?: string | null
  ) => {
    const parameters = new URLSearchParams({ query, limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    return request<MessageDiscoveryPage>(
      withActor(`/api/conversations/${conversationId}/search?${parameters.toString()}`, actorHandle),
      { cache: "no-store" }
    );
  },

  discoverMessages: (
    conversationId: string,
    actorHandle: string,
    kind: MessageMediaKind,
    limit: number,
    cursor?: string | null
  ) => {
    const parameters = new URLSearchParams({ limit: String(limit) });
    if (cursor) parameters.set("cursor", cursor);
    const endpoint = kind === "starred"
      ? `/api/conversations/${conversationId}/starred?${parameters.toString()}`
      : `/api/conversations/${conversationId}/search?kind=${encodeURIComponent(kind)}&${parameters.toString()}`;
    return request<MessageDiscoveryPage>(withActor(endpoint, actorHandle), { cache: "no-store" });
  },

  addParticipants: (conversationId: string, actorHandle: string, handles: string[]) => request<void>(
    `/api/conversations/${conversationId}/participants`,
    { method: "POST", body: { actorHandle, handles } }
  ),

  updateParticipantRole: (
    conversationId: string,
    actorHandle: string,
    handle: string,
    role: "owner" | "admin" | "member"
  ) => request<void>(`/api/conversations/${conversationId}/participants/${encodeURIComponent(handle)}`, {
    method: "PATCH",
    body: { actorHandle, role }
  }),

  removeParticipant: (conversationId: string, actorHandle: string, handle: string) => request<void>(
    `/api/conversations/${conversationId}/participants/${encodeURIComponent(handle)}`,
    { method: "DELETE", body: { actorHandle } }
  ),

  leaveConversation: (conversationId: string, actorHandle: string) => request<void>(
    `/api/conversations/${conversationId}/leave`,
    { method: "POST", body: { actorHandle } }
  ),

  getMessageContext: (conversationId: string, messageId: string, actorHandle: string) => request<MessagePageContract>(
    withActor(`/api/conversations/${conversationId}/messages/${messageId}/context`, actorHandle),
    { cache: "no-store" }
  )
});

export const messagingGateway = createMessagingGateway(symposiumApi.request);
