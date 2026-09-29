import type { NoteChange, NoteRepository } from "../../application/notes/note-repository";
import { documentTitle, parseDocument } from "../../domain/document/document";
import { createNote, type Note } from "../../domain/note/note";
import type { ReadingState } from "../../domain/reading/reading";
import type { SearchQuery } from "../../domain/search/query";
import type { Tag } from "../../domain/tag/tags";
import {
  FolderError,
  type FileContents,
  type FileEntry,
  type FolderBridge,
  type FolderChange,
} from "../desktop/desktop";
import { SearchIndex, type SearchHit } from "../search/search-index";
import { tagEntry, type TagCount, type TagEntry } from "../storage/tag-index";

/** Where reading positions are kept: the app's own database, not the files. */
export type ReadingStateStore = {
  readingState(noteId: string): Promise<ReadingState | null>;
  saveReadingPosition(noteId: string, position: number): Promise<void>;
};

type CachedFile = {
  readonly markdown: string;
  readonly modifiedMs: number;
  readonly tags: TagEntry;
};

/**
 * File Mode: notes are the `.md` files of a folder on disk, and a note's id is
 * its path relative to the folder. The files are the only copy of the data;
 * this store keeps an in-memory cache and derived indexes (tags, search),
 * all rebuilt from the files.
 */
export class FolderStore implements NoteRepository {
  readonly #folder: FolderBridge;
  readonly #reading: ReadingStateStore;
  readonly #files = new Map<string, CachedFile>();
  #loaded: Promise<void> | null = null;
  #search: SearchIndex | null = null;
  readonly #listeners = new Set<(change: NoteChange) => void>();

  readonly #graceMs: number;

  /**
   * @param graceMs how long a vanished file gets to reappear before it counts
   *   as deleted (editors that save by deleting and recreating the file)
   */
  constructor(folder: FolderBridge, reading: ReadingStateStore, { graceMs = 150 } = {}) {
    this.#folder = folder;
    this.#reading = reading;
    this.#graceMs = graceMs;
  }

