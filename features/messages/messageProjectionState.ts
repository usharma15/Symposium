import type {
  ConversationSummaryContract,
  MessageContract
} from "@/packages/contracts/src";
import { mergeCanonicalMessage } from "@/features/messages/messageLiveState";

const conversationProjectionOrder = (
  left: ConversationSummaryContract,
  right: ConversationSummaryContract
) =>
  Number(right.pinned) - Number(left.pinned) ||
  right.updatedAt.localeCompare(left.updatedAt) ||
  right.id.localeCompare(left.id);

export const mergeConversationPageAfterProjectionChange = (
  current: ConversationSummaryContract[],
  incoming: ConversationSummaryContract[]
) => {
  const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
  const incomingIds = new Set(incoming.map((conversation) => conversation.id));
  return [
    ...incoming.map((conversation) => currentById.get(conversation.id) ?? conversation),
    ...current.filter((conversation) => !incomingIds.has(conversation.id))
  ].sort(conversationProjectionOrder);
};

export const upsertConversationProjection = (
  current: ConversationSummaryContract[],
  incoming: ConversationSummaryContract
) => [
  incoming,
  ...current.filter((conversation) => conversation.id !== incoming.id)
].sort(conversationProjectionOrder);

export const mergeCanonicalMessagePage = (
  current: MessageContract[],
  incoming: MessageContract[]
) => incoming.reduce(
  (messages, message) => mergeCanonicalMessage(messages, message),
  current
);

export const reconcileDiscoveryMessage = (
  current: MessageContract[],
  incoming: MessageContract
) => {
  if (incoming.deletedAt) {
    return current.filter((message) => message.id !== incoming.id);
  }
  if (!current.some((message) => message.id === incoming.id)) return current;
  return mergeCanonicalMessage(current, incoming);
};
