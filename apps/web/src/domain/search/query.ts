import { parseTagName, type Tag } from "../tag/tags";

/**
 * A parsed search query. Words are matched against note text, titles and tag
 * names; tags are strict filters (a note must be within every one).
 */
export type SearchQuery = {
  readonly words: readonly string[];
  readonly tags: readonly Tag[];
};

/**
 * Splits a query on whitespace. A token that starts with or contains `#` and
 * is a valid tag (`#java`, `java#collections`) becomes a tag filter; any other
 * token is a word (a lone `#` or `#123` is searched as text).
 */
export function parseQuery(input: string): SearchQuery {
  const words: string[] = [];
  const tags = new Map<string, Tag>();
  for (const token of input.split(/\s+/).filter((t) => t !== "")) {
    const tag = token.includes("#") ? parseTagName(token) : null;
    if (tag) {
      tags.set(tag.name, tag);
    } else {
      const word = token.replace(/^#+/, "");
      if (word !== "") words.push(word);
    }
  }
  return { words, tags: [...tags.values()] };
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return query.words.length === 0 && query.tags.length === 0;
}

/** The query text without the tokens that select `tag`. */
export function withoutTag(input: string, tag: Tag): string {
  return input
    .split(/\s+/)
    .filter(
      (token) => token !== "" && !(token.includes("#") && parseTagName(token)?.name === tag.name),
    )
    .join(" ");
}
