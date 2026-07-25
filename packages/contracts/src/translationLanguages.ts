export const assistantTranslationLanguages = [
  "bengali",
  "english",
  "french",
  "german",
  "greek",
  "gujarati",
  "hindi",
  "japanese",
  "korean",
  "marathi",
  "portuguese",
  "punjabi",
  "sanskrit",
  "simplified_chinese",
  "spanish",
  "tamil",
  "telugu"
] as const;

export type AssistantTranslationLanguageValue = typeof assistantTranslationLanguages[number];

export const assistantTranslationLanguageLabels: Record<AssistantTranslationLanguageValue, string> = {
  english: "English",
  french: "French",
  german: "German",
  spanish: "Spanish",
  hindi: "Hindi",
  bengali: "Bengali",
  punjabi: "Punjabi",
  marathi: "Marathi",
  gujarati: "Gujarati",
  telugu: "Telugu",
  tamil: "Tamil",
  greek: "Greek",
  portuguese: "Portuguese",
  japanese: "Japanese",
  korean: "Korean",
  simplified_chinese: "Simplified Chinese",
  sanskrit: "Sanskrit (experimental)"
};

export const assistantTranslationLanguageCodes: Record<AssistantTranslationLanguageValue, string> = {
  english: "en",
  french: "fr",
  german: "de",
  spanish: "es",
  hindi: "hi",
  bengali: "bn",
  punjabi: "pa-Guru",
  marathi: "mr",
  gujarati: "gu",
  telugu: "te",
  tamil: "ta",
  greek: "el",
  portuguese: "pt",
  japanese: "ja",
  korean: "ko",
  simplified_chinese: "zh-Hans",
  sanskrit: "sa"
};

export const assistantTranslationLanguageOptions = assistantTranslationLanguages.map((value) => ({
  value,
  label: assistantTranslationLanguageLabels[value],
  experimental: value === "sanskrit"
}));
