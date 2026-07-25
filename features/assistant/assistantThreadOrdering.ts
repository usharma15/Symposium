import type { AssistantThreadSummaryContract } from "@/packages/contracts/src";

export const orderAssistantThreadsByLatestMessage = (
  threads: AssistantThreadSummaryContract[]
) => [...threads].sort((left, right) => {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const activity = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt);
  return activity || right.id.localeCompare(left.id);
});

export const reconcileAssistantThreadSummary = (
  threads: AssistantThreadSummaryContract[],
  next: AssistantThreadSummaryContract,
  options: { status: "active" | "archived"; hasSearch: boolean }
) => {
  const existing = threads.some((candidate) => candidate.id === next.id);
  const statusMatches = options.status === "archived"
    ? next.archivedAt !== null
    : next.archivedAt === null;
  const withoutNext = threads.filter((candidate) => candidate.id !== next.id);
  if (!statusMatches) return withoutNext;
  if (options.hasSearch && !existing) return threads;
  return orderAssistantThreadsByLatestMessage([next, ...withoutNext]);
};

export const assistantThreadActivityLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
