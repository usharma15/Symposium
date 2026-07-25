"use client";

import {
  contentTranslationResultSchema,
  type ContentTranslationResultContract
} from "@/packages/contracts/src";
import {
  browserSessionLocalStorage,
  browserSessionPersistenceId,
  nonBrowserSessionPersistenceId,
  type BrowserStorageLike
} from "@/lib/browserSessionPersistence";

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
type TranslationStorageLike = BrowserStorageLike;
type ContentTranslationSessionEnvelope = {
  sessionId: string;
  records: ContentTranslationSessionRecord[];
};

export const contentTranslationSessionStorageKey = "symposium:content-translation-session:v2";
export const maxContentTranslationSessionEntries = 12;
const legacyContentTranslationSessionStorageKey = "symposium:content-translation-session:v1";

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

const browserTranslationStorage = () => browserSessionLocalStorage();

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

const storedRecords = (
  storage: TranslationStorageLike | null,
  storageKey = contentTranslationSessionStorageKey,
  sessionId = browserSessionPersistenceId()
): ContentTranslationSessionRecord[] => {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "null") as
      | ContentTranslationSessionEnvelope
      | unknown[];
    const records = Array.isArray(parsed)
      ? storageKey === legacyContentTranslationSessionStorageKey
        ? parsed
        : []
      : parsed && typeof parsed === "object" &&
          (parsed as Partial<ContentTranslationSessionEnvelope>).sessionId === sessionId &&
          Array.isArray((parsed as Partial<ContentTranslationSessionEnvelope>).records)
        ? (parsed as ContentTranslationSessionEnvelope).records
        : [];
    return records
      .map(validRecord)
      .filter((record): record is ContentTranslationSessionRecord => Boolean(record));
  } catch {
    return [];
  }
};

const migrateLegacyBrowserSessionRecords = (storage: TranslationStorageLike | null) => {
  if (!storage || typeof window === "undefined") return;
  try {
    if (storage.getItem(contentTranslationSessionStorageKey) !== null) return;
    const legacyRecords = storedRecords(
      window.sessionStorage,
      legacyContentTranslationSessionStorageKey,
      nonBrowserSessionPersistenceId
    )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxContentTranslationSessionEntries);
    if (legacyRecords.length === 0) return;
    storage.setItem(contentTranslationSessionStorageKey, JSON.stringify({
      sessionId: browserSessionPersistenceId(),
      records: legacyRecords
    } satisfies ContentTranslationSessionEnvelope));
    window.sessionStorage.removeItem(legacyContentTranslationSessionStorageKey);
  } catch {
    // Keep the legacy tab-local copy available if migration is blocked.
  }
};

export const peekContentTranslationSession = (
  identity: ContentTranslationSessionIdentity
): ContentTranslationSessionEntry | null =>
  memoryEntries.get(contentTranslationSessionIdentityKey(identity)) ?? null;

export const readContentTranslationSession = (
  identity: ContentTranslationSessionIdentity,
  storage: TranslationStorageLike | null = browserTranslationStorage(),
  sessionId = browserSessionPersistenceId()
): ContentTranslationSessionEntry | null => {
  migrateLegacyBrowserSessionRecords(storage);
  const key = contentTranslationSessionIdentityKey(identity);
  const memoryEntry = memoryEntries.get(key);
  if (memoryEntry) return memoryEntry;
  const normalizedIdentity = {
    ...identity,
    viewerHandle: normalizedViewerHandle(identity.viewerHandle),
    sourceRevision: Math.max(1, Math.trunc(identity.sourceRevision))
  };
  const matchesIdentity = (candidate: ContentTranslationSessionRecord) =>
    contentTranslationSessionIdentityKey(candidate) === contentTranslationSessionIdentityKey(normalizedIdentity);
  const record = storedRecords(storage, contentTranslationSessionStorageKey, sessionId).find(matchesIdentity) ?? (
    typeof window === "undefined"
      ? undefined
      : storedRecords(
          window.sessionStorage,
          legacyContentTranslationSessionStorageKey,
          nonBrowserSessionPersistenceId
        ).find(matchesIdentity)
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
  storage = browserTranslationStorage(),
  sessionId = browserSessionPersistenceId()
}: {
  viewerHandle: string;
  result: ContentTranslationResultContract;
  showTranslation: boolean;
  storage?: TranslationStorageLike | null;
  sessionId?: string;
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
    ...storedRecords(storage, contentTranslationSessionStorageKey, sessionId).filter((candidate) =>
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
    storage.setItem(contentTranslationSessionStorageKey, JSON.stringify({
      sessionId,
      records: nextRecords
    } satisfies ContentTranslationSessionEnvelope));
  } catch {
    // The in-memory handoff still preserves navigation continuity if storage is unavailable or full.
  }
};

export const readContentTranslationSessionStorageUpdate = (
  identity: ContentTranslationSessionIdentity,
  storageKey: string | null,
  storage: TranslationStorageLike | null = browserTranslationStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  if (storageKey !== contentTranslationSessionStorageKey) {
    return { handled: false as const, entry: null };
  }
  memoryEntries.delete(contentTranslationSessionIdentityKey(identity));
  return {
    handled: true as const,
    entry: readContentTranslationSession(identity, storage, sessionId)
  };
};

export const subscribeContentTranslationSession = (
  identity: ContentTranslationSessionIdentity,
  listener: (entry: ContentTranslationSessionEntry | null) => void
) => {
  if (typeof window === "undefined") return () => {};
  const handleStorage = (event: StorageEvent) => {
    const update = readContentTranslationSessionStorageUpdate(identity, event.key);
    if (update.handled) listener(update.entry);
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
};

export const resetContentTranslationSessionsForTests = () => {
  memoryEntries.clear();
};
