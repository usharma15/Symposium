"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent
} from "react";
import { Languages, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import {
  documentViewerSessionSnapshot,
  rememberDocumentTranslation,
  setDocumentTranslationVisible,
  subscribeDocumentViewerSession
} from "@/features/attachments/documentViewerSession";
import type {
  DocumentTranslationResultContract,
  DocumentTranslationSourcePageContract
} from "@/packages/contracts/src";

export type DocumentTranslationSource = {
  pages: DocumentTranslationSourcePageContract[];
  complete: boolean;
};

type TranslationRequest = {
  attachmentId: string;
  sourceTitle: string;
  sourceKind: "document" | "docx" | "pdf";
  pageNumber: number;
  loadSource: () => Promise<DocumentTranslationSource>;
};

export const useDocumentTranslation = ({
  attachmentId,
  sourceTitle,
  sourceKind,
  pageNumber,
  loadSource
}: TranslationRequest) => {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => subscribeDocumentViewerSession(attachmentId, listener),
    [attachmentId]
  );
  const getSnapshot = useCallback(
    () => documentViewerSessionSnapshot(attachmentId),
    [attachmentId]
  );
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const resultsByPage = session.resultsByPage;
  const translatedVisiblePages = session.translatedVisiblePages;

  useEffect(() => {
    setOpen(false);
    setInstruction("");
    setBusy(false);
    setError("");
    retryRef.current = null;
  }, [attachmentId]);

  useEffect(() => {
    setError("");
  }, [pageNumber]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const languageInstruction = instruction.trim();
    if (!languageInstruction || busy) return;
    setBusy(true);
    setError("");
    try {
      const source = await loadSource();
      if (!source.pages.length || source.pages.every((page) => !page.body.trim() && !page.imageDataUrl)) {
        throw new Error("This page could not be prepared for translation.");
      }
      const input = {
        attachmentId,
        sourceTitle,
        sourceKind,
        sourcePages: source.pages,
        sourceComplete: source.complete,
        languageInstruction
      };
      const fingerprint = JSON.stringify(input);
      if (retryRef.current?.fingerprint !== fingerprint) {
        retryRef.current = { fingerprint, key: createClientMutationId("document-translation") };
      }
      const response = await symposiumApi.request<DocumentTranslationResultContract>(
        "/api/assistant/document-translations",
        {
          method: "POST",
          idempotencyKey: retryRef.current.key,
          body: input
        }
      );
      retryRef.current = null;
      rememberDocumentTranslation(attachmentId, response);
      window.dispatchEvent(new CustomEvent("symposium-ai-quota-change", { detail: response.quota }));
      if (response.status === "translated") {
        setOpen(false);
      } else {
        setError(response.message);
      }
    } catch (caught) {
      setError(caught instanceof SymposiumApiError || caught instanceof Error
        ? caught.message
        : "The document could not be translated.");
    } finally {
      setBusy(false);
    }
  };

  const result = resultsByPage[pageNumber] ?? null;
  const translatedOnCurrentPage = result?.status === "translated" &&
    result.pages.some((translatedPage) => translatedPage.pageNumber === pageNumber);
  const showTranslation = translatedOnCurrentPage && translatedVisiblePages.has(pageNumber);
  const setShowTranslation = (visible: boolean) => {
    setDocumentTranslationVisible(attachmentId, pageNumber, visible);
  };
  const translatedPageFor = (targetPage: number) => {
    const pageResult = resultsByPage[targetPage];
    return pageResult?.status === "translated"
      ? pageResult.pages.find((translatedPage) => translatedPage.pageNumber === targetPage) ?? null
      : null;
  };
  const showTranslationForPage = (targetPage: number) =>
    Boolean(translatedPageFor(targetPage) && translatedVisiblePages.has(targetPage));

  return {
    open,
    setOpen,
    instruction,
    setInstruction,
    busy,
    error,
    result,
    resultsByPage,
    translatedVisiblePages,
    pageNumber,
    translatedOnCurrentPage,
    showTranslation,
    setShowTranslation,
    translatedPageFor,
    showTranslationForPage,
    submit
  };
};

export type DocumentTranslationState = ReturnType<typeof useDocumentTranslation>;

export function DocumentTranslationControl({ state }: { state: DocumentTranslationState }) {
  return (
    <div
      className="document-translation-control"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {state.translatedOnCurrentPage ? (
        <div className="document-translation-view-toggle" aria-label="Document version">
          <button
            type="button"
            className={!state.showTranslation ? "active" : ""}
            aria-pressed={!state.showTranslation}
            onClick={(event) => {
              event.stopPropagation();
              state.setShowTranslation(false);
            }}
          >
            Original
          </button>
          <button
            type="button"
            className={state.showTranslation ? "active" : ""}
            aria-pressed={state.showTranslation}
            onClick={(event) => {
              event.stopPropagation();
              state.setShowTranslation(true);
            }}
          >
            Translation
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="document-translate-button"
        title={`Translate page ${state.pageNumber}`}
        aria-expanded={state.open}
        onClick={(event) => {
          event.stopPropagation();
          state.setOpen((current) => !current);
        }}
      >
        <Languages size={14} />
        <span>Translate page</span>
      </button>
      {state.open ? (
        <form
          className="document-translation-popover"
          onSubmit={state.submit}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="document-translation-popover-title">
            <strong>Translate page {state.pageNumber}</strong>
            <button type="button" title="Close translation" onClick={() => state.setOpen(false)}><X size={14} /></button>
          </div>
          <span className="translation-language-label">Language</span>
          <div className="translation-language-options" role="group" aria-label="Translation language">
            {["English", "French", "German", "Spanish"].map((language) => (
              <button
                type="button"
                key={language}
                className={state.instruction === language ? "active" : ""}
                aria-pressed={state.instruction === language}
                disabled={state.busy}
                onClick={() => state.setInstruction(language)}
              >
                {language}
              </button>
            ))}
          </div>
          <small className="document-translation-limit-warning">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>Due to limited usage restriction this beta translates one page at a time</span>
          </small>
          <small>English, French, German, or Spanish.</small>
          {state.error ? <p role="alert">{state.error}</p> : null}
          <button type="submit" className="document-translation-submit" disabled={!state.instruction.trim() || state.busy}>
            {state.busy ? <LoaderCircle className="spin" size={14} /> : <Languages size={14} />}
            {state.busy ? "Translating…" : "Translate · uses 1"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
