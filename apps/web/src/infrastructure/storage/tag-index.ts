import type { IDBPDatabase, IDBPTransaction } from "idb";
import { noteTags, noteWrittenTags, parseNote, readNote, type Note } from "../../domain/note/note";
import {
  chainLinks,
  parseTagChain,
  tagSpellings,
  type NoteChain,
  type Tag,
} from "../../domain/tag/tags";
import type { KonspecterDb } from "./schema";

/**
 * Bump when the tag rules or the entry shape change. Stores built by another
 * version are rebuilt from the notes when the database is opened.
 */
export const TAG_INDEX_VERSION = 4;

/** Derived data: which tags a note has. Always rebuildable from the notes. */
export type TagEntry = {
  readonly noteId: string;
  /** The tag chains written in the note, case kept ("Java#Streams"): spellings and parents. */
  readonly written: readonly string[];
  /** The note's tags ("java", "streams"); indexed (multiEntry) for tag → notes. */
  readonly memberOf: readonly string[];
};

export type TagCount = {
  readonly tag: Tag;
  /** Notes tagged with this tag. */
  readonly count: number;
  /** How the notes write it (`tagSpellings`). */
  readonly spelling: string;
  /** The tags written right before it in a chain, in any note, by name. */
  readonly parents: readonly string[];
  /** The notes' chains that end in it: where the tag tree puts the notes. */
  readonly chains: readonly NoteChain[];
};

type WriteTransaction = IDBPTransaction<KonspecterDb, ("notes" | "tags" | "meta")[], "readwrite">;

export function tagEntry(note: Note): TagEntry {
  const read = readNote(note);
  const memberOf = noteTags(read).map((tag) => tag.name);
  return { noteId: note.id, written: noteWrittenTags(read), memberOf };
}

/** Every tag in the entries, with the notes tagged with it and its parents, sorted by name. */
export function countTags(entries: Iterable<TagEntry>): TagCount[] {
  const list = [...entries];
  const counts = new Map<string, number>();
  const parents = new Map<string, Set<string>>();
  const chains = new Map<string, NoteChain[]>();
  for (const entry of list) {
    for (const name of entry.memberOf) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const written of entry.written) {
      const chain = parseTagChain(written);
      if (!chain) continue;
      for (const [parent, child] of chainLinks(chain)) {
        parents.set(child, (parents.get(child) ?? new Set()).add(parent));
      }
      const tags = chain.tags.map((tag) => tag.name);
      const last = tags.at(-1);
      if (last !== undefined) {
        chains.set(last, [...(chains.get(last) ?? []), { noteId: entry.noteId, tags }]);
      }
    }
  }
  const spellings = tagSpellings(list.map((entry) => entry.written));
  return [...counts]
    .map(([name, count]) => ({
      tag: { name },
      count,
      spelling: spellings.get(name) ?? name,
      parents: [...(parents.get(name) ?? [])].sort(),
      chains: chains.get(name) ?? [],
    }))
    .sort((a, b) => (a.tag.name < b.tag.name ? -1 : a.tag.name > b.tag.name ? 1 : 0));
}

/** Recomputes every entry from the notes, inside one transaction. */
export async function rebuildTagIndex(db: IDBPDatabase<KonspecterDb>): Promise<void> {
  const tx = db.transaction(["notes", "tags", "meta"], "readwrite");
  await rebuildInTransaction(tx);
  await tx.done;
}

async function rebuildInTransaction(tx: WriteTransaction): Promise<void> {
  const records = await tx.objectStore("notes").getAll();
  const tags = tx.objectStore("tags");
  await tags.clear();
  const writes: Promise<unknown>[] = [];
  for (const record of records) {
    let note: Note;
    try {
      note = parseNote(record);
    } catch {
      continue; // Not a note; reads report it. There is nothing to index.
    }
    writes.push(tags.put(tagEntry(note)));
  }
  writes.push(tx.objectStore("meta").put(TAG_INDEX_VERSION, "tagIndexVersion"));
  await Promise.all(writes);
}

/**
 * Rebuilds the index if it was built by another version (or never), or if it
 * no longer matches the notes: an entry without a note, or a note without an
 * entry. A damaged index therefore repairs itself on the next start.
 */
export async function ensureTagIndex(db: IDBPDatabase<KonspecterDb>): Promise<void> {
  const version = await db.get("meta", "tagIndexVersion");
  if (version !== TAG_INDEX_VERSION || !(await indexMatchesNotes(db))) {
    await rebuildTagIndex(db);
  }
}

async function indexMatchesNotes(db: IDBPDatabase<KonspecterDb>): Promise<boolean> {
  const [noteKeys, entries] = await Promise.all([db.getAllKeys("notes"), db.getAll("tags")]);
  const noted = new Set(noteKeys.map(String));
  const indexed = new Set<string>();
  for (const entry of entries as unknown[]) {
    const { noteId, written, memberOf } = (entry ?? {}) as Record<string, unknown>;
    if (typeof noteId !== "string" || !Array.isArray(written) || !Array.isArray(memberOf))
      return false;
    indexed.add(noteId);
  }
  // Every entry must belong to a note. (Records that are not notes have no entry.)
  return [...indexed].every((id) => noted.has(id)) && indexed.size <= noted.size;
}

/** Every tag in use, with the notes tagged with it and its parents, sorted by name. */
export async function allTags(db: IDBPDatabase<KonspecterDb>): Promise<TagCount[]> {
  return countTags(await db.getAll("tags"));
}

/** Ids of the notes tagged with `tag`. */
export async function noteIdsWithTag(db: IDBPDatabase<KonspecterDb>, tag: Tag): Promise<string[]> {
  const keys = await db.getAllKeysFromIndex("tags", "memberOf", tag.name);
  return keys.filter((key): key is string => typeof key === "string");
}
