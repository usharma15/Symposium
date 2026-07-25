"use client";

import {
  documentTranslationResultSchema,
  type DocumentTranslationResultContract
} from "@/packages/contracts/src";
import {
  browserSessionLocalStorage,
  browserSessionPersistenceId,
  type BrowserStorageLike
} from "@/lib/browserSessionPersistence";

export type DocumentReadingPosition = {
  pageNumber: number;
  pageProgress: number;
};

export type DocumentViewerSessionSnapshot = {
  resultsByPage: Readonly<Record<number, DocumentTranslationResultContract>>;
  translatedVisiblePages: ReadonlySet<number>;
};

type PositionListener = (position: DocumentReadingPosition, sourceId: string) => void;
type SessionListener = () => void;
type PersistedDocumentViewerRecord = {
  attachmentId: string;
  results: DocumentTranslationResultContract[];
  translatedVisiblePages: number[];
  position?: DocumentReadingPosition;
  updatedAt: number;
};
type DocumentViewerSessionEnvelope = {
  sessionId: string;
  documents: PersistedDocumentViewerRecord[];
};

export const documentViewerSessionStorageKey = "symposium:document-viewer-session:v1";
export const maxDocumentViewerSessionEntries = 8;

const emptySession: DocumentViewerSessionSnapshot = {
  resultsByPage: {},
  translatedVisiblePages: new Set()
};
const sessions = new Map<string, DocumentViewerSessionSnapshot>();
const positions = new Map<string, DocumentReadingPosition>();
const sessionListeners = new Map<string, Set<SessionListener>>();
const positionListeners = new Map<string, Set<PositionListener>>();
const hydratedAttachments = new Set<string>();
const pendingPositionPersistence = new Map<
  string,
  { timeout: number; flush: () => void }
>();
let browserStorageListenerInitialized = false;

const boundedPageNumber = (value: number) =>
  Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;

const boundedPageProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const validPosition = (value: unknown): DocumentReadingPosition | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DocumentReadingPosition>;
  if (
    typeof candidate.pageNumber !== "number" ||
    typeof candidate.pageProgress !== "number" ||
    !Number.isFinite(candidate.pageNumber) ||
    !Number.isFinite(candidate.pageProgress)
  ) {
    return undefined;
  }
  return {
    pageNumber: boundedPageNumber(candidate.pageNumber),
    pageProgress: boundedPageProgress(candidate.pageProgress)
  };
};

const validRecord = (value: unknown): PersistedDocumentViewerRecord | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedDocumentViewerRecord>;
  if (
    typeof candidate.attachmentId !== "string" ||
    !candidate.attachmentId ||
    !Array.isArray(candidate.results) ||
    !Array.isArray(candidate.translatedVisiblePages) ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }
  const results = candidate.results.flatMap((result) => {
    const parsed = documentTranslationResultSchema.safeParse(result);
    return parsed.success &&
      parsed.data.status === "translated" &&
      parsed.data.attachmentId === candidate.attachmentId
      ? [parsed.data]
      : [];
  });
  const translatedPageNumbers = new Set(
    results.flatMap((result) => result.pages.map((page) => page.pageNumber))
  );
  return {
    attachmentId: candidate.attachmentId,
    results,
    translatedVisiblePages: candidate.translatedVisiblePages
      .filter((page): page is number => typeof page === "number" && Number.isFinite(page))
      .map(boundedPageNumber)
      .filter((page) => translatedPageNumbers.has(page)),
    position: validPosition(candidate.position),
    updatedAt: candidate.updatedAt
  };
};

const storedRecords = (
  storage: BrowserStorageLike | null,
  sessionId = browserSessionPersistenceId()
) => {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(documentViewerSessionStorageKey) ?? "null") as
      Partial<DocumentViewerSessionEnvelope> | null;
    if (
      !parsed ||
      parsed.sessionId !== sessionId ||
      !Array.isArray(parsed.documents)
    ) {
      return [];
    }
    return parsed.documents
      .map(validRecord)
      .filter((record): record is PersistedDocumentViewerRecord => Boolean(record))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxDocumentViewerSessionEntries);
  } catch {
    return [];
  }
};

const snapshotForRecord = (
  record: PersistedDocumentViewerRecord
): DocumentViewerSessionSnapshot => {
  const resultsByPage: Record<number, DocumentTranslationResultContract> = {};
  record.results.forEach((result) => {
    result.pages.forEach((page) => {
      resultsByPage[page.pageNumber] = result;
    });
  });
  return {
    resultsByPage,
    translatedVisiblePages: new Set(record.translatedVisiblePages)
  };
};

