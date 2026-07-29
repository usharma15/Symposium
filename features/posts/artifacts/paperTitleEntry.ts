export type PaperTitleDirection = "ltr" | "rtl";

export type PaperTitleEntry = {
  direction: PaperTitleDirection;
  end: number;
  grapheme: string;
  start: number;
};

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const NON_WHITESPACE = /\S/u;
const RTL_CHARACTER =
  /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u;

const segmentTitle = (title: string) => {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(title), ({ index, segment }) => ({ index, segment }));
  }

  let index = 0;
  return Array.from(title, (segment) => {
    const result = { index, segment };
    index += segment.length;
    return result;
  });
};

const titleDirection = (title: string): PaperTitleDirection => {
  for (const character of title) {
    if (!LETTER.test(character)) continue;
    return RTL_CHARACTER.test(character) ? "rtl" : "ltr";
  }
  return RTL_CHARACTER.test(title) ? "rtl" : "ltr";
};

/**
 * Returns UTF-16 DOM offsets for the first semantic grapheme without splitting
 * the title's shaped text run.
 */
export const paperTitleEntry = (title: string): PaperTitleEntry => {
  const segments = segmentTitle(title);
  const selected =
    segments.find(({ segment }) => LETTER_OR_NUMBER.test(segment)) ??
    segments.find(({ segment }) => NON_WHITESPACE.test(segment)) ??
    segments[0];

  if (!selected) return { direction: "ltr", end: 0, grapheme: "", start: 0 };
  return {
    direction: titleDirection(title),
    end: selected.index + selected.segment.length,
    grapheme: selected.segment,
    start: selected.index
  };
};
