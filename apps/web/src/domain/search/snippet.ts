export type SnippetPart = { readonly text: string; readonly match: boolean };

/**
 * A short excerpt of `text` around the first match of any of `terms`
 * (case-insensitive, matched as word prefixes), split into matching and
 * non-matching parts so the UI can highlight without building HTML.
 */
export function snippet(text: string, terms: readonly string[], maxLength = 180): SnippetPart[] {
  const flat = text.replace(/\s+/g, " ").trim();
  const pattern = termPattern(terms);
  const first = pattern ? flat.search(pattern) : -1;

  let start = 0;
  if (first > maxLength / 3) {
    // Start at a word boundary a little before the first match.
    const from = first - Math.floor(maxLength / 3);
    const space = flat.indexOf(" ", from);
    start = space === -1 || space >= first ? from : space + 1;
  }
  let end = Math.min(flat.length, start + maxLength);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > start) end = space;
  }

  const excerpt = flat.slice(start, end);
  const parts = pattern ? split(excerpt, pattern) : [{ text: excerpt, match: false }];
  if (start > 0) parts.unshift({ text: "…", match: false });
  if (end < flat.length) parts.push({ text: "…", match: false });
  return parts.filter((part) => part.text !== "");
}

/**
 * The whole of `text`, split into matching and non-matching parts with the
 * same rule as `snippet` (for titles, which are shown in full).
 */
export function highlight(text: string, terms: readonly string[]): SnippetPart[] {
  const pattern = termPattern(terms);
  const parts = pattern ? split(text, pattern) : [{ text, match: false }];
  return parts.filter((part) => part.text !== "");
}

function termPattern(terms: readonly string[]): RegExp | null {
  const escaped = [...new Set(terms.map((term) => term.trim().toLowerCase()))]
    .filter((term) => term !== "")
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escaped.length === 0
    ? null
    : new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})[\\p{L}\\p{N}_]*`, "giu");
}

function split(text: string, pattern: RegExp): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push({ text: text.slice(last, match.index), match: false });
    parts.push({ text: match[0], match: true });
    last = match.index + match[0].length;
  }
  parts.push({ text: text.slice(last), match: false });
  return parts;
}
