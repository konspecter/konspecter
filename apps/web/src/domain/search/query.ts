import { parseTagChain, type Tag } from "../tag/tags";

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
 * is a valid tag or chain (`#java`, `java#collections`) becomes a tag filter
 * per tag; any other token is a word (a lone `#` or `#123` is searched as
 * text).
 */
export function parseQuery(input: string): SearchQuery {
  const words: string[] = [];
  const tags = new Map<string, Tag>();
  for (const token of input.split(/\s+/).filter((t) => t !== "")) {
    const tokenTags = tagsOf(token);
    if (tokenTags) {
      for (const tag of tokenTags) tags.set(tag.name, tag);
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

/**
 * The tag filters of a token (`#java`; `java#collections` is two), as
 * `parseQuery` reads it; null for a word.
 */
function tagsOf(token: string): readonly Tag[] | null {
  return token.includes("#") ? (parseTagChain(token)?.tags ?? null) : null;
}

/** A query as the search box shows it: its tag filters, and the rest of the text. */
export type QueryParts = { readonly tags: readonly Tag[]; readonly text: string };

/** Every tag filter in `input`, and the other words in order. */
export function queryParts(input: string): QueryParts {
  const tags = new Map<string, Tag>();
  const words: string[] = [];
  for (const token of input.split(/\s+/).filter((t) => t !== "")) {
    const tokenTags = tagsOf(token);
    if (tokenTags) for (const tag of tokenTags) tags.set(tag.name, tag);
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
    const tokenTags = complete ? tagsOf(token) : null;
    if (tokenTags) for (const tag of tokenTags) tags.set(tag.name, tag);
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

/**
 * The query text without the filter `tag`. A chain that selects it keeps its
 * other tags, as separate filters.
 */
export function withoutTag(input: string, tag: Tag): string {
  return input
    .split(/\s+/)
    .filter((token) => token !== "")
    .flatMap((token) => {
      const tokenTags = tagsOf(token);
      if (!tokenTags?.some((other) => other.name === tag.name)) return [token];
      return tokenTags.filter((other) => other.name !== tag.name).map((other) => `#${other.name}`);
    })
    .join(" ");
}
