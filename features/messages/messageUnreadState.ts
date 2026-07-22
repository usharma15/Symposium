import type { MessagingLiveEvent } from "@/features/messages/messageLiveState";

const unreadChangingEventKinds = new Set([
  "message.sent",
  "message.deleted",
  "conversation.created",
  "conversation.participants.added",
  "conversation.participant.removed",
  "conversation.participant.left",
  "conversation.preferences.updated",
  "conversation.read",
  "conversation.cleared",
  "conversation.deleted_for_viewer"
]);

export const messagingEventCanChangeUnread = (event: MessagingLiveEvent) =>
  unreadChangingEventKinds.has(event.kind);

export const latestUnreadChangingEventKey = (events: MessagingLiveEvent[]) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (!messagingEventCanChangeUnread(event)) continue;
    return event.id ?? event.cursor ?? `${event.kind}:${event.subjectId}:${event.createdAt ?? ""}`;
  }
  return null;
};

export const compactMessageUnreadCount = (count: number) => count > 99 ? "99+" : String(count);
