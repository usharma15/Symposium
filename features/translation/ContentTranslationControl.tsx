"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Languages, LoaderCircle, X } from "lucide-react";
import { createClientMutationId, symposiumApi, SymposiumApiError } from "@/features/api/symposiumApiClient";
import type {
  AssistantTranslationLanguageContract,
  ContentTranslationResultContract
} from "@/packages/contracts/src";

const languageLabels: Record<AssistantTranslationLanguageContract, string> = {
  english: "English",
  french: "French",
  german: "German",
  spanish: "Spanish"
};

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
            languageInstruction: languageLabels[language]
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
  const languageInputId = useId();
  const translated = state.result?.status === "translated";
  return (
    <div
      className={`content-translation-control content-translation-${sourceLabel}`}
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
          onClick={() => state.setOpen(!state.open)}
        >
          <Languages size={13} />
          {translated ? "Change" : "Translate"}
        </button>
      </div>
      {state.open ? (
        <form className="content-translation-menu" onSubmit={state.submit}>
          <header>
            <strong>Translate entire {sourceLabel}</strong>
            <button type="button" title="Close translation menu" onClick={() => state.setOpen(false)}><X size={14} /></button>
          </header>
          <label htmlFor={languageInputId}>Language</label>
          <select
            id={languageInputId}
            value={state.language}
            disabled={state.busy}
            onChange={(event) => state.setLanguage(event.target.value as AssistantTranslationLanguageContract)}
          >
            {Object.entries(languageLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
          <small>The original stays available. Saved translations reuse 0 answers.</small>
          {state.error ? <p role="alert">{state.error}</p> : null}
          <button type="submit" className="primary" disabled={state.busy}>
            {state.busy ? <LoaderCircle className="spin" size={14} /> : <Languages size={14} />}
            {state.busy ? "Translating entire text…" : "Translate · up to 1"}
          </button>
        </form>
      ) : null}
      {translated && state.result ? (
        <div className="content-translation-status" aria-live="polite">
          <CheckCircle2 size={13} />
          <span>{state.result.cached ? "Saved translation · 0 answers used" : `${state.result.targetLanguageLabel} translation ready`}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TranslatedContent({
  state,
  showTitle = true,
  titleAs: Heading = "h2"
}: {
  state: ContentTranslationState;
  showTitle?: boolean;
  titleAs?: "h1" | "h2" | "h3";
}) {
  if (!state.showTranslation || state.result?.status !== "translated") return null;
  return (
    <div className="content-translation-copy" lang={state.result.targetLanguage ?? undefined}>
      {showTitle ? <Heading>{state.result.translatedTitle}</Heading> : null}
      <div>{state.result.translatedBody}</div>
    </div>
  );
}