  /** Reads every file again and reports what changed. */
  async refresh(): Promise<void> {
    await this.#ensureLoaded();
    const entries = await this.#folder.list();
    const current = new Set(entries.map((entry) => entry.path));
    const gone = [...this.#files.keys()].filter((path) => !current.has(path));
    await this.#apply([...current, ...gone]);
  }

  /**
   * Follows changes made by other programs (the native watcher). Returns a
   * function that stops watching.
   */
  watch(): Promise<() => void> {
    return this.#folder.watch((change) => {
      void this.#onExternalChange(change);
    });
  }

  async #onExternalChange(change: FolderChange): Promise<void> {
    try {
      if (change.rescan) await this.refresh();
      else await this.#apply(change.paths);
    } catch {
      // A file that cannot be read now is picked up by the next change or rescan.
    }
  }

  /**
   * Re-reads the given paths and updates the cache and indexes. A file that
   * disappeared while one with the same content appeared is a rename: its
   * reading position moves and listeners learn the previous id.
   */
  async #apply(paths: readonly string[]): Promise<void> {
    await this.#ensureLoaded();
    const reads = await Promise.all(paths.map((path) => this.#readIfPresent(path)));
    const removed: string[] = [];
    const added: FileContents[] = [];
    const changed: FileContents[] = [];
    paths.forEach((path, index) => {
      const read = reads[index];
      const known = this.#files.get(path);
      if (!read) {
        if (known) removed.push(path);
      } else if (!known) {
        added.push(read);
      } else if (known.markdown !== read.text) {
        changed.push(read);
      } else {
        // Same content (e.g. our own write coming back): only the timestamp moves.
        this.#files.set(path, { ...known, modifiedMs: read.entry.modifiedMs });
      }
    });

    const renames = new Map<string, string>(); // new path → old path
    for (const oldPath of removed) {
      const markdown = this.#files.get(oldPath)?.markdown;
      const target = added.find(
        (file) => file.text === markdown && ![...renames.keys()].includes(file.entry.path),
      );
      if (target) renames.set(target.entry.path, oldPath);
    }

    for (const path of removed) {
      this.#files.delete(path);
      this.#search?.remove(path);
    }
    for (const file of [...added, ...changed]) this.#remember(file.entry, file.text);
    for (const [newPath, oldPath] of renames) {
      const state = await this.#reading.readingState(readingKey(oldPath));
      if (state) await this.#reading.saveReadingPosition(readingKey(newPath), state.position);
    }

    const renamedFrom = new Set(renames.values());
    for (const path of removed) {
      if (!renamedFrom.has(path)) this.#emit({ noteId: path, source: "remote" });
    }
    for (const file of [...added, ...changed]) {
      const previousId = renames.get(file.entry.path);
      this.#emit({
        noteId: file.entry.path,
        source: "remote",
        ...(previousId === undefined ? {} : { previousId }),
      });
    }
  }

  async #readIfPresent(path: string): Promise<FileContents | null> {
    const first = await this.#tryRead(path);
    if (first || !this.#files.has(path)) return first;
    // A known file vanished: it may be mid-save. Look once more before
    // treating it as deleted.
    await new Promise((resolve) => setTimeout(resolve, this.#graceMs));
    return this.#tryRead(path);
  }

  async #tryRead(path: string): Promise<FileContents | null> {
    try {
      return await this.#folder.read(path);
    } catch (error) {
      if (error instanceof FolderError && error.code === "not_found") return null;
      throw error;
    }
  }

  openExternally(id: string): Promise<void> {
    return this.#folder.openExternally(id);
  }

  reveal(id: string): Promise<void> {
    return this.#folder.reveal(id);
  }

  async #readAll(): Promise<void> {
    const entries = await this.#folder.list();
    const contents = await Promise.all(entries.map((entry) => this.#folder.read(entry.path)));
    this.#files.clear();
    for (const { entry, text } of contents) this.#remember(entry, text);
    this.#search = null;
  }

  #ensureLoaded(): Promise<void> {
    this.#loaded ??= this.#readAll().catch((error: unknown) => {
      this.#loaded = null; // Try again next time.
      throw error;
    });
    return this.#loaded;
  }

  #remember(entry: FileEntry, markdown: string): Note {
    const note = toNote(entry.path, markdown, entry.modifiedMs);
    this.#files.set(entry.path, { markdown, modifiedMs: entry.modifiedMs, tags: tagEntry(note) });
    this.#search?.upsert(note);
    return note;
  }

  #emit(change: NoteChange): void {
    for (const listener of this.#listeners) listener(change);
  }

  async list(): Promise<Note[]> {
    await this.#ensureLoaded();
    return [...this.#files].map(([path, file]) => toNote(path, file.markdown, file.modifiedMs));
  }

  async get(id: string): Promise<Note | undefined> {
    await this.#ensureLoaded();
    const file = this.#files.get(id);
    return file && toNote(id, file.markdown, file.modifiedMs);
  }

  /** Creates a new file named after the note's title. */
  async create(markdown: string, now: Date): Promise<Note> {
    await this.#ensureLoaded();
    const note = createNote(markdown, now);
    const title = documentTitle(parseDocument(note.markdown));
    const entry = await this.#folder.create(title, note.markdown);
    const created = this.#remember(entry, note.markdown);
    this.#emit({ noteId: entry.path, source: "local" });
    return created;
  }

  /**
   * Writes the file, but only if it has not changed on disk since it was read;
   * otherwise the write fails with FolderError "changed_on_disk".
   */
  async put(note: Note): Promise<void> {
    await this.#ensureLoaded();
    const expected = this.#files.get(note.id)?.modifiedMs ?? null;
    const entry = await this.#folder.write(note.id, note.markdown, expected);
    this.#remember(entry, note.markdown);
    this.#emit({ noteId: note.id, source: "local" });
  }

  /** Moves the file to the system trash. */
  async delete(id: string): Promise<void> {
    await this.#folder.trash(id);
    this.#files.delete(id);
    this.#search?.remove(id);
    this.#emit({ noteId: id, source: "local" });
  }

  async tags(): Promise<TagCount[]> {
    await this.#ensureLoaded();
    const counts = new Map<string, number>();
    for (const file of this.#files.values()) {
      for (const name of file.tags.memberOf) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => ({ tag: { path: name.split("#"), name }, count }))
      .sort((a, b) => (a.tag.name < b.tag.name ? -1 : a.tag.name > b.tag.name ? 1 : 0));
  }

  async notesWithTag(tag: Tag): Promise<Note[]> {
    await this.#ensureLoaded();
    return [...this.#files]
      .filter(([, file]) => file.tags.memberOf.includes(tag.name))
      .map(([path, file]) => toNote(path, file.markdown, file.modifiedMs));
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    this.#search ??= await SearchIndex.build(await this.list());
    return this.#search.search(query);
  }

  readingState(noteId: string): Promise<ReadingState | null> {
    return this.#reading.readingState(readingKey(noteId));
  }

  saveReadingPosition(noteId: string, position: number): Promise<void> {
    return this.#reading.saveReadingPosition(readingKey(noteId), position);
  }

  onChange(listener: (change: NoteChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

function toNote(path: string, markdown: string, modifiedMs: number): Note {
  return { id: path, markdown, modifiedAt: new Date(modifiedMs).toISOString() };
}

/** Reading positions of files are keyed apart from library notes. */
function readingKey(path: string): string {
  return `file:${path}`;
}
