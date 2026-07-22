export const messageReadViewportActive = ({
  documentVisible,
  windowFocused,
  nearLatestMessage
}: {
  documentVisible: boolean;
  windowFocused: boolean;
  nearLatestMessage: boolean;
}) => documentVisible && windowFocused && nearLatestMessage;

export const messageReadAcknowledgesSummary = (
  lastMessageSequence: number,
  acknowledgedSequence: number
) => lastMessageSequence <= acknowledgedSequence;

export const messageReadFollowUpNeeded = ({
  pendingConversationId,
  pendingSequence,
  acknowledgedConversationId,
  acknowledgedSequence
}: {
  pendingConversationId: string | null;
  pendingSequence: number;
  acknowledgedConversationId: string;
  acknowledgedSequence: number;
}) => Boolean(
  pendingConversationId &&
  pendingSequence > 0 &&
  (pendingConversationId !== acknowledgedConversationId || pendingSequence > acknowledgedSequence)
);
