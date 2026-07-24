"use client";

import type { DocumentTranslationResultContract } from "@/packages/contracts/src";

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

const emptySession: DocumentViewerSessionSnapshot = {
  resultsByPage: {},
  translatedVisiblePages: new Set()
};
const sessions = new Map<string, DocumentViewerSessionSnapshot>();
const positions = new Map<string, DocumentReadingPosition>();
const sessionListeners = new Map<string, Set<SessionListener>>();
const positionListeners = new Map<string, Set<PositionListener>>();

const boundedPageNumber = (value: number) =>
  Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;

const boundedPageProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const emitSession = (attachmentId: string) => {
  sessionListeners.get(attachmentId)?.forEach((listener) => listener());
};

export const documentViewerSessionSnapshot = (attachmentId: string) =>
  sessions.get(attachmentId) ?? emptySession;

export const subscribeDocumentViewerSession = (
  attachmentId: string,
  listener: SessionListener
) => {
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
  result: DocumentTranslationResultContract
) => {
  if (result.status !== "translated" || !result.pages.length) return;
  const current = documentViewerSessionSnapshot(attachmentId);
  const resultsByPage = { ...current.resultsByPage };
  const translatedVisiblePages = new Set(current.translatedVisiblePages);
  result.pages.forEach((page) => {
    resultsByPage[page.pageNumber] = result;
    translatedVisiblePages.add(page.pageNumber);
  });
  sessions.set(attachmentId, { resultsByPage, translatedVisiblePages });
  emitSession(attachmentId);
};

export const setDocumentTranslationVisible = (
  attachmentId: string,
  pageNumber: number,
  visible: boolean
) => {
  const current = documentViewerSessionSnapshot(attachmentId);
  const boundedPage = boundedPageNumber(pageNumber);
  const translatedVisiblePages = new Set(current.translatedVisiblePages);
  const hadPage = translatedVisiblePages.has(boundedPage);
  if (visible) translatedVisiblePages.add(boundedPage);
  else translatedVisiblePages.delete(boundedPage);
  if (hadPage === translatedVisiblePages.has(boundedPage)) return;
  sessions.set(attachmentId, {
    resultsByPage: current.resultsByPage,
    translatedVisiblePages
  });
  emitSession(attachmentId);
};

export const readDocumentReadingPosition = (
  attachmentId: string
): DocumentReadingPosition => positions.get(attachmentId) ?? {
  pageNumber: 1,
  pageProgress: 0
};

export const rememberDocumentReadingPosition = (
  attachmentId: string,
  position: DocumentReadingPosition,
  sourceId: string
) => {
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
  positionListeners.get(attachmentId)?.forEach((listener) => listener(next, sourceId));
};

export const subscribeDocumentReadingPosition = (
  attachmentId: string,
  listener: PositionListener
) => {
  const listeners = positionListeners.get(attachmentId) ?? new Set<PositionListener>();
  listeners.add(listener);
  positionListeners.set(attachmentId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) positionListeners.delete(attachmentId);
  };
};

export const resetDocumentViewerSessionsForTests = () => {
  sessions.clear();
  positions.clear();
  sessionListeners.clear();
  positionListeners.clear();
};
