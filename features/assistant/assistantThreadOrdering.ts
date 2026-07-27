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
  options: {
    view: "all" | "projects" | "archived";
    projectId: string | null;
    hasSearch: boolean;
  }
) => {
  const existing = threads.some((candidate) => candidate.id === next.id);
  const statusMatches = options.view === "archived"
    ? next.archivedAt !== null
    : next.archivedAt === null;
  const projectMatches =
    options.view !== "projects" ||
    Boolean(options.projectId && next.projectId === options.projectId);
  const withoutNext = threads.filter((candidate) => candidate.id !== next.id);
  if (!statusMatches || !projectMatches) return withoutNext;
  if (options.hasSearch && !existing) return threads;
  return orderAssistantThreadsByLatestMessage([next, ...withoutNext]);
};

export const assistantThreadActivityLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
