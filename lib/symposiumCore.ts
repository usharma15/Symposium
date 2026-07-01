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
  comments.reduce((total, comment) => total + 1 + countComments(comment.replies ?? []), 0);

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

export const relativeTimeLabel = (createdAt?: string, fallbackLabel = "") => {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(parsed)) return fallbackLabel || "Just now";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (elapsedSeconds < 60) return "Just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 52) return `${elapsedWeeks}w ago`;

  const elapsedYears = Math.floor(elapsedDays / 365);
  if (elapsedYears >= 1) return `${elapsedYears}y ago`;

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(parsed));
};

export const localDateTimeLabel = (createdAt?: string) => {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(parsed)) return "";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
};

export const updateSignalValue = (signals: InquiryItem["signals"], label: string, value: string) =>
  signals.map((signal) => (signal.label === label ? { ...signal, value } : signal));
