import type {
  ConversationParticipantContract,
  ConversationSummaryContract,
  MessageContract
} from "@/packages/contracts/src";
import type { ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";

export const activeConversationParticipants = (participants: ConversationParticipantContract[]) =>
  participants.filter((participant) => participant.status === "active");

export const currentConversationParticipant = (
  participant: ConversationParticipantContract,
  profiles: Record<string, ResearchProfile>
): ConversationParticipantContract => {
  const current = profiles[cleanHandle(participant.handle)];
  return current
    ? { ...participant, name: current.name, avatarUrl: current.avatarUrl }
    : participant;
};

export const messageSenderProfile = (
  message: MessageContract,
  participants: ConversationParticipantContract[],
  profiles: Record<string, ResearchProfile>
) => {
  if (!message.senderHandle) return undefined;
  const senderHandle = cleanHandle(message.senderHandle);
  const current = profiles[senderHandle];
  if (current) return current;
  return participants.find((participant) => cleanHandle(participant.handle) === senderHandle);
};

export const withoutConversationParticipant = (
  conversation: ConversationSummaryContract,
  handle: string
): ConversationSummaryContract => ({
  ...conversation,
  participants: conversation.participants.filter(
    (participant) => cleanHandle(participant.handle) !== cleanHandle(handle)
  )
});
