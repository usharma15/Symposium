import type { AssistantThreadSummaryContract } from "@/packages/contracts/src";

export const orderAssistantThreadsByLatestMessage = (
  threads: AssistantThreadSummaryContract[]
) => [...threads].sort((left, right) => {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const activity = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt);
  return activity || right.id.localeCompare(left.id);
});

export const assistantThreadActivityLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