const emitSession = (attachmentId: string) => {
  sessionListeners.get(attachmentId)?.forEach((listener) => listener());
};

const emitPosition = (
  attachmentId: string,
  position: DocumentReadingPosition,
  sourceId: string
) => {
  positionListeners.get(attachmentId)?.forEach((listener) => listener(position, sourceId));
};

const uniqueResults = (snapshot: DocumentViewerSessionSnapshot) => {
  const byFingerprint = new Map<string, DocumentTranslationResultContract>();
  Object.values(snapshot.resultsByPage).forEach((result) => {
    const key = [
      result.attachmentId,
      result.sourceFingerprint,
      result.targetLanguage,
      result.createdAt
    ].join(":");
    byFingerprint.set(key, result);
  });
  return [...byFingerprint.values()];
};

const persistAttachment = (
  attachmentId: string,
  storage = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  if (!storage) return;
  const snapshot = sessions.get(attachmentId) ?? emptySession;
  const record: PersistedDocumentViewerRecord = {
    attachmentId,
    results: uniqueResults(snapshot),
    translatedVisiblePages: [...snapshot.translatedVisiblePages],
    position: positions.get(attachmentId),
    updatedAt: Date.now()
  };
  const documents = [
    record,
    ...storedRecords(storage, sessionId).filter((candidate) =>
      candidate.attachmentId !== attachmentId
    )
  ].slice(0, maxDocumentViewerSessionEntries);
  try {
    storage.setItem(documentViewerSessionStorageKey, JSON.stringify({
      sessionId,
      documents
    } satisfies DocumentViewerSessionEnvelope));
  } catch {
    // In-memory continuity remains available when local storage is unavailable or full.
  }
};

const schedulePositionPersistence = (
  attachmentId: string,
  storage: BrowserStorageLike | null,
  sessionId: string
) => {
  if (typeof window === "undefined") {
    persistAttachment(attachmentId, storage, sessionId);
    return;
  }
  const pending = pendingPositionPersistence.get(attachmentId);
  if (pending) window.clearTimeout(pending.timeout);
  const flush = () => {
    pendingPositionPersistence.delete(attachmentId);
    persistAttachment(attachmentId, storage, sessionId);
  };
  pendingPositionPersistence.set(attachmentId, {
    timeout: window.setTimeout(flush, 120),
    flush
  });
};

const applyRecord = (
  record: PersistedDocumentViewerRecord,
  sourceId: string,
  notify: boolean
) => {
  const previousPosition = positions.get(record.attachmentId);
  sessions.set(record.attachmentId, snapshotForRecord(record));
  if (record.position) positions.set(record.attachmentId, record.position);
  else positions.delete(record.attachmentId);
  hydratedAttachments.add(record.attachmentId);
  if (!notify) return;
  emitSession(record.attachmentId);
  if (
    record.position &&
    (
      previousPosition?.pageNumber !== record.position.pageNumber ||
      Math.abs((previousPosition?.pageProgress ?? -1) - record.position.pageProgress) >= 0.001
    )
  ) {
    emitPosition(record.attachmentId, record.position, sourceId);
  }
};

export const hydrateDocumentViewerSession = (
  attachmentId: string,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  if (hydratedAttachments.has(attachmentId)) return;
  hydratedAttachments.add(attachmentId);
  const record = storedRecords(storage, sessionId).find((candidate) =>
    candidate.attachmentId === attachmentId
  );
  if (record) applyRecord(record, "browser-session-hydrate", false);
};

export const applyDocumentViewerSessionStorageUpdate = (
  storageKey: string | null,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  if (storageKey !== documentViewerSessionStorageKey) return false;
  const records = storedRecords(storage, sessionId);
  records.forEach((record) => applyRecord(record, "cross-tab", true));
  return true;
};

const initializeBrowserStorageListener = () => {
  if (browserStorageListenerInitialized || typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    applyDocumentViewerSessionStorageUpdate(event.key);
  });
  window.addEventListener("pagehide", () => {
    [...pendingPositionPersistence.values()].forEach(({ timeout, flush }) => {
      window.clearTimeout(timeout);
      flush();
    });
  });
  browserStorageListenerInitialized = true;
};

export const documentViewerSessionSnapshot = (
  attachmentId: string,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  initializeBrowserStorageListener();
  hydrateDocumentViewerSession(attachmentId, storage, sessionId);
  return sessions.get(attachmentId) ?? emptySession;
};

