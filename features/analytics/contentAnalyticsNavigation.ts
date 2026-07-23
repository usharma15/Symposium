import type { ContentAnalyticsTarget } from "./contentAnalyticsSync";
import type { ContentAnalyticsViewContract } from "@/packages/contracts/src";

export type PendingContentAnalytics = ContentAnalyticsTarget & {
  view: ContentAnalyticsViewContract;
};

export const pendingContentAnalyticsStorageKey = "symposium:pending-content-analytics";
export const openContentAnalyticsEvent = "symposium:open-content-analytics";

let memoryPendingContentAnalytics: PendingContentAnalytics | null = null;

const isAnalyticsView = (value: unknown): value is ContentAnalyticsViewContract =>
  value === "overview" || value === "likes" || value === "reshares" || value === "quotes";

export const isPendingContentAnalytics = (
  value: unknown
): value is PendingContentAnalytics => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingContentAnalytics>;
  return (candidate.subjectType === "post" || candidate.subjectType === "comment")
    && typeof candidate.postId === "string"
    && Boolean(candidate.postId.trim())
    && (
      candidate.subjectType === "post"
      || (typeof candidate.commentId === "string" && Boolean(candidate.commentId.trim()))
    )
    && isAnalyticsView(candidate.view);
};

export const queuePendingContentAnalytics = (pending: PendingContentAnalytics) => {
  memoryPendingContentAnalytics = pending;
  try {
    window.sessionStorage.setItem(pendingContentAnalyticsStorageKey, JSON.stringify(pending));
  } catch {
    // The in-memory handoff and immediate event still cover storage-constrained browsers.
  }
};

const storedPendingContentAnalytics = () => {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(pendingContentAnalyticsStorageKey) ?? "null"
    );
    return isPendingContentAnalytics(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const sameTarget = (
  pending: PendingContentAnalytics,
  target: ContentAnalyticsTarget
) => pending.subjectType === target.subjectType
  && pending.postId === target.postId
  && (pending.subjectType === "post" || pending.commentId === target.commentId);

export const consumePendingContentAnalytics = (
  target: ContentAnalyticsTarget
): ContentAnalyticsViewContract | null => {
  const pending = memoryPendingContentAnalytics ?? storedPendingContentAnalytics();
  if (!pending || !sameTarget(pending, target)) return null;
  memoryPendingContentAnalytics = null;
  try {
    window.sessionStorage.removeItem(pendingContentAnalyticsStorageKey);
  } catch {
    // The in-memory handoff has already been consumed.
  }
  return pending.view;
};

export const clearPendingContentAnalytics = () => {
  memoryPendingContentAnalytics = null;
  try {
    window.sessionStorage.removeItem(pendingContentAnalyticsStorageKey);
  } catch {
    // No persistent cleanup is available in this browser.
  }
};

export const dispatchPendingContentAnalytics = (pending: PendingContentAnalytics) => {
  window.dispatchEvent(new CustomEvent(openContentAnalyticsEvent, { detail: pending }));
};
