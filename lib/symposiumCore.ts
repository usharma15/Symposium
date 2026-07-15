import type { ContentKind, InquiryComment, InquiryItem, RoomId } from "@/lib/mockData";

export const contentKinds = ["paper", "thought", "draft", "note", "code"] as const satisfies readonly ContentKind[];

export const postRooms = [
  "office",
  "symposium",
  "library",
  "amphitheater",
  "funding",
  "communities",
  "opportunities"
] as const satisfies readonly Exclude<RoomId, "hall">[];

export type PostAction = "signal" | "save" | "fork" | "read";
export type CommentAction = PostAction;
export type CommentMetricSubset = Pick<InquiryItem["metrics"], "signal" | "forks" | "saves" | "reads">;

export const commentMetricsFallback: CommentMetricSubset = { signal: "0", forks: "0", saves: "0", reads: "0" };

const legacyHandleAliases: Record<string, string> = {
  "@usharma": "@udayan"
};

export const cleanHandle = (handle: string) => {
  const trimmed = handle.trim().toLowerCase();
  const withAt = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  const clean = withAt.replace(/[^@a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^@_/, "@").replace(/_$/, "");
  return legacyHandleAliases[clean] ?? clean;
};

export const normalizeSearchPhrase = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export const metricNumber = (value: string) => {
  const normalized = value.toLowerCase().replace(/,/g, "");
  const multiplier = normalized.endsWith("b")
    ? 1_000_000_000
    : normalized.endsWith("m")
      ? 1_000_000
      : normalized.endsWith("k")
        ? 1000
        : 1;
  return Math.max(0, Math.round((Number.parseFloat(normalized) || 0) * multiplier));
};

export const formatMetric = (value: number) => {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue < 1000) return String(safeValue);

  if (safeValue < 1_000_000) {
    const thousands = safeValue / 1000;
    return safeValue < 100_000 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
  }

  if (safeValue < 1_000_000_000) {
    const millions = safeValue / 1_000_000;
    return safeValue < 100_000_000 ? `${millions.toFixed(1)}M` : `${Math.round(millions)}M`;
  }

  const billions = safeValue / 1_000_000_000;
  return Number.isInteger(billions) ? `${Math.round(billions)}B` : `${billions < 100 ? billions.toFixed(1) : Math.round(billions)}B`;
};

export const incrementMetric = (value: string, amount: number) => formatMetric(metricNumber(value) + amount);

const normalizeHandles = (handles: string[] | undefined) =>
  Array.from(new Set((handles ?? []).map(cleanHandle).filter((handle) => handle !== "@")));

export const toggleHandle = (handles: string[] | undefined, handle: string, active?: boolean) => {
  const clean = cleanHandle(handle);
  const current = new Set(normalizeHandles(handles));
  if (clean === "@") return { handles: [...current], delta: 0 };
  const hasCurrent = current.has(clean);

  if (active === true) {
    if (hasCurrent) return { handles: [...current], delta: 0 };
    current.add(clean);
    return { handles: [...current], delta: 1 };
  }

  if (active === false) {
    if (!hasCurrent) return { handles: [...current], delta: 0 };
    current.delete(clean);
    return { handles: [...current], delta: -1 };
  }

  if (hasCurrent) {
    current.delete(clean);
    return { handles: [...current], delta: -1 };
  }

  current.add(clean);
  return { handles: [...current], delta: 1 };
};

export const hasHandle = (handles: string[] | undefined, handle: string) => normalizeHandles(handles).includes(cleanHandle(handle));

export const isSavedBy = (item: InquiryItem, handle: string, defaultSavedHandle?: string) => {
  if (item.savedBy) return hasHandle(item.savedBy, handle);
  return Boolean(item.saved) && cleanHandle(handle) === cleanHandle(defaultSavedHandle ?? "");
};

export const setItemActionMembership = (
  item: InquiryItem,
  action: Exclude<PostAction, "read">,
  actorHandle: string,
  active: boolean,
  defaultSavedHandle?: string
): InquiryItem => {
  if (action === "save") {
    const currentSavedBy = item.savedBy ?? (item.saved && defaultSavedHandle ? [defaultSavedHandle] : []);
    const savedBy = toggleHandle(currentSavedBy, actorHandle, active).handles;
    return { ...item, savedBy, saved: savedBy.length > 0 };
  }
  if (action === "signal") {
    return { ...item, signaledBy: toggleHandle(item.signaledBy, actorHandle, active).handles };
  }
  return { ...item, forkedBy: toggleHandle(item.forkedBy, actorHandle, active).handles };
};

