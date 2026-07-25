import {
  assistantTranslationLanguageOptions,
  type AssistantTranslationLanguageValue
} from "@/packages/contracts/src/translationLanguages";

const languageAliases: Partial<Record<AssistantTranslationLanguageValue, string[]>> = {
  simplified_chinese: ["simplified chinese", "chinese"]
};

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const assistantRequestIntentFor = (message: string): {
  translationRequested: boolean;
  intent: "answer" | "translate";
  targetLanguage?: AssistantTranslationLanguageValue;
} => {
  const normalized = message.toLocaleLowerCase();
  const translationRequested = /\btranslat(?:e|es|ed|ing)\b/.test(normalized)
    || /\btranslation\s+(?:in|into|to)\b/.test(normalized);
  if (!translationRequested) return { translationRequested: false, intent: "answer" };

  const candidates = assistantTranslationLanguageOptions.flatMap(({ value, label }) => {
    const aliases = languageAliases[value] ?? [
      label.toLocaleLowerCase().replace(/\s*\(.*\)\s*$/, "")
    ];
    return aliases.flatMap((alias) => {
      const match = new RegExp(`\\b${escaped(alias)}\\b`, "g");
      return Array.from(normalized.matchAll(match), (entry) => ({
        value,
        index: entry.index ?? -1,
        targeted: /\b(?:in|into|to)\s+(?:(?:plain|modern|formal|academic)\s+)?$/.test(
          normalized.slice(Math.max(0, (entry.index ?? 0) - 24), entry.index)
        )
      }));
    });
  });
  const targetLanguage = candidates.sort((left, right) =>
    Number(right.targeted) - Number(left.targeted) || right.index - left.index
  )[0]?.value;
  return targetLanguage
    ? { translationRequested: true, intent: "translate", targetLanguage }
    : { translationRequested: true, intent: "answer" };
};
