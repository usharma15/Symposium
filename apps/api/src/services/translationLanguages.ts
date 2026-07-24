import type { AssistantTranslationLanguageContract } from "../../../../packages/contracts/src";
import {
  assistantTranslationLanguageLabels,
  assistantTranslationLanguages
} from "../../../../packages/contracts/src/translationLanguages";

export const translationLanguageLabels = assistantTranslationLanguageLabels;

export const supportedTranslationLanguageList = assistantTranslationLanguages
  .map((language) => translationLanguageLabels[language])
  .join(", ");

export const unsupportedTranslationLanguageMessage =
  `Choose one of these languages: ${supportedTranslationLanguageList}. No AI answer was consumed.`;

const languageAliases: Record<AssistantTranslationLanguageContract, string[]> = {
  english: ["english", "anglais", "ingles", "englisch"],
  french: ["french", "francais", "franzosisch", "frances"],
  german: ["german", "deutsch", "allemand", "aleman"],
  spanish: ["spanish", "espanol", "spanisch", "espagnol"],
  hindi: ["hindi"],
  bengali: ["bengali", "bangla"],
  punjabi: ["punjabi", "panjabi", "gurmukhi"],
  marathi: ["marathi"],
  gujarati: ["gujarati", "gujrati"],
  telugu: ["telugu"],
  tamil: ["tamil"],
  greek: ["greek", "hellenic"],
  portuguese: ["portuguese", "portugues"],
  japanese: ["japanese", "nihongo"],
  korean: ["korean", "hangul"],
  simplified_chinese: ["simplified chinese", "chinese", "mandarin"],
  sanskrit: ["sanskrit"]
};

const normalizedInstruction = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z]+/g, " ")
  .trim();

export const supportedLanguageFromInstruction = (value: string): AssistantTranslationLanguageContract | null => {
  const instruction = ` ${normalizedInstruction(value)} `;
  const matches = (Object.entries(languageAliases) as Array<[AssistantTranslationLanguageContract, string[]]>)
    .filter(([, aliases]) => aliases.some((alias) => instruction.includes(` ${alias} `)))
    .map(([language]) => language);
  return matches.length === 1 ? matches[0]! : null;
};