export const setCommentActionMembership = (
  comment: InquiryComment,
  action: Exclude<CommentAction, "read">,
  actorHandle: string,
  active: boolean
): InquiryComment => {
  if (action === "save") {
    return { ...comment, savedBy: toggleHandle(comment.savedBy, actorHandle, active).handles };
  }
  if (action === "signal") {
    return { ...comment, signaledBy: toggleHandle(comment.signaledBy, actorHandle, active).handles };
  }
  return { ...comment, forkedBy: toggleHandle(comment.forkedBy, actorHandle, active).handles };
};

export const mutateItemForActor = (
  item: InquiryItem,
  action: PostAction,
  actorHandle: string,
  defaultSavedHandle?: string,
  active?: boolean
): InquiryItem => {
  if (action === "save") {
    const currentSavedBy = item.savedBy ?? (item.saved && defaultSavedHandle ? [defaultSavedHandle] : []);
    const next = toggleHandle(currentSavedBy, actorHandle, active);
    return {
      ...item,
      savedBy: next.handles,
      saved: next.handles.length > 0,
      metrics: { ...item.metrics, saves: incrementMetric(item.metrics.saves, next.delta) }
    };
  }

  if (action === "signal") {
    const next = toggleHandle(item.signaledBy, actorHandle, active);
    return {
      ...item,
      signaledBy: next.handles,
      metrics: { ...item.metrics, signal: incrementMetric(item.metrics.signal, next.delta) }
    };
  }

  if (action === "fork") {
    const next = toggleHandle(item.forkedBy, actorHandle, active);
    const nextForks = incrementMetric(item.metrics.forks, next.delta);
    return {
      ...item,
      forkedBy: next.handles,
      metrics: { ...item.metrics, forks: nextForks },
      signals: updateSignalValue(item.signals, "Forks", nextForks)
    };
  }

  return {
    ...item,
    metrics: { ...item.metrics, reads: incrementMetric(item.metrics.reads, 1) }
  };
};

export const countComments = (comments: InquiryComment[]): number =>
  comments.reduce(
    (total, comment) => total + (isDeletedComment(comment) ? 0 : 1) + countComments(comment.replies ?? []),
    0
  );

export const deletedPostTitle = "—";
export const deletedPostBody = "This post has been deleted";
export const deletedPostAuthor = "—";
export const deletedCommentBody = "This comment is deleted";
export const deletedCommentAuthor = "—";
export const deletedMetricLabel = "—";

export const isDeletedPost = (item: Pick<InquiryItem, "deletedAt">) => Boolean(item.deletedAt);
export const isDeletedComment = (comment: Pick<InquiryComment, "deletedAt">) => Boolean(comment.deletedAt);

export const commentActionActive = (
  comment: Pick<InquiryComment, "deletedAt" | "savedBy" | "signaledBy" | "forkedBy">,
  action: CommentAction,
  handle: string
) => {
  if (isDeletedComment(comment)) return false;
  if (action === "save") return hasHandle(comment.savedBy, handle);
  if (action === "signal") return hasHandle(comment.signaledBy, handle);
  if (action === "fork") return hasHandle(comment.forkedBy, handle);
  return undefined;
};

export const mutateCommentForActor = <T extends InquiryComment>(
  comment: T,
  action: CommentAction,
  actorHandle: string,
  active?: boolean
): T => {
  if (isDeletedComment(comment)) return comment;

  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };

  if (action === "save") {
    const next = toggleHandle(comment.savedBy, actorHandle, active);
    return {
      ...comment,
      savedBy: next.handles,
      metrics: { ...metrics, saves: incrementMetric(metrics.saves, next.delta) }
    };
  }

  if (action === "signal") {
    const next = toggleHandle(comment.signaledBy, actorHandle, active);
    return {
      ...comment,
      signaledBy: next.handles,
      metrics: { ...metrics, signal: incrementMetric(metrics.signal, next.delta) }
    };
  }

  if (action === "fork") {
    const next = toggleHandle(comment.forkedBy, actorHandle, active);
    return {
      ...comment,
      forkedBy: next.handles,
      metrics: { ...metrics, forks: incrementMetric(metrics.forks, next.delta) }
    };
  }

  return {
    ...comment,
    metrics: { ...metrics, reads: incrementMetric(metrics.reads, 1) }
  };
};

export const mapCommentTree = <T extends { id?: string; replies?: T[] }>(
  comments: T[],
  commentId: string,
  mutate: (comment: T) => T
): { comments: T[]; updated: T | null } => {
  let updated: T | null = null;
  const nextComments = comments.map((comment) => {
    if (comment.id === commentId) {
      updated = mutate(comment);
      return updated;
    }

    const child = mapCommentTree(comment.replies ?? [], commentId, mutate);
    if (child.updated) updated = child.updated;
    return child.updated ? { ...comment, replies: child.comments } : comment;
  });

  return { comments: nextComments, updated };
};

