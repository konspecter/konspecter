import type { IDBPDatabase, IDBPTransaction } from "idb";
import { noteWrittenTags, parseNote, readNote, type Note } from "../../domain/note/note";
import { parseTagName, tagSpellings, tagWithAncestors, type Tag } from "../../domain/tag/tags";
import type { KonspecterDb } from "./schema";

/**
 * Bump when the tag rules or the entry shape change. Stores built by another
 * version are rebuilt from the notes when the database is opened.
 */
export const TAG_INDEX_VERSION = 3;

/** Derived data: which tags a note has. Always rebuildable from the notes. */
export type TagEntry = {
  readonly noteId: string;
  /** Tags written in the note. */
  readonly tags: readonly string[];
  /** The same tags as written, case kept, for display ("Java#Streams"). */
  readonly written: readonly string[];
  /** The tags plus all their ancestors; indexed (multiEntry) for tag → notes. */
  readonly memberOf: readonly string[];
};

export type TagCount = {
  readonly tag: Tag;
  /** Notes tagged with this tag or any tag below it. */
  readonly count: number;
  /** How the notes write it (`tagSpellings`). */
  readonly spelling: string;
};

type WriteTransaction = IDBPTransaction<KonspecterDb, ("notes" | "tags" | "meta")[], "readwrite">;

export function tagEntry(note: Note): TagEntry {
  const written = noteWrittenTags(readNote(note));
  const tags = written.flatMap((tag) => parseTagName(tag) ?? []);
  const memberOf = new Set(tags.flatMap((tag) => tagWithAncestors(tag).map((t) => t.name)));
  return { noteId: note.id, tags: tags.map((tag) => tag.name), written, memberOf: [...memberOf] };
}

/** Every tag in the entries, each counting the notes within it, sorted by name. */
export function countTags(entries: Iterable<TagEntry>): TagCount[] {
  const list = [...entries];
  const counts = new Map<string, number>();
  for (const entry of list) {
    for (const name of entry.memberOf) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const spellings = tagSpellings(list.map((entry) => entry.written));
  return [...counts]
    .map(([name, count]) => ({
      tag: { path: name.split("#"), name },
      count,
      spelling: spellings.get(name) ?? name,
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
    const { noteId, tags, written, memberOf } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof noteId !== "string" ||
      !Array.isArray(tags) ||
      !Array.isArray(written) ||
      !Array.isArray(memberOf)
    )
      return false;
    indexed.add(noteId);
  }
  // Every entry must belong to a note. (Records that are not notes have no entry.)
  return [...indexed].every((id) => noted.has(id)) && indexed.size <= noted.size;
}

/** Every tag in use, each counting the notes within it, sorted by name. */
export async function allTags(db: IDBPDatabase<KonspecterDb>): Promise<TagCount[]> {
  return countTags(await db.getAll("tags"));
}

/** Ids of the notes tagged with `tag` or any tag below it. */
export async function noteIdsWithTag(db: IDBPDatabase<KonspecterDb>, tag: Tag): Promise<string[]> {
  const keys = await db.getAllKeysFromIndex("tags", "memberOf", tag.name);
  return keys.filter((key): key is string => typeof key === "string");
}
