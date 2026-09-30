import { openDB, type IDBPDatabase, type IDBPObjectStore, type StoreNames } from "idb";
import { formatTimestamp, parseDocument, updateMetadata } from "../../domain/document/document";
import type { NoteRepository, UnreadableRecord } from "../../application/notes/note-repository";
import { createNote, parseNote, type Note } from "../../domain/note/note";
import type { Resolution } from "../../domain/sync/conflicts";
import type { Tag } from "../../domain/tag/tags";
import {
  parseReadingState,
  type EditorSelection,
  type ReadingState,
} from "../../domain/reading/reading";
import type { SearchQuery } from "../../domain/search/query";
import { parseSettings, type Settings } from "../../domain/settings/settings";
import {
  isPending,
  parseSyncEntry,
  type RemoteNote,
  type SyncBlock,
  type SyncEntry,
} from "../../domain/sync/sync-state";
import { SearchIndex, type SearchHit } from "../search/search-index";
import {
  allTags,
  ensureTagIndex,
  noteIdsWithTag,
  rebuildTagIndex,
  tagEntry,
  type TagCount,
} from "./tag-index";
import type { KonspecterDb } from "./schema";

const DEFAULT_DATABASE_NAME = "konspecter";

/**
 * 1: records were { id, markdown, createdAt, updatedAt }.
 * 2: records are { id, markdown }; the dates live in the document's frontmatter.
 * 3: adds the derived tag index (`tags`) and `meta`.
 * 4: adds reading positions (`reading`).
 * 5: adds sync bookkeeping (`sync`).
 */
const DATABASE_VERSION = 5;

export type StoreChange = { readonly noteId: string; readonly source: "local" | "remote" };

/** What happened to a note received from the server. */
export type RemoteApplyResult = "applied" | "unchanged" | "conflict";

/**
 * Notes kept in the browser's IndexedDB, with derived indexes kept in step.
 * Every record read is validated.
 */
export class NoteStore implements NoteRepository {
  readonly #db: IDBPDatabase<KonspecterDb>;
  /** Built on the first search, then kept in step with every write. */
  #search: Promise<SearchIndex> | null = null;
  readonly #listeners = new Set<(change: StoreChange) => void>();

  constructor(db: IDBPDatabase<KonspecterDb>) {
    this.#db = db;
  }

  /**
   * All readable notes, in no particular order. Records that fail validation
   * are left untouched and reported by unreadableRecords(), so one damaged
   * record never hides the rest of the library.
   */
  async list(): Promise<Note[]> {
    const records = await this.#db.getAll("notes");
    return records.flatMap((record) => {
      try {
        return [parseNote(record)];
      } catch {
        return [];
      }
    });
  }

