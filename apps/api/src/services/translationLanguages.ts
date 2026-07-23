import type { AssistantTranslationLanguageContract } from "../../../../packages/contracts/src";

export const translationLanguageLabels: Record<AssistantTranslationLanguageContract, string> = {
  english: "English",
  french: "French",
  german: "German",
  spanish: "Spanish"
};

const languageAliases: Record<AssistantTranslationLanguageContract, string[]> = {
  english: ["english", "anglais", "ingles", "englisch"],
  french: ["french", "francais", "franzosisch", "frances"],
  german: ["german", "deutsch", "allemand", "aleman"],
  spanish: ["spanish", "espanol", "spanisch", "espagnol"]
};

const normalizedInstruction = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z]+/g, " ")
  .trim();

export const supportedLanguageFromInstruction = (value: string): AssistantTranslationLanguageContract | null => {
  const words = new Set(normalizedInstruction(value).split(/\s+/).filter(Boolean));
  const matches = (Object.entries(languageAliases) as Array<[AssistantTranslationLanguageContract, string[]]>)
    .filter(([, aliases]) => aliases.some((alias) => words.has(alias)))
    .map(([language]) => language);
  return matches.length === 1 ? matches[0]! : null;
};
