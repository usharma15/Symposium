import {
  messageSchema,
  type MessageContract
} from "@/packages/contracts/src";

export type MessagingLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  actorHandle?: string;
  subjectId: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

const canonicalMessageEventKinds = new Set([
  "message.sent",
  "message.edited",
  "message.deleted"
]);

export const liveEventConversationId = (event: MessagingLiveEvent) => {
  const payloadId = event.payload?.conversationId;
  return typeof payloadId === "string" ? payloadId : event.subjectId;
};

export const canonicalMessageFromLiveEvent = (event: MessagingLiveEvent): MessageContract | null => {
  if (!canonicalMessageEventKinds.has(event.kind)) return null;
  const parsed = messageSchema.safeParse(event.payload?.message);
  return parsed.success ? parsed.data : null;
};

export const mergeCanonicalMessage = (
  current: MessageContract[],
  incoming: MessageContract
) => {
  const existing = current.find((message) => message.id === incoming.id);
  if (existing && existing.revision > incoming.revision) return current;
  const canonical = existing
    ? { ...incoming, starred: incoming.deletedAt ? false : existing.starred }
    : incoming;
  return [
    ...current.filter((message) => message.id !== incoming.id),
    canonical
  ].sort((left, right) =>
    left.sequence - right.sequence ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
};

export const messagingEventRequiresRefresh = (event: MessagingLiveEvent) => {
  if (canonicalMessageFromLiveEvent(event)) return false;
  if (event.kind === "message.star.updated") return false;
  if (event.kind === "conversation.draft.updated" || event.kind === "conversation.read") return false;
  return (
    event.kind.startsWith("message.") ||
    event.kind.startsWith("conversation.") ||
    event.kind === "profile.blocked" ||
    event.kind === "profile.unblocked"
  );
};
