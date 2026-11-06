import { tagSpellings } from "./tags";

/**
 * Tags offered while one is typed (`#ja` offers java): in the search box and
 * in the editors. Nothing is inserted unless a suggestion is taken.
 */

/** A tag of the library, as offered: its spelling and in how many notes it is. */
export type KnownTag = { readonly name: string; readonly spelling: string; readonly count: number };

/** How many suggestions are shown at most. */
const SHOWN = 8;

const NAME_CHAR = /^[\p{L}\p{N}_#-]/u;
// The tag rules (`parseTags`): "#" not after a letter, digit, "_" or "#"; a chain's last name.
const TYPED = /(?<![\p{L}\p{N}_#])#(?:[\p{L}\p{N}_-]+#)*([\p{L}\p{N}_-]+)$/u;

/**
 * The tag being typed before the caret, given the text of its line or block
 * before and after the caret: where the name being typed starts in `before`,
 * and that much of it. In a chain (`#java#co`) it is the last name. Null
 * when no tag is being typed, or the caret is inside a word.
 */
export function typedTag(before: string, after: string): { start: number; prefix: string } | null {
  if (NAME_CHAR.test(after)) return null;
  const prefix = TYPED.exec(before)?.[1];
  return prefix === undefined ? null : { start: before.length - prefix.length, prefix };
}

/** Each tag of the notes once (their tags as written), with its spelling and how many notes have it. */
export function knownTags(noteTags: Iterable<readonly string[]>): KnownTag[] {
  const notes = [...noteTags];
  const spellings = tagSpellings(notes);
  const counts = new Map<string, number>();
  for (const tags of notes) {
    for (const name of new Set(tags.map((tag) => tag.toLowerCase()))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, count]) => ({
    name,
    spelling: spellings.get(name) ?? name,
    count,
  }));
}

/**
 * The tags to offer for `prefix`, the name typed so far: only those starting
 * with it (the very tag first, then the ones in most notes, then by name), at
 * most eight. A tag merely containing it is not offered: `#ja` is not
 * `kotlin-java`.
 */
export function suggestTags(known: readonly KnownTag[], prefix: string): KnownTag[] {
  const typed = prefix.toLowerCase();
  if (typed === "") return [];
  const order = (a: KnownTag, b: KnownTag) =>
    Number(b.name === typed) - Number(a.name === typed) ||
    b.count - a.count ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return known
    .filter((tag) => tag.name.startsWith(typed))
    .sort(order)
    .slice(0, SHOWN);
}
