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

/** A token that is a tag filter (`#java`, `java#collections`), as `parseQuery` reads it. */
function tokenTag(token: string): Tag | null {
  return token.includes("#") ? parseTagName(token) : null;
}

/** A query as the search box shows it: its tag filters, and the rest of the text. */
export type QueryParts = { readonly tags: readonly Tag[]; readonly text: string };

/** Every tag filter in `input`, and the other words in order. */
export function queryParts(input: string): QueryParts {
  const tags = new Map<string, Tag>();
  const words: string[] = [];
  for (const token of input.split(/\s+/).filter((t) => t !== "")) {
    const tag = tokenTag(token);
    if (tag) tags.set(tag.name, tag);
    else words.push(token);
  }
  return { tags: [...tags.values()], text: words.join(" ") };
}

/**
 * While typing: the tags written in full, that is followed by a space, move
 * out of `text` (to become chips); a tag still being typed stays in it.
 */
export function takeTags(text: string): QueryParts {
  const tokens = text.split(/(\s+)/);
  const tags = new Map<string, Tag>();
  const kept: string[] = [];
  tokens.forEach((token, index) => {
    const complete = index + 1 < tokens.length; // a separator follows
    const tag = complete ? tokenTag(token) : null;
    if (tag) tags.set(tag.name, tag);
    else if (!/^\s+$/.test(token) && token !== "") kept.push(token);
  });
  const rest = kept.join(" ");
  const trailing = /\s$/.test(text) && rest !== "" ? " " : "";
  return { tags: [...tags.values()], text: rest + trailing };
}

/** The query text for tag filters and other text: tags first, as `#name`. */
export function joinQuery(tags: readonly Tag[], text: string): string {
  return [...tags.map((tag) => `#${tag.name}`), text].filter((part) => part !== "").join(" ");
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
