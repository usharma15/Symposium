import type { PostAction } from "@/lib/dataStore";
import { profile, type InquiryComment, type InquiryItem } from "@/lib/mockData";
import {
  commentActionActive,
  commentMetricsFallback,
  hasHandle,
  isDeletedComment,
  isDeletedPost,
  isSavedBy,
  metricNumber,
  updateSignalValue
} from "@/lib/symposiumCore";
import {
  clearActionStateProtection,
  createActionStateGuard,
  protectActionState,
  protectedActionState
} from "@/features/live-sync/actionStateGuard";

type ToggleAction = Exclude<PostAction, "read">;
export type ActionMetricKey = "signal" | "forks" | "saves" | "reads";
export type ProtectedActionMetricState = {
  metric: ActionMetricKey;
  value: string;
  mode: "floor" | "ceiling";
};

const toggleActions: ToggleAction[] = ["save", "signal", "fork"];
const metricActions: PostAction[] = ["save", "signal", "fork", "read"];

const metricKeyForAction = (action: PostAction): ActionMetricKey => {
  if (action === "signal") return "signal";
  if (action === "fork") return "forks";
  if (action === "save") return "saves";
  return "reads";
};

export const itemActionActive = (item: InquiryItem, action: PostAction, handle: string) => {
  if (action === "save") return isSavedBy(item, handle, profile.handle);
  if (action === "signal") return hasHandle(item.signaledBy, handle);
  if (action === "fork") return hasHandle(item.forkedBy, handle);
  return undefined;
};