export const subscribeDocumentViewerSession = (
  attachmentId: string,
  listener: SessionListener
) => {
  initializeBrowserStorageListener();
  hydrateDocumentViewerSession(attachmentId);
  const listeners = sessionListeners.get(attachmentId) ?? new Set<SessionListener>();
  listeners.add(listener);
  sessionListeners.set(attachmentId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) sessionListeners.delete(attachmentId);
  };
};

export const rememberDocumentTranslation = (
  attachmentId: string,
  result: DocumentTranslationResultContract,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  if (
    result.status !== "translated" ||
    result.attachmentId !== attachmentId ||
    !result.pages.length
  ) {
    return;
  }
  const current = documentViewerSessionSnapshot(attachmentId, storage, sessionId);
  const resultsByPage = { ...current.resultsByPage };
  const translatedVisiblePages = new Set(current.translatedVisiblePages);
  result.pages.forEach((page) => {
    resultsByPage[page.pageNumber] = result;
    translatedVisiblePages.add(page.pageNumber);
  });
  sessions.set(attachmentId, { resultsByPage, translatedVisiblePages });
  persistAttachment(attachmentId, storage, sessionId);
  emitSession(attachmentId);
};

export const setDocumentTranslationVisible = (
  attachmentId: string,
  pageNumber: number,
  visible: boolean,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  const current = documentViewerSessionSnapshot(attachmentId, storage, sessionId);
  const boundedPage = boundedPageNumber(pageNumber);
  const translatedVisiblePages = new Set(current.translatedVisiblePages);
  const hadPage = translatedVisiblePages.has(boundedPage);
  if (visible && current.resultsByPage[boundedPage]) translatedVisiblePages.add(boundedPage);
  else translatedVisiblePages.delete(boundedPage);
  if (hadPage === translatedVisiblePages.has(boundedPage)) return;
  sessions.set(attachmentId, {
    resultsByPage: current.resultsByPage,
    translatedVisiblePages
  });
  persistAttachment(attachmentId, storage, sessionId);
  emitSession(attachmentId);
};

export const readDocumentReadingPosition = (
  attachmentId: string,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
): DocumentReadingPosition => {
  initializeBrowserStorageListener();
  hydrateDocumentViewerSession(attachmentId, storage, sessionId);
  return positions.get(attachmentId) ?? {
    pageNumber: 1,
    pageProgress: 0
  };
};

export const rememberDocumentReadingPosition = (
  attachmentId: string,
  position: DocumentReadingPosition,
  sourceId: string,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  hydrateDocumentViewerSession(attachmentId, storage, sessionId);
  const next = {
    pageNumber: boundedPageNumber(position.pageNumber),
    pageProgress: boundedPageProgress(position.pageProgress)
  };
  const current = positions.get(attachmentId);
  if (
    current?.pageNumber === next.pageNumber &&
    Math.abs(current.pageProgress - next.pageProgress) < 0.001
  ) {
    return;
  }
  positions.set(attachmentId, next);
  schedulePositionPersistence(attachmentId, storage, sessionId);
  emitPosition(attachmentId, next, sourceId);
};

export const reapplyDocumentReadingPosition = (
  attachmentId: string,
  position: DocumentReadingPosition,
  sourceId: string,
  storage: BrowserStorageLike | null = browserSessionLocalStorage(),
  sessionId = browserSessionPersistenceId()
) => {
  const next = {
    pageNumber: boundedPageNumber(position.pageNumber),
    pageProgress: boundedPageProgress(position.pageProgress)
  };
  positions.set(attachmentId, next);
  schedulePositionPersistence(attachmentId, storage, sessionId);
  emitPosition(attachmentId, next, sourceId);
};

export const subscribeDocumentReadingPosition = (
  attachmentId: string,
  listener: PositionListener
) => {
  initializeBrowserStorageListener();
  hydrateDocumentViewerSession(attachmentId);
  const listeners = positionListeners.get(attachmentId) ?? new Set<PositionListener>();
  listeners.add(listener);
  positionListeners.set(attachmentId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) positionListeners.delete(attachmentId);
  };
};

export const resetDocumentViewerSessionsForTests = () => {
  pendingPositionPersistence.forEach(({ timeout }) => clearTimeout(timeout));
  pendingPositionPersistence.clear();
  sessions.clear();
  positions.clear();
  sessionListeners.clear();
  positionListeners.clear();
  hydratedAttachments.clear();
};
