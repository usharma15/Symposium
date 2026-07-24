"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  assistantTranslationLanguageLabels,
  assistantTranslationLanguageOptions,
  type AssistantTranslationLanguageValue
} from "@/packages/contracts/src/translationLanguages";

const escapedPatternPart = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const translationLanguageSelectionPattern = assistantTranslationLanguageOptions
  .map((option) => escapedPatternPart(option.label))
  .join("|");

const normalizedSearch = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const translationLanguageSearchAliases: Partial<Record<AssistantTranslationLanguageValue, string>> = {
  bengali: "bangla",
  punjabi: "panjabi gurmukhi",
  gujarati: "gujrati",
  greek: "hellenic",
  portuguese: "portugues",
  japanese: "nihongo",
  korean: "hangul",
  simplified_chinese: "chinese mandarin zh hans"
};

export const filterTranslationLanguageOptions = (query: string) => {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return assistantTranslationLanguageOptions;
  return assistantTranslationLanguageOptions.filter((option) =>
    normalizedSearch(`${option.label} ${option.value} ${translationLanguageSearchAliases[option.value] ?? ""}`)
      .includes(normalizedQuery)
  );
};

export function TranslationLanguagePicker({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Search translation languages"
}: {
  value: AssistantTranslationLanguageValue;
  onChange: (language: AssistantTranslationLanguageValue) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedLabel = assistantTranslationLanguageLabels[value];
  const options = filterTranslationLanguageOptions(
    normalizedSearch(query) === normalizedSearch(selectedLabel) ? "" : query
  );

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length ? 0 : -1);
  }, [open, query, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setQuery("");
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listboxRef.current
      ?.querySelector<HTMLElement>(`[data-language-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, options.length]);

  const selectLanguage = (language: AssistantTranslationLanguageValue) => {
    onChange(language);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setQuery(selectedLabel);
        setOpen(true);
        return;
      }
      if (!options.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const startingIndex = current < 0 ? (direction > 0 ? -1 : 0) : current;
        return (startingIndex + direction + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      selectLanguage(options[activeIndex].value);
    }
  };

  return (
    <div className="translation-language-picker" ref={rootRef}>
      <div className={`translation-language-combobox${open ? " open" : ""}`}>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          pattern={translationLanguageSelectionPattern}
          required
          value={open ? query : selectedLabel}
          placeholder="Type to filter languages"
          onFocus={(event) => {
            setQuery(selectedLabel);
            setOpen(true);
            event.currentTarget.select();
          }}
          onClick={(event) => {
            if (!open) {
              setQuery(selectedLabel);
              setOpen(true);
              event.currentTarget.select();
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown size={15} aria-hidden="true" />
      </div>
      {open ? (
        <div
          className="translation-language-listbox"
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-label="Available translation languages"
        >
          {options.length ? options.map((option, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              data-language-option-index={index}
              type="button"
              role="option"
              key={option.value}
              className={`${value === option.value ? "selected" : ""}${activeIndex === index ? " active" : ""}`}
              aria-selected={value === option.value}
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectLanguage(option.value)}
            >
              <span>{option.label}</span>
              {value === option.value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          )) : (
            <p className="translation-language-empty">No languages found.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
