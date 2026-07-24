"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Languages, LoaderCircle, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import { SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { TranslationLanguagePicker } from "@/features/translation/TranslationLanguagePicker";
import { translatedDocumentForSource } from "@/lib/documentModel";
import type { InquiryAttachment, ResearchProfile } from "@/lib/mockData";
import {
  assistantTranslationLanguageCodes,
  assistantTranslationLanguageLabels
} from "@/packages/contracts/src/translationLanguages";
import type {
  AssistantTranslationLanguageContract,
  ContentTranslationResultContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";

export const useContentTranslation = ({
  sourceType,
  sourceId,
  sourceRevision
}: {
  sourceType: "post" | "comment";
  sourceId: string;
  sourceRevision: number;
}) => {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<AssistantTranslationLanguageContract>("english");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContentTranslationResultContract | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setOpen(false);
    setBusy(false);
    setError("");
    setResult(null);
    setShowTranslation(false);
    retryRef.current = null;
  }, [sourceId, sourceRevision, sourceType]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const fingerprint = `${sourceType}:${sourceId}:${sourceRevision}:${language}`;
    if (retryRef.current?.fingerprint !== fingerprint) {
      retryRef.current = { fingerprint, key: createClientMutationId("content-translation") };
    }
    setBusy(true);
    setError("");
    try {
      const response = await symposiumApi.request<ContentTranslationResultContract>(
        "/api/assistant/content-translations",
        {
          method: "POST",
          idempotencyKey: retryRef.current.key,
          body: {
            sourceType,
            sourceId,
            languageInstruction: assistantTranslationLanguageLabels[language]
          }
        }
      );
      retryRef.current = null;
      setResult(response);
      window.dispatchEvent(new CustomEvent("symposium-ai-quota-change", { detail: response.quota }));
      if (response.status === "translated") {
        setShowTranslation(true);
        setOpen(false);
      } else {
        setError(response.message);
      }
    } catch (caught) {
      setError(caught instanceof SymposiumApiError || caught instanceof Error
        ? caught.message
        : `This ${sourceType} could not be translated.`);
    } finally {
      setBusy(false);
    }
  };

  return {
    open,
    setOpen,
    language,
    setLanguage,
    busy,
    error,
    result,
    showTranslation,
    setShowTranslation,
    submit
  };
};

export type ContentTranslationState = ReturnType<typeof useContentTranslation>;

export function ContentTranslationControl({
  state,
  sourceLabel
}: {
  state: ContentTranslationState;
  sourceLabel: "post" | "comment";
}) {
  const translated = state.result?.status === "translated";
  return (
    <div
      className={`content-translation-control content-translation-${sourceLabel}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="content-translation-bar">
        {translated ? (
          <div className="content-translation-view-toggle" aria-label={`${sourceLabel} language view`}>
            <button
              type="button"
              className={!state.showTranslation ? "active" : ""}
              aria-pressed={!state.showTranslation}
              onClick={() => state.setShowTranslation(false)}
            >
              Original
            </button>
            <button
              type="button"
              className={state.showTranslation ? "active" : ""}
              aria-pressed={state.showTranslation}
              aria-label={`${state.result?.targetLanguageLabel ?? "Translation"}${state.result?.cached ? ", saved translation, no answer used" : ", translation ready"}`}
              onClick={() => state.setShowTranslation(true)}
            >
              {state.result?.targetLanguageLabel ?? "Translation"}
            </button>
          </div>
        ) : (
          <span className="content-translation-label"><Languages size={13} />Read in another language</span>
        )}
        <button
          type="button"
          className="content-translate-button"
          aria-expanded={state.open}
          title={`Translate this ${sourceLabel}`}
          onClick={() => state.setOpen((current) => !current)}
        >
          <Languages size={13} />
          {translated ? "Change" : "Translate"}
        </button>
      </div>
      {state.open ? (
        <form
          className="content-translation-menu"
          onSubmit={state.submit}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>Translate entire {sourceLabel}</strong>
            <button type="button" title="Close translation menu" onClick={() => state.setOpen(false)}><X size={14} /></button>
          </header>
          <span className="translation-language-label">Language</span>
          <TranslationLanguagePicker
            value={state.language}
            onChange={state.setLanguage}
            disabled={state.busy}
            ariaLabel={`Search languages for this ${sourceLabel}`}
          />
          <small>Only a completed translation uses 1 answer. The original and saved translations remain available.</small>
          {state.error ? <p role="alert">{state.error}</p> : null}
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? <LoaderCircle className="spin" size={14} /> : <Languages size={14} />}
            {state.busy ? "Translating entire text…" : "Translate · 1 answer"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function TranslatedContent({
  state,
  sourceDocument,
  sourceBody,
  attachments,
  profiles,
  mode,
  onOpenAttachment,
  onCiteAttachment,
  onExpand
}: {
  state: ContentTranslationState;
  sourceDocument?: VersionedDocumentContract;
  sourceBody: string;
  attachments?: InquiryAttachment[];
  profiles: Record<string, ResearchProfile>;
  mode: "feed" | "detail" | "comment";
  onOpenAttachment?: (attachmentId: string) => void;
  onCiteAttachment?: (attachment: InquiryAttachment) => void;
  onExpand?: () => void;
}) {
  if (!state.showTranslation || state.result?.status !== "translated") return null;
  const translatedDocument = translatedDocumentForSource({
    sourceDocument,
    sourceBody,
    translatedDocument: state.result.translatedDocument ?? undefined,
    translatedBody: state.result.translatedBody
  });
  return (
    <SymposiumDocumentRenderer
      document={translatedDocument}
      body={state.result.translatedBody}
      attachments={attachments}
      profiles={profiles}
      mode={mode}
      lang={state.result.targetLanguage ? assistantTranslationLanguageCodes[state.result.targetLanguage] : undefined}
      onOpenAttachment={onOpenAttachment}
      onCiteAttachment={onCiteAttachment}
      onExpand={onExpand}
    />
  );
}
