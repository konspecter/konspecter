import MiniSearch, { type SearchResult } from "minisearch";
import { documentTitle } from "../../domain/document/document";
import { plainText } from "../../domain/document/plain-text";
import { noteTags, noteUpdated, readNote, type Note } from "../../domain/note/note";
import { isEmptyQuery, type SearchQuery } from "../../domain/search/query";
import { tagWithAncestors } from "../../domain/tag/tags";

type IndexedNote = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** Tag names and their ancestors, space-separated: "java java#collections". */
  readonly tags: string;
  readonly updated: string;
};

export type SearchHit = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly updated: string;
  readonly score: number;
  /** The indexed terms that matched, for highlighting. */
  readonly terms: readonly string[];
};

function toIndexed(note: Note): IndexedNote {
  const read = readNote(note);
  if (!read.valid) {
    // Still findable: index the raw text.
    return { id: note.id, title: "", text: note.markdown, tags: "", updated: "" };
  }
  const memberOf = new Set(
    noteTags(read).flatMap((tag) => tagWithAncestors(tag).map((ancestor) => ancestor.name)),
  );
  return {
    id: note.id,
    title: documentTitle(read.document),
    text: plainText(read.document.body),
    tags: [...memberOf].join(" "),
    updated: noteUpdated(read) ?? "",
  };
}

/**
 * In-memory full-text index over note titles and text (BM25 via MiniSearch).
 * Derived data: rebuilt from the notes whenever it is created.
 */
export class SearchIndex {
  readonly #index = new MiniSearch<IndexedNote>({
    fields: ["title", "text", "tags"],
    storeFields: ["title", "text", "tags", "updated"],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      // Tolerate a typo in words of five letters or more.
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      combineWith: "AND",
    },
  });

  constructor(notes: readonly Note[] = []) {
    this.#index.addAll(notes.map(toIndexed));
  }

  /**
   * Builds the index in chunks, yielding to the event loop between them, so a
   * large library does not freeze the page (measured: docs/performance.md).
   */
  static async build(notes: readonly Note[], chunkSize = 150): Promise<SearchIndex> {
    const index = new SearchIndex();
    for (let start = 0; start < notes.length; start += chunkSize) {
      index.#index.addAll(notes.slice(start, start + chunkSize).map(toIndexed));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return index;
  }

  upsert(note: Note): void {
    if (this.#index.has(note.id)) this.#index.discard(note.id);
    this.#index.add(toIndexed(note));
  }

  remove(id: string): void {
    if (this.#index.has(id)) this.#index.discard(id);
  }

  /**
   * Words must all match (title, text or tag names); the note must be within
   * every tag filter. Best matches first; equal scores by most recently
   * updated, then id. Filter-only queries list all matching notes.
   */
  search(query: SearchQuery, limit = 50): SearchHit[] {
    if (isEmptyQuery(query)) return [];
    const filter =
      query.tags.length === 0
        ? undefined
        : (result: SearchResult) => {
            const memberOf = String(result["tags"] ?? "").split(" ");
            return query.tags.every((tag) => memberOf.includes(tag.name));
          };
    const terms = query.words.length === 0 ? MiniSearch.wildcard : query.words.join(" ");
    return this.#index
      .search(terms, filter ? { filter } : {})
      .map((result) => ({
        id: String(result.id),
        title: String(result.title ?? ""),
        text: String(result.text ?? ""),
        updated: String(result.updated ?? ""),
        score: result.score,
        terms: result.terms,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, limit);
  }
}