export const findCommentInTree = <T extends { id?: string; replies?: T[] }>(
  comments: T[],
  commentId: string
): T | null => {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    const found = findCommentInTree(comment.replies ?? [], commentId);
    if (found) return found;
  }
  return null;
};

export const appendCommentToTree = <T extends { id?: string; parentId?: string | null; replies?: T[] }>(
  comments: T[],
  comment: T
): { comments: T[]; inserted: boolean } => {
  if (!comment.parentId) return { comments: [...comments, comment], inserted: true };

  let inserted = false;
  const nextComments = comments.map((current) => {
    if (current.id === comment.parentId) {
      inserted = true;
      return { ...current, replies: [...(current.replies ?? []), comment] };
    }

    const child = appendCommentToTree(current.replies ?? [], comment);
    if (!child.inserted) return current;
    inserted = true;
    return { ...current, replies: child.comments };
  });

  return { comments: inserted ? nextComments : comments, inserted };
};

export const canManageComment = (
  comment: Pick<InquiryComment, "authorHandle">,
  actorHandle: string
) => (comment.authorHandle ? cleanHandle(comment.authorHandle) === cleanHandle(actorHandle) : false);

export const deletedPostContextTitle = (item: Pick<InquiryItem, "deletedAt" | "title">) =>
  isDeletedPost(item) ? deletedPostTitle : item.title;

export const tombstonePost = (item: InquiryItem, deletedAt = new Date().toISOString()): InquiryItem => ({
  ...item,
  title: deletedPostTitle,
  author: deletedPostAuthor,
  authorHandle: undefined,
  affiliation: "",
  editedAt: undefined,
  deletedAt,
  status: "Deleted",
  gatheringReason: "",
  excerpt: deletedPostBody,
  body: deletedPostBody,
  tags: [],
  signals: [],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  attachments: [],
  quote: undefined,
  patronage: undefined
});

export const tombstoneComment = (
  comment: InquiryComment,
  deletedAt = new Date().toISOString()
): InquiryComment => ({
  ...comment,
  author: deletedCommentAuthor,
  authorHandle: undefined,
  body: deletedCommentBody,
  stance: "Deleted",
  editedAt: undefined,
  deletedAt,
  metrics: comment.metrics,
  savedBy: [],
  signaledBy: [],
  forkedBy: [],
  attachments: [],
  quote: undefined,
  replies: comment.replies ?? []
});

export const relativeDateScore = (label: string) => {
  const normalized = label.trim().toLowerCase();
  const now = Date.now();
  if (!normalized || normalized === "just now" || normalized === "live now") return now - 30 * 1000;
  if (normalized === "today") return now - 60 * 60 * 1000;

  const minutes = normalized.match(/^(\d+)m ago$/);
  if (minutes) return now - Number(minutes[1]) * 60 * 1000;

  const hours = normalized.match(/^(\d+)h ago$/);
  if (hours) return now - Number(hours[1]) * 60 * 60 * 1000;

  if (normalized === "yesterday") return now - 24 * 60 * 60 * 1000;

  const parsed = Date.parse(`${label} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const itemTimestampScore = (item: Pick<InquiryItem, "createdAt" | "date">) => {
  const parsed = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? relativeDateScore(item.date) : parsed;
};

export const relativeTimeLabel = (createdAt?: string, fallbackLabel = "", now = Date.now()) => {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(parsed)) return fallbackLabel || "Just now";

  const elapsedSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (elapsedSeconds < 60) return "Just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedDays < 30) return `${elapsedWeeks}w ago`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedDays < 365) return `${elapsedMonths}mo ago`;

  const elapsedYears = Math.floor(elapsedDays / 365);
  if (elapsedYears >= 1) return `${elapsedYears}y ago`;

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(parsed));
};

export const localDateTimeLabel = (createdAt?: string) => {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(parsed)) return "";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(new Date(parsed));
};

export const updateSignalValue = (signals: InquiryItem["signals"], label: string, value: string) =>
  signals.map((signal) => (signal.label === label ? { ...signal, value } : signal));

export const tombstoneCommentInItem = (
  item: InquiryItem,
  commentId: string,
  deletedAt = new Date().toISOString()
) => {
  const original = findCommentInTree(item.comments, commentId);
  if (!original || isDeletedComment(original)) return { item, deletedComment: null };

  const mapped = mapCommentTree(item.comments, commentId, (comment) => tombstoneComment(comment, deletedAt));
  if (!mapped.updated) return { item, deletedComment: null };

  const critiques = incrementMetric(item.metrics.critiques, -1);
  return {
    item: {
      ...item,
      comments: mapped.comments,
      metrics: { ...item.metrics, critiques },
      signals: updateSignalValue(item.signals, "Critiques", critiques)
    },
    deletedComment: mapped.updated
  };
};
