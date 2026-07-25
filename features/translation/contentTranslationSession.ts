"use client";

import {
  contentTranslationResultSchema,
  type ContentTranslationResultContract
} from "@/packages/contracts/src";

export type ContentTranslationSessionIdentity = {
  viewerHandle: string;
  sourceType: "post" | "comment";
  sourceId: string;
  sourceRevision: number;
};

export type ContentTranslationSessionEntry = {
  result: ContentTranslationResultContract;
  showTranslation: boolean;
  updatedAt: number;
};

type ContentTranslationSessionRecord = ContentTranslationSessionIdentity & ContentTranslationSessionEntry;
type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export const contentTranslationSessionStorageKey = "symposium:content-translation-session:v1";
export const maxContentTranslationSessionEntries = 12;

const memoryEntries = new Map<string, ContentTranslationSessionEntry>();
const rememberInMemory = (key: string, entry: ContentTranslationSessionEntry) => {
  memoryEntries.delete(key);
  memoryEntries.set(key, entry);
  while (memoryEntries.size > maxContentTranslationSessionEntries) {
    const oldestKey = memoryEntries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    memoryEntries.delete(oldestKey);
  }
};

const normalizedViewerHandle = (handle: string) => handle.trim().toLowerCase();

export const contentTranslationSessionIdentityKey = ({
  viewerHandle,
  sourceType,
  sourceId,
  sourceRevision
}: ContentTranslationSessionIdentity) => [
  encodeURIComponent(normalizedViewerHandle(viewerHandle)),
  sourceType,
  encodeURIComponent(sourceId),
  Math.max(1, Math.trunc(sourceRevision))
].join(":");

const browserSessionStorage = (): SessionStorageLike | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const validRecord = (value: unknown): ContentTranslationSessionRecord | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ContentTranslationSessionRecord>;
  if (
    typeof candidate.viewerHandle !== "string" ||
    (candidate.sourceType !== "post" && candidate.sourceType !== "comment") ||
    typeof candidate.sourceId !== "string" ||
    !Number.isInteger(candidate.sourceRevision) ||
    (candidate.sourceRevision ?? 0) < 1 ||
    typeof candidate.showTranslation !== "boolean" ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }
  const parsedResult = contentTranslationResultSchema.safeParse(candidate.result);
  if (
    !parsedResult.success ||
    parsedResult.data.status !== "translated" ||
    parsedResult.data.sourceType !== candidate.sourceType ||
    parsedResult.data.sourceId !== candidate.sourceId ||
    parsedResult.data.sourceRevision !== candidate.sourceRevision
  ) {
    return null;
  }
  return {
    viewerHandle: normalizedViewerHandle(candidate.viewerHandle),
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceRevision: candidate.sourceRevision,
    result: parsedResult.data,
    showTranslation: candidate.showTranslation,
    updatedAt: candidate.updatedAt
  };
};

const storedRecords = (storage: SessionStorageLike | null): ContentTranslationSessionRecord[] => {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(contentTranslationSessionStorageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(validRecord)
      .filter((record): record is ContentTranslationSessionRecord => Boolean(record));
  } catch {
    return [];
  }
};

export const peekContentTranslationSession = (
  identity: ContentTranslationSessionIdentity
): ContentTranslationSessionEntry | null =>
  memoryEntries.get(contentTranslationSessionIdentityKey(identity)) ?? null;

export const readContentTranslationSession = (
  identity: ContentTranslationSessionIdentity,
  storage: SessionStorageLike | null = browserSessionStorage()
): ContentTranslationSessionEntry | null => {
  const key = contentTranslationSessionIdentityKey(identity);
  const memoryEntry = memoryEntries.get(key);
  if (memoryEntry) return memoryEntry;
  const normalizedIdentity = {
    ...identity,
    viewerHandle: normalizedViewerHandle(identity.viewerHandle),
    sourceRevision: Math.max(1, Math.trunc(identity.sourceRevision))
  };
  const record = storedRecords(storage).find((candidate) =>
    contentTranslationSessionIdentityKey(candidate) === contentTranslationSessionIdentityKey(normalizedIdentity)
  );
  if (!record) return null;
  const entry = {
    result: record.result,
    showTranslation: record.showTranslation,
    updatedAt: record.updatedAt
  };
  rememberInMemory(key, entry);
  return entry;
};

export const rememberContentTranslationSession = ({
  viewerHandle,
  result,
  showTranslation,
  storage = browserSessionStorage()
}: {
  viewerHandle: string;
  result: ContentTranslationResultContract;
  showTranslation: boolean;
  storage?: SessionStorageLike | null;
}) => {
  if (result.status !== "translated") return;
  const record = validRecord({
    viewerHandle,
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    sourceRevision: result.sourceRevision,
    result,
    showTranslation,
    updatedAt: Date.now()
  });
  if (!record) return;
  const key = contentTranslationSessionIdentityKey(record);
  const entry = {
    result: record.result,
    showTranslation: record.showTranslation,
    updatedAt: record.updatedAt
  };
  rememberInMemory(key, entry);
  if (!storage) return;
  const nextRecords = [
    record,
    ...storedRecords(storage).filter((candidate) =>
      !(
        normalizedViewerHandle(candidate.viewerHandle) === normalizedViewerHandle(record.viewerHandle) &&
        candidate.sourceType === record.sourceType &&
        candidate.sourceId === record.sourceId
      )
    )
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxContentTranslationSessionEntries);
  try {
    storage.setItem(contentTranslationSessionStorageKey, JSON.stringify(nextRecords));
  } catch {
    // The in-memory handoff still preserves navigation continuity if storage is unavailable or full.
  }
};

export const resetContentTranslationSessionsForTests = () => {
  memoryEntries.clear();
};
