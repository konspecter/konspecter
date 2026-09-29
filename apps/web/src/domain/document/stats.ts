import { plainText } from "./plain-text";

export type DocumentStats = {
  /** Words in the readable text (letters or digits in any script; "don't" is one). */
  readonly words: number;
  /** Characters of readable text, line breaks not counted. */
  readonly characters: number;
  /** Minutes to read at 200 words a minute, at least 1 when there are words. */
  readonly readingMinutes: number;
};

const graphemes = new Intl.Segmenter();
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** How long a Markdown body is, counted on its readable text (see `plainText`). */
export function documentStats(body: string): DocumentStats {
  const text = plainText(body);
  const words = text.match(WORD)?.length ?? 0;
  return {
    words,
    characters: [...graphemes.segment(text.replaceAll("\n", ""))].length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)),
  };
}
