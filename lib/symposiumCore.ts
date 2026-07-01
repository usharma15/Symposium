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
  const multiplier = normalized.endsWith("k") ? 1000 : 1;
  return Math.round((Number.parseFloat(normalized) || 0) * multiplier);
};

export const formatMetric = (value: number) => {
  if (value >= 1000) {
    const compact = Number(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1);
    return `${compact}k`;
  }
  return String(Math.max(0, value));
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
  if (!normalized || normalized === "just now" || normalized === "live now") return now - 10 * 60 * 1000;
  if (normalized === "today") return now - 60 * 60 * 1000;

  const minutes = normalized.match(/^(\d+)m ago$/);
  if (minutes) return now - Number(minutes[1]) * 60 * 1000;

  const hours = normalized.match(/^(\d+)h ago$/);
  if (hours) return now - Number(hours[1]) * 60 * 60 * 1000;

  if (normalized === "yesterday") return now - 24 * 60 * 60 * 1000;

  const parsed = Date.parse(`${label} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const updateSignalValue = (signals: InquiryItem["signals"], label: string, value: string) =>
  signals.map((signal) => (signal.label === label ? { ...signal, value } : signal));
