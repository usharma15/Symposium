export type ContentAnalyticsTarget = {
  subjectType: "post" | "comment";
  postId: string;
  commentId?: string;
};

export type ContentAnalyticsInvalidation = {
  eventKey: string;
  targets: ContentAnalyticsTarget[];
  all?: boolean;
};

type LiveEventLike = {
  id?: string;
  cursor?: string;
  kind: string;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export const contentAnalyticsSyncChannel = "symposium-content-analytics-sync-v1";
export const contentAnalyticsSyncStorageKey = "symposium-content-analytics-sync";
export const contentAnalyticsInvalidationEvent = "symposium:content-analytics-changed";

const accessChangingEventKinds = new Set([
  "community.settings.updated",
  "community.member.removed",
  "community.joined",
  "community.left",
  "community.request.accepted"
]);

const cleanTarget = (value: unknown): ContentAnalyticsTarget | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const subjectType = candidate.subjectType;
  const postId = typeof candidate.postId === "string" ? candidate.postId.trim() : "";
  const commentId = typeof candidate.commentId === "string" ? candidate.commentId.trim() : "";
  if ((subjectType !== "post" && subjectType !== "comment") || !postId) return null;
  if (subjectType === "comment" && !commentId) return null;
  return {
    subjectType,
    postId,
    ...(subjectType === "comment" ? { commentId } : {})
  };
};

const targetKey = (target: ContentAnalyticsTarget) =>
  target.subjectType === "post"
    ? `post:${target.postId}`
    : `comment:${target.postId}:${target.commentId}`;

export const contentAnalyticsTargetMatches = (
  left: ContentAnalyticsTarget,
  right: ContentAnalyticsTarget
) => targetKey(left) === targetKey(right);

export const rememberContentAnalyticsInvalidationKey = (
  keys: string[],
  eventKey: string,
  limit = 128
) => {
  if (keys.includes(eventKey)) return { seen: true, keys };
  return {
    seen: false,
    keys: [...keys.slice(-(Math.max(1, limit) - 1)), eventKey]
  };
};

export const isContentAnalyticsInvalidation = (
  value: unknown
): value is ContentAnalyticsInvalidation => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContentAnalyticsInvalidation>;
  return typeof candidate.eventKey === "string"
    && candidate.eventKey.length > 0
    && candidate.eventKey.length <= 500
    && Array.isArray(candidate.targets)
    && candidate.targets.length <= 8
    && candidate.targets.every((target) => Boolean(cleanTarget(target)))
    && (candidate.all === undefined || typeof candidate.all === "boolean");
};

export const contentAnalyticsInvalidationFromLiveEvent = (
  event: LiveEventLike
): ContentAnalyticsInvalidation | null => {
  const payload = event.payload ?? {};
  const targets = new Map<string, ContentAnalyticsTarget>();
  const addTarget = (value: unknown) => {
    const target = cleanTarget(value);
    if (target) targets.set(targetKey(target), target);
  };

  const payloadItem = payload.item && typeof payload.item === "object"
    ? payload.item as Record<string, unknown>
    : null;
  const itemId = typeof payload.itemId === "string"
    ? payload.itemId
    : typeof payloadItem?.id === "string"
      ? payloadItem.id
      : "";
  const commentId = typeof payload.commentId === "string" ? payload.commentId : "";
  if (typeof payload.action === "string" && itemId) {
    addTarget(commentId
      ? { subjectType: "comment", postId: itemId, commentId }
      : { subjectType: "post", postId: itemId });
  }

  if (event.kind === "post.updated" && event.subjectId) {
    addTarget({ subjectType: "post", postId: event.subjectId });
  }
  if (
    (event.kind === "comment.updated" || event.kind === "comment.deleted")
    && event.subjectId
    && itemId
  ) {
    addTarget({ subjectType: "comment", postId: itemId, commentId: event.subjectId });
  }

  if (Array.isArray(payload.analyticsSubjects)) {
    for (const target of payload.analyticsSubjects) addTarget(target);
  }

  const all = accessChangingEventKinds.has(event.kind) || event.kind === "post.deleted";
  if (!targets.size && !all) return null;
  const eventKey = event.cursor
    ?? event.id
    ?? `${event.kind}:${event.subjectType ?? ""}:${event.subjectId ?? ""}:${event.createdAt ?? ""}`;
  return {
    eventKey,
    targets: [...targets.values()],
    ...(all ? { all: true } : {})
  };
};

export const dispatchContentAnalyticsInvalidation = (
  message: ContentAnalyticsInvalidation
) => {
  window.dispatchEvent(new CustomEvent(contentAnalyticsInvalidationEvent, {
    detail: message
  }));
};