export const createInquiryActionReconciler = () => {
  const guard = createActionStateGuard<ProtectedActionMetricState>();

  const setProtectedDesiredActionState = (
    key: string,
    desired: boolean | undefined,
    metricState?: ProtectedActionMetricState
  ) => protectActionState(guard, key, desired, metricState);

  const clearDesiredActionState = (key: string) => clearActionStateProtection(guard, key);
  const protectedDesiredActionState = (key: string) => protectedActionState(guard, key)?.desired;
  const protectedActionMetricState = (key: string) => protectedActionState(guard, key)?.metric;

  const protectedMetricValue = (incomingValue: string, protection: ProtectedActionMetricState) => {
    const incomingMetric = metricNumber(incomingValue);
    const protectedMetric = metricNumber(protection.value);
    if (protection.mode === "floor" && incomingMetric < protectedMetric) return protection.value;
    if (protection.mode === "ceiling" && incomingMetric > protectedMetric) return protection.value;
    return incomingValue;
  };

  const actionMetricStateFromValues = (
    previousMetrics: Partial<Record<ActionMetricKey, string>>,
    nextMetrics: Partial<Record<ActionMetricKey, string>>,
    action: PostAction
  ): ProtectedActionMetricState => {
    const metric = metricKeyForAction(action);
    const previousValue = previousMetrics[metric] ?? "0";
    const nextValue = nextMetrics[metric] ?? previousValue;
    return {
      metric,
      value: nextValue,
      mode: metricNumber(nextValue) < metricNumber(previousValue) ? "ceiling" : "floor"
    };
  };

  const actionProtectionMatchesIncoming = (
    key: string,
    active: boolean | undefined,
    metrics: Partial<Record<ActionMetricKey, string>>
  ) => {
    const desired = protectedDesiredActionState(key);
    if (desired !== undefined && active !== desired) return false;
    const metricState = protectedActionMetricState(key);
    if (!metricState) return desired !== undefined;
    const incomingValue = metrics[metricState.metric] ?? "0";
    return protectedMetricValue(incomingValue, metricState) === incomingValue;
  };

  const settleFreshCommentActionState = (itemId: string, comments: InquiryComment[], handle: string) => {
    for (const comment of comments) {
      if (!comment.id || isDeletedComment(comment)) continue;
      const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };
      for (const action of metricActions) {
        const key = `${itemId}:${comment.id}:${action}:${handle}`;
        if (actionProtectionMatchesIncoming(key, commentActionActive(comment, action, handle), metrics)) {
          clearDesiredActionState(key);
        }
      }
      settleFreshCommentActionState(itemId, comment.replies ?? [], handle);
    }
  };

  const settleFreshItemActionState = (item: InquiryItem, handle: string) => {
    if (isDeletedPost(item)) return;
    for (const action of metricActions) {
      const key = `${item.id}:${action}:${handle}`;
      if (actionProtectionMatchesIncoming(key, itemActionActive(item, action, handle), item.metrics)) {
        clearDesiredActionState(key);
      }
    }
    settleFreshCommentActionState(item.id, item.comments ?? [], handle);
  };

  const applyProtectedPostMetricState = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    handle: string
  ) => {
    if (isDeletedPost(incoming)) return incoming;
    let metrics = incoming.metrics;
    let signals = incoming.signals;
    let changed = false;
    for (const action of metricActions) {
      const protection = protectedActionMetricState(`${incoming.id}:${action}:${handle}`);
      if (!protection) continue;
      const protectedValue = current?.metrics[protection.metric] ?? protection.value;
      const nextValue = protectedMetricValue(metrics[protection.metric], { ...protection, value: protectedValue });
      if (nextValue === metrics[protection.metric]) continue;
      metrics = { ...metrics, [protection.metric]: nextValue };
      if (protection.metric === "forks") signals = updateSignalValue(signals, "Forks", nextValue);
      changed = true;
    }
    return changed ? { ...incoming, metrics, signals } : incoming;
  };

  const applyProtectedCommentMetricState = (
    itemId: string,
    incoming: InquiryComment,
    current: InquiryComment | undefined,
    handle: string
  ) => {
    if (!incoming.id || isDeletedComment(incoming)) return incoming;
    let metrics = { ...commentMetricsFallback, ...(incoming.metrics ?? {}) };
    let changed = false;
    for (const action of metricActions) {
      const protection = protectedActionMetricState(`${itemId}:${incoming.id}:${action}:${handle}`);
      if (!protection) continue;
      const currentMetrics = { ...commentMetricsFallback, ...(current?.metrics ?? {}) };
      const protectedValue = currentMetrics[protection.metric] ?? protection.value;
      const nextValue = protectedMetricValue(metrics[protection.metric], { ...protection, value: protectedValue });
      if (nextValue === metrics[protection.metric]) continue;
      metrics = { ...metrics, [protection.metric]: nextValue };
      changed = true;
    }
    return changed ? { ...incoming, metrics } : incoming;
  };

  const commentConflictsWithDesiredActionState = (
    itemId: string,
    comments: InquiryComment[],
    handle: string
  ): boolean =>
    comments.some((comment) => {
      if (isDeletedComment(comment)) return false;
      if (comment.id) {
        for (const action of toggleActions) {
          const desired = protectedDesiredActionState(`${itemId}:${comment.id}:${action}:${handle}`);
          if (desired !== undefined && commentActionActive(comment, action, handle) !== desired) return true;
        }
      }
      return commentConflictsWithDesiredActionState(itemId, comment.replies ?? [], handle);
    });

  const conflictsWithDesiredActionState = (item: InquiryItem, handle: string) => {
    if (isDeletedPost(item)) return false;
    for (const action of toggleActions) {
      const desired = protectedDesiredActionState(`${item.id}:${action}:${handle}`);
      if (desired !== undefined && itemActionActive(item, action, handle) !== desired) return true;
    }
    return commentConflictsWithDesiredActionState(item.id, item.comments ?? [], handle);
  };

  const protectCommentTreeFromStaleActionState = (
    itemId: string,
    incomingComments: InquiryComment[],
    currentComments: InquiryComment[],
    handle: string
  ): InquiryComment[] => {
    if (!incomingComments.length) return incomingComments;
    const currentById = new Map(currentComments.flatMap((comment) => (comment.id ? [[comment.id, comment]] : [])));
    let changed = false;
    const nextComments = incomingComments.map((incomingComment) => {
      const currentComment = incomingComment.id ? currentById.get(incomingComment.id) : undefined;
      const incomingReplies = incomingComment.replies ?? [];
      const currentReplies = currentComment?.replies ?? [];
      let nextComment = applyProtectedCommentMetricState(itemId, incomingComment, currentComment, handle);
      if (nextComment !== incomingComment) {
        changed = true;
        nextComment = {
          ...nextComment,
          replies: protectCommentTreeFromStaleActionState(itemId, incomingReplies, currentReplies, handle)
        };
        return nextComment;
      }
      const nextReplies = protectCommentTreeFromStaleActionState(itemId, incomingReplies, currentReplies, handle);
      if (nextReplies === incomingReplies) return incomingComment;
      changed = true;
      return { ...incomingComment, replies: nextReplies };
    });
    return changed ? nextComments : incomingComments;
  };

  const protectItemFromStaleActionState = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    handle: string
  ) => {
    if (isDeletedPost(incoming)) return incoming;
    if (conflictsWithDesiredActionState(incoming, handle)) return current ?? incoming;
    const metricProtected = applyProtectedPostMetricState(incoming, current, handle);
    const protectedComments = protectCommentTreeFromStaleActionState(
      metricProtected.id,
      metricProtected.comments ?? [],
      current?.comments ?? [],
      handle
    );
    return protectedComments === metricProtected.comments
      ? metricProtected
      : { ...metricProtected, comments: protectedComments };
  };

  const protectItemsFromStaleActionState = (
    incomingItems: InquiryItem[],
    currentItems: InquiryItem[],
    handle: string
  ) => {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    return incomingItems.map((incoming) =>
      protectItemFromStaleActionState(incoming, currentById.get(incoming.id), handle)
    );
  };

  return {
    actionMetricStateFromValues,
    clearDesiredActionState,
    itemActionActive,
    protectItemFromStaleActionState,
    protectItemsFromStaleActionState,
    protectedDesiredActionState,
    setProtectedDesiredActionState,
    settleFreshItemActionState
  };
};
