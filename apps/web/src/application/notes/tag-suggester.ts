import { knownTags, suggestTags, type KnownTag } from "../../domain/tag/tag-suggestions";
import type { NoteCatalog } from "./note-catalog";

/** The tags to offer for a name being typed; `except` leaves out a note's own tags. */
export type SuggestTags = (prefix: string, except?: string | null) => KnownTag[];

/**
 * Offers the library's tags (`suggestTags`) from the catalog's latest notes,
 * worked out again only when they changed. The open note is left out where
 * its tags are typed: a tag half typed, saved by a pause, is not offered back.
 */
export function tagSuggester(catalog: NoteCatalog): SuggestTags {
  let cached: { notes: unknown; except: string | null; known: KnownTag[] } | null = null;
  return (prefix, except = null) => {
    const library = catalog.getSnapshot();
    if (library.status !== "ready") return [];
    if (cached?.notes !== library.notes || cached.except !== except) {
      const notes = library.notes.filter((note) => note.id !== except);
      cached = { notes: library.notes, except, known: knownTags(notes.map((note) => note.tags)) };
    }
    return suggestTags(cached.known, prefix);
  };
}