  async unreadableRecords(): Promise<UnreadableRecord[]> {
    const tx = this.#db.transaction("notes");
    const unreadable: UnreadableRecord[] = [];
    let cursor = await tx.store.openCursor();
    while (cursor) {
      try {
        parseNote(cursor.value);
      } catch (error) {
        unreadable.push({
          key: cursor.key,
          value: cursor.value,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      cursor = await cursor.continue();
    }
    return unreadable;
  }

  async removeUnreadable(keys: readonly string[]): Promise<void> {
    const unreadable = new Set((await this.unreadableRecords()).map((record) => record.key));
    const tx = this.#db.transaction(["notes", "tags", "sync"], "readwrite");
    await Promise.all([
      ...keys
        .filter((key) => unreadable.has(key)) // Never removes a readable note.
        .flatMap((key) => [
          tx.objectStore("notes").delete(key),
          tx.objectStore("tags").delete(key),
          tx.objectStore("sync").delete(key),
        ]),
      tx.done,
    ]);
  }

  async get(id: string): Promise<Note | undefined> {
    const record = await this.#db.get("notes", id);
    return record === undefined ? undefined : parseNote(record);
  }

  async create(markdown: string, now: Date): Promise<Note> {
    const note = createNote(markdown, now);
    await this.put(note);
    return note;
  }

  /**
   * Creates or replaces the note (a local edit): updates its index entry and
   * queues it for sync, all in one transaction.
   */
  async put(note: Note): Promise<Note> {
    const tx = this.#db.transaction(["notes", "tags", "sync"], "readwrite");
    const sync = tx.objectStore("sync");
    const entry = await readEntry(sync.get(note.id));
    await Promise.all([
      tx.objectStore("notes").put({ id: note.id, markdown: note.markdown }, note.id),
      tx.objectStore("tags").put(tagEntry(note)),
      sync.put(
        {
          noteId: note.id,
          baseRevision: entry?.baseRevision ?? null,
          dirty: true,
          deleted: false,
          blocked: entry?.blocked ?? null,
        } satisfies SyncEntry,
        note.id,
      ),
      tx.done,
    ]);
    (await this.#search)?.upsert(note);
    this.#emit({ noteId: note.id, source: "local" });
    return note;
  }

  /**
   * Deletes the note locally. If the server has it, a deletion is queued;
   * a note that never reached the server is simply forgotten.
   */
  async delete(id: string): Promise<void> {
    const tx = this.#db.transaction(["notes", "tags", "reading", "sync"], "readwrite");
    const sync = tx.objectStore("sync");
    const entry = await readEntry(sync.get(id));
    const queueDeletion = entry?.baseRevision !== null && entry?.baseRevision !== undefined;
    await Promise.all([
      tx.objectStore("notes").delete(id),
      tx.objectStore("tags").delete(id),
      tx.objectStore("reading").delete(id),
      queueDeletion
        ? sync.put({ ...entry, dirty: true, deleted: true } satisfies SyncEntry, id)
        : sync.delete(id),
      tx.done,
    ]);
    (await this.#search)?.remove(id);
    this.#emit({ noteId: id, source: "local" });
  }

  /** Notifies `listener` of every change to a note. Returns an unsubscribe function. */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(change: StoreChange): void {
    for (const listener of this.#listeners) listener(change);
  }

  // --- Sync bookkeeping -------------------------------------------------

  /** Notes whose local changes should be pushed. */
  async pendingSync(): Promise<SyncEntry[]> {
    const entries = await this.syncEntries();
    return entries.filter(isPending);
  }

  async syncEntries(): Promise<SyncEntry[]> {
    const records = await this.#db.getAll("sync");
    return records.map(parseSyncEntry);
  }

  async syncEntry(noteId: string): Promise<SyncEntry | null> {
    return readEntry(this.#db.get("sync", noteId));
  }

  /**
   * Records a successful push. If the note was edited again while the push
   * was in flight, it stays queued, now based on the new revision.
   */
  async markPushed(noteId: string, result: { revision: number; markdown: string } | "deleted") {
    const tx = this.#db.transaction(["notes", "sync"], "readwrite");
    const sync = tx.objectStore("sync");
    if (result === "deleted") {
      await Promise.all([sync.delete(noteId), tx.done]);
      return;
    }
    const current = await tx.objectStore("notes").get(noteId);
    const entry = await readEntry(sync.get(noteId));
    if (current === undefined || entry === null) {
      await tx.done;
      return; // Deleted locally meanwhile; the deletion is queued separately.
    }
    const unchanged = parseNote(current).markdown === result.markdown;
    await Promise.all([
      sync.put({ ...entry, baseRevision: result.revision, dirty: !unchanged }, noteId),
      tx.done,
    ]);
  }

  /** Stops syncing a note until the block is cleared. Nothing is discarded. */
  async blockSync(noteId: string, blocked: SyncBlock): Promise<void> {
    const tx = this.#db.transaction("sync", "readwrite");
    const entry = await readEntry(tx.store.get(noteId));
    if (entry) {
      await Promise.all([tx.store.put({ ...entry, blocked }, noteId), tx.done]);
    } else {
      await tx.done;
    }
  }

  /**
   * Applies a note received from the server, unless the local copy has
   * changes of its own: then it is a conflict, and the server version is kept
   * in the sync entry until the cycle settles it (the later edit wins).
   */
  async applyRemote(remote: RemoteNote): Promise<RemoteApplyResult> {
    const tx = this.#db.transaction(["notes", "tags", "reading", "sync"], "readwrite");
    const sync = tx.objectStore("sync");
    const entry = await readEntry(sync.get(remote.id));

    if (entry?.baseRevision === remote.revision && !entry.dirty) {
      await tx.done;
      return "unchanged"; // Our own change coming back, or already applied.
    }
    if (entry?.dirty && entry.deleted && remote.deleted) {
      await Promise.all([sync.delete(remote.id), tx.done]);
      return "applied"; // Deleted on both sides: nothing left to sync.
    }
    if (entry?.dirty) {
      const alreadyKnown = entry.baseRevision !== null && entry.baseRevision >= remote.revision;
      if (!alreadyKnown) {
        await sync.put({ ...entry, blocked: { reason: "conflict", remote } }, remote.id);
      }
      await tx.done;
      return alreadyKnown ? "unchanged" : "conflict";
    }

    if (remote.deleted) {
      await Promise.all([
        tx.objectStore("notes").delete(remote.id),
        tx.objectStore("tags").delete(remote.id),
        tx.objectStore("reading").delete(remote.id),
        sync.delete(remote.id),
        tx.done,
      ]);
      (await this.#search)?.remove(remote.id);
    } else {
      const note: Note = { id: remote.id, markdown: remote.markdown };
      await Promise.all([
        tx.objectStore("notes").put(note, note.id),
        tx.objectStore("tags").put(tagEntry(note)),
        sync.put(
          {
            noteId: note.id,
            baseRevision: remote.revision,
            dirty: false,
            deleted: false,
            blocked: null,
          } satisfies SyncEntry,
          note.id,
        ),
        tx.done,
      ]);
      (await this.#search)?.upsert(note);
    }
    this.#emit({ noteId: remote.id, source: "remote" });
    return "applied";
  }

  /**
   * Settles a conflict (see domain/sync/conflicts.ts) in one transaction: the
   * note takes the server's version, or the local version is queued again on
   * top of it (created anew if the server has none).
   */
  async applyResolution(noteId: string, resolution: Resolution): Promise<void> {
    const { remote } = resolution;
    const tx = this.#db.transaction(["notes", "tags", "reading", "sync"], "readwrite");
    const notes = tx.objectStore("notes");
    const tags = tx.objectStore("tags");
    const sync = tx.objectStore("sync");
    if (resolution.kind === "keep-local") {
      const entry = await readEntry(sync.get(noteId));
      if (entry === null) {
        await tx.done;
        return;
      }
      const baseRevision = remote.revision > 0 ? remote.revision : null;
      await Promise.all([
        sync.put(
          { ...entry, baseRevision, dirty: true, blocked: null } satisfies SyncEntry,
          noteId,
        ),
        tx.done,
      ]);
      return;
    }
    if (remote.deleted) {
      await Promise.all([
        notes.delete(noteId),
        tags.delete(noteId),
        tx.objectStore("reading").delete(noteId),
        sync.delete(noteId),
        tx.done,
      ]);
    } else {
      const note: Note = { id: noteId, markdown: remote.markdown };
      await Promise.all([
        notes.put(note, noteId),
        tags.put(tagEntry(note)),
        sync.put(
          {
            noteId,
            baseRevision: remote.revision,
            dirty: false,
            deleted: false,
            blocked: null,
          } satisfies SyncEntry,
          noteId,
        ),
        tx.done,
      ]);
    }
    const search = await this.#search;
    if (remote.deleted) search?.remove(noteId);
    else search?.upsert({ id: noteId, markdown: remote.markdown });
    this.#emit({ noteId, source: "remote" });
  }

  /**
   * Starts sync for a new account: every local note is queued as new, and
   * the server's history is read from the beginning.
   */
  async resetSync(): Promise<void> {
    const tx = this.#db.transaction(["notes", "sync", "meta"], "readwrite");
    const ids = await tx.objectStore("notes").getAllKeys();
    const sync = tx.objectStore("sync");
    await sync.clear();
    await Promise.all([
      ...ids.map((id) =>
        sync.put(
          {
            noteId: id,
            baseRevision: null,
            dirty: true,
            deleted: false,
            blocked: null,
          } satisfies SyncEntry,
          id,
        ),
      ),
      tx.objectStore("meta").put(0, "syncCursor"),
      tx.done,
    ]);
  }

  async syncCursor(): Promise<number> {
    const value = await this.#db.get("meta", "syncCursor");
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  }

  async setSyncCursor(cursor: number): Promise<void> {
    await this.#db.put("meta", cursor, "syncCursor");
  }

  async loadMeta(key: string): Promise<unknown> {
    return this.#db.get("meta", key);
  }

  async saveMeta(key: string, value: unknown): Promise<void> {
    await (value === undefined ? this.#db.delete("meta", key) : this.#db.put("meta", value, key));
  }

  /** Full-text and tag search, best matches first. */
  async search(query: SearchQuery): Promise<SearchHit[]> {
    this.#search ??= this.list().then((notes) => SearchIndex.build(notes));
    try {
      return (await this.#search).search(query);
    } catch (error) {
      this.#search = null; // Build again on the next search.
      throw error;
    }
  }

  /** The saved reading position, or null if there is none (or it is unreadable). */
  async readingState(noteId: string): Promise<ReadingState | null> {
    const record = await this.#db.get("reading", noteId);
    if (record === undefined) return null;
    try {
      return parseReadingState(record);
    } catch {
      return null; // Losing a reading position is harmless; start from the top.
    }
  }

  async saveReadingPosition(noteId: string, position: number, now = new Date()): Promise<void> {
    await this.#updateReading(noteId, (state) => ({ ...state, position }), now);
  }

  async saveEditorSelection(noteId: string, selection: EditorSelection, now = new Date()) {
    await this.#updateReading(noteId, (state) => ({ ...state, selection }), now);
  }

  /** Changes part of a note's reading state, keeping the rest, in one transaction. */
  async #updateReading(
    noteId: string,
    change: (state: ReadingState) => ReadingState,
    now: Date,
  ): Promise<void> {
    const tx = this.#db.transaction("reading", "readwrite");
    let current: ReadingState = { noteId, position: 0, updatedAt: now.toISOString() };
    try {
      const record: unknown = await tx.store.get(noteId);
      if (record !== undefined) current = parseReadingState(record);
    } catch {
      // An unreadable state is replaced; losing a position is harmless.
    }
    const next = parseReadingState({ ...change(current), updatedAt: now.toISOString() });
    await Promise.all([tx.store.put(next, noteId), tx.done]);
  }

  /** The saved settings, with defaults for anything missing or invalid. */
  async loadSettings(): Promise<Settings> {
    return parseSettings(await this.#db.get("meta", "settings"));
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.#db.put("meta", parseSettings(settings), "settings");
  }

  /** Every tag in use, with the notes tagged with it and its parents, sorted by name. */
  tags(): Promise<TagCount[]> {
    return allTags(this.#db);
  }

  /** Notes tagged with `tag`. */
  async notesWithTag(tag: Tag): Promise<Note[]> {
    const ids = await noteIdsWithTag(this.#db, tag);
    const notes = await Promise.all(ids.map((id) => this.get(id)));
    return notes.filter((note): note is Note => note !== undefined);
  }

  /** Discards the derived indexes and recomputes them from the notes. */
  rebuildIndexes(): Promise<void> {
    this.#search = null;
    return rebuildTagIndex(this.#db);
  }
}

export async function openNoteStore(name: string = DEFAULT_DATABASE_NAME): Promise<NoteStore> {
  const db = await openDB<KonspecterDb>(name, DATABASE_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore("notes");
      }
      if (oldVersion === 1) {
        // If this fails the upgrade transaction aborts and openDB rejects.
        moveDatesIntoFrontmatter(transaction.objectStore("notes")).catch(() => undefined);
      }
      if (oldVersion < 3) {
        // Filled by ensureTagIndex below, once the notes are migrated.
        database
          .createObjectStore("tags", { keyPath: "noteId" })
          .createIndex("memberOf", "memberOf", { multiEntry: true });
        database.createObjectStore("meta");
      }
      if (oldVersion < 4) {
        database.createObjectStore("reading");
      }
      if (oldVersion < 5) {
        // Filled when sync is first set up (resetSync).
        database.createObjectStore("sync");
      }
    },
    // Another tab wants a newer schema: let it upgrade instead of waiting forever.
    // Pages in this tab then show a storage error until it is reloaded.
    blocking() {
      db.close();
    },
  });
  await ensureTagIndex(db);
  return new NoteStore(db);
}

async function moveDatesIntoFrontmatter(
  store: IDBPObjectStore<
    KonspecterDb,
    ArrayLike<StoreNames<KonspecterDb>>,
    "notes",
    "versionchange"
  >,
): Promise<void> {
  let cursor = await store.openCursor();
  while (cursor) {
    const migrated = migrateVersion1Record(cursor.value);
    if (migrated) {
      await cursor.update(migrated);
    }
    cursor = await cursor.continue();
  }
}

/**
 * Moves a version 1 record's dates into its frontmatter, unless the document
 * already has them. Returns undefined for records that are not notes at all;
 * those are left untouched. A document with invalid frontmatter keeps its
 * text as is and loses only the record dates.
 */
export function migrateVersion1Record(value: unknown): Note | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { id, markdown, createdAt, updatedAt } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof markdown !== "string") {
    return undefined;
  }
  try {
    const { metadata } = parseDocument(markdown);
    return {
      id,
      markdown: updateMetadata(markdown, {
        created: metadata.created ?? recordTimestamp(createdAt),
        updated: metadata.updated ?? recordTimestamp(updatedAt),
      }),
    };
  } catch {
    return { id, markdown };
  }
}

function recordTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return formatTimestamp(new Date(value));
}

async function readEntry(request: Promise<unknown>): Promise<SyncEntry | null> {
  const value = await request;
  if (value === undefined) return null;
  try {
    return parseSyncEntry(value);
  } catch {
    // Unreadable bookkeeping: treat the note as never synced. It is pushed
    // again as new, and a duplicate on the server is reported as a conflict.
    return null;
  }
}
