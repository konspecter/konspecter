/** Where a match is in the searched text: `from` inclusive, `to` exclusive (UTF-16 offsets). */
export type Match = { readonly from: number; readonly to: number };

/**
 * Every place `query` occurs in `text`, like a browser's Find: the whole query
 * as one phrase, anywhere in a word, ignoring case (Unicode-aware, so Cyrillic
 * works too). Matches do not overlap; a blank query matches nothing.
 */
export function findMatches(text: string, query: string): Match[] {
  if (query.trim() === "") return [];
  const needle = query.toLowerCase();
  // The text lower-cased character by character, with where each unit of
  // the lower-cased text ends in the original: lower-casing can change the
  // length (`İ` becomes two units), and matches are reported in the original.
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const lower = character.toLowerCase();
    folded += lower;
    for (let unit = 0; unit < lower.length; unit++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    offset += character.length;
  }
  const matches: Match[] = [];
  for (
    let at = folded.indexOf(needle);
    at !== -1;
    at = folded.indexOf(needle, at + needle.length)
  ) {
    const from = starts[at];
    const to = ends[at + needle.length - 1];
    if (from !== undefined && to !== undefined) matches.push({ from, to });
  }
  return matches;
}
