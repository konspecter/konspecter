import type { NoteChange, NoteRepository } from "../../application/notes/note-repository";
import type { Note } from "../../domain/note/note";
import type { EditorSelection, ReadingState } from "../../domain/reading/reading";
import type { SearchQuery } from "../../domain/search/query";
import type { Tag } from "../../domain/tag/tags";
import { folderLabel, FolderError, type LibraryFolder } from "../desktop/desktop";
import { SearchIndex, type SearchHit } from "../search/search-index";
import { countTags, type TagCount, type TagEntry } from "../storage/tag-index";
import type { FolderStore } from "./folder-store";

/** What the native side does for the list of folders. */
export type FolderListNative = {
  setAlias(folder: string, alias: string | null): Promise<void>;
};

/**
 * The desktop library: every connected folder, each a `FolderStore` of its
 * own (ADR-030). A note's id is its folder's id, a slash and its path in the
 * folder (`9c1f0a7e3b2d4c58/java/streams.md`), so the folders' files never
 * mix, and inside each folder its folders still follow the tags (ADR-013).
 *
 * New notes go to the folder they are asked for, else the first one; so do
 * notes that sync brings and this device has no file for. A folder that
 * cannot be opened is listed without notes, and so is one whose files cannot
 * be read just now (`available` false until they can): the other folders
 * work on. Search ranks the notes of every folder together, in one index.
 */
export class FolderLibrary implements NoteRepository {
  #folders: readonly LibraryFolder[];
  readonly #stores = new Map<string, FolderStore>();
  readonly #native: FolderListNative;
  readonly #listeners = new Set<(change: NoteChange) => void>();
  readonly #folderListeners = new Set<() => void>();
  /** Open folders whose files could not be read the last time they were asked for. */
  readonly #failing = new Set<string>();
  /** The search index, built at the first search; changes wait for it. */
  #search: Promise<SearchIndex> | null = null;

  constructor(
    folders: readonly { readonly folder: LibraryFolder; readonly store: FolderStore | null }[],
    native: FolderListNative,
  ) {
    this.#folders = folders.map(({ folder, store }) => ({
      ...folder,
      available: store !== null && folder.available,
    }));
    this.#native = native;
    for (const { folder, store } of folders) {
      if (!store) continue;
      this.#stores.set(folder.id, store);
      store.onChange((change) => {
        this.#changed(folder.id, change);
      });
    }
  }

  // --- The folders -------------------------------------------------------------

  /** The connected folders, in order (a new array whenever one changes). */
  folders(): readonly LibraryFolder[] {
    return this.#folders;
  }

  /** Called when the folders change (an alias). Returns a function that stops it. */
  subscribeFolders(listener: () => void): () => void {
    this.#folderListeners.add(listener);
    return () => this.#folderListeners.delete(listener);
  }

  async setAlias(folder: string, alias: string | null): Promise<void> {
    const trimmed = alias?.trim() || null;
    await this.#native.setAlias(folder, trimmed);
    this.#folders = this.#folders.map((f) => (f.id === folder ? { ...f, alias: trimmed } : f));
    this.#tellFolders();
  }

  /** The ids of the folders that are open and readable, in order. */
  openFolders(): string[] {
    return this.#folders.filter((folder) => this.#readable(folder.id)).map((f) => f.id);
  }

  /** The folder a note is in, by its id. */
  folderOf(noteId: string): string | null {
    const slash = noteId.indexOf("/");
    return slash > 0 ? noteId.slice(0, slash) : null;
  }

  /** The note's file as people read it: its path, after its folder's name when there are several. */
  fileOf(noteId: string): string {
    const { folder, path } = split(noteId);
    const known = this.#folders.find((f) => f.id === folder);
    return known && this.#folders.length > 1 ? `${folderLabel(known)}/${path}` : path;
  }

  /** One folder's tags, for its root in the tree. */
  async folderTags(folder: string): Promise<TagCount[]> {
    const [entries = []] = await this.#each(
      (id, store) => store.tagEntries().then((found) => prefixedEntries(id, found)),
      folder,
    );
    return countTags(entries);
  }

  // --- Per folder ------------------------------------------------------------

  async ignoreText(folder: string): Promise<string> {
    return this.#store(folder).ignoreText();
  }

  async setIgnore(folder: string, text: string): Promise<void> {
    return this.#store(folder).setIgnore(text);
  }

  /** The misplaced files of one folder, or of every readable one (ADR-013). */
  async misplaced(folder?: string): Promise<string[]> {
    const results = await this.#each(
      async (id, store) => (await store.misplaced()).map((path) => `${id}/${path}`),
      folder,
    );
    return results.flat();
  }

  /** Moves the misplaced files of one folder, or of every readable one; returns how many moved. */
  async reformat(folder?: string): Promise<number> {
    const moved = await this.#each((_, store) => store.reformat(), folder);
    return moved.reduce((sum, count) => sum + count, 0);
  }

  followTitles(follow: boolean): void {
    for (const store of this.#stores.values()) store.followTitles(follow);
  }

  /** Follows the changes other programs make to every folder. */
  async watch(): Promise<() => void> {
    const stops = await Promise.all([...this.#stores.values()].map((store) => store.watch()));
    return () => {
      for (const stop of stops) stop();
    };
  }

  // --- NoteRepository --------------------------------------------------------

  async list(): Promise<Note[]> {
    const lists = await this.#each(async (id, store) =>
      (await store.list()).map((note) => prefixed(id, note)),
    );
    return lists.flat();
  }

  async get(id: string): Promise<Note | undefined> {
    const { folder, path } = split(id);
    const note = await this.#stores.get(folder)?.get(path);
    return note && prefixed(folder, note);
  }

  /** In `folder`, else in the first open folder; fails with "no_folder" without one. */
  async create(
    markdown: string,
    now: Date,
    { followTitle = false, folder }: { followTitle?: boolean; folder?: string } = {},
  ): Promise<Note> {
    const id = folder !== undefined && this.#stores.has(folder) ? folder : this.#first();
    return prefixed(id, await this.#store(id).create(markdown, now, { followTitle }));
  }

  async put(note: Note): Promise<Note> {
    const { folder, path } = split(note.id);
    return prefixed(folder, await this.#store(folder).put({ ...note, id: path }));
  }

  async delete(id: string): Promise<void> {
    const { folder, path } = split(id);
    return this.#store(folder).delete(path);
  }

  async tags(): Promise<TagCount[]> {
    const entries = await this.#each(async (id, store) =>
      prefixedEntries(id, await store.tagEntries()),
    );
    return countTags(entries.flat());
  }

  async notesWithTag(tag: Tag): Promise<Note[]> {
    const lists = await this.#each(async (id, store) =>
      (await store.notesWithTag(tag)).map((note) => prefixed(id, note)),
    );
    return lists.flat();
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    this.#search ??= this.list()
      .then((notes) => SearchIndex.build(notes))
      .catch((error: unknown) => {
        this.#search = null; // Built again at the next search.
        throw error;
      });
    return (await this.#search).search(query);
  }

  readingState(noteId: string): Promise<ReadingState | null> {
    const { folder, path } = split(noteId);
    return this.#stores.get(folder)?.readingState(path) ?? Promise.resolve(null);
  }

  async saveReadingPosition(noteId: string, position: number): Promise<void> {
    const { folder, path } = split(noteId);
    return this.#store(folder).saveReadingPosition(path, position);
  }

  async saveEditorSelection(noteId: string, selection: EditorSelection): Promise<void> {
    const { folder, path } = split(noteId);
    return this.#store(folder).saveEditorSelection(path, selection);
  }

  onChange(listener: (change: NoteChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  settleName(id: string): void {
    const { folder, path } = split(id);
    this.#stores.get(folder)?.settleName(path);
  }

  async openExternally(id: string): Promise<void> {
    const { folder, path } = split(id);
    return this.#store(folder).openExternally(path);
  }

  async reveal(id: string): Promise<void> {
    const { folder, path } = split(id);
    return this.#store(folder).reveal(path);
  }

  // --- Sync (FolderSync) -------------------------------------------------------

  /**
   * Writes a version from elsewhere: over its file when `id` names one,
   * else as a new file in the first open folder.
   */
  async receive(id: string | null, markdown: string): Promise<Note> {
    if (id === null)
      return prefixed(this.#first(), await this.#store(this.#first()).receive(null, markdown));
    const { folder, path } = split(id);
    return prefixed(folder, await this.#store(folder).receive(path, markdown));
  }

  /** The note was deleted elsewhere: its file goes to the trash. */
  async remove(id: string): Promise<void> {
    const { folder, path } = split(id);
    return this.#store(folder).remove(path);
  }

  /** The device was wiped: the file is deleted for good. */
  async erase(id: string): Promise<void> {
    const { folder, path } = split(id);
    return this.#store(folder).erase(path);
  }

  // --- Inside ------------------------------------------------------------------

  #changed(folder: string, change: NoteChange): void {
    const noteId = `${folder}/${change.noteId}`;
    const previousId =
      change.previousId === undefined ? undefined : `${folder}/${change.previousId}`;
    void this.#reindex(noteId, previousId);
    for (const listener of this.#listeners) {
      listener({
        noteId,
        source: change.source,
        ...(previousId === undefined ? {} : { previousId }),
      });
    }
  }

  /**
   * Brings a changed note into the search index. A change made while the
   * index is being built waits for it, then applies on top of it, so the
   * index never keeps text older than the files.
   */
  async #reindex(noteId: string, previousId: string | undefined): Promise<void> {
    const building = this.#search;
    if (!building) return;
    const index = await building.catch(() => null);
    if (!index) return;
    if (previousId !== undefined) index.remove(previousId);
    const note = await this.get(noteId).catch(() => undefined);
    if (note) index.upsert(note);
    else index.remove(noteId);
  }

  /**
   * Runs `task` on every readable folder (or the one named), in order. A
   * folder whose files cannot be read is left out, and listed as not
   * available until they can be, rather than taking every other folder down.
   */
  async #each<T>(
    task: (id: string, store: FolderStore) => Promise<T>,
    only?: string,
  ): Promise<T[]> {
    const chosen = [...this.#stores].filter(([id]) => only === undefined || id === only);
    const results = await Promise.allSettled(chosen.map(([id, store]) => task(id, store)));
    let changed = false;
    const values: T[] = [];
    for (const [index, result] of results.entries()) {
      const id = chosen[index]?.[0];
      if (id === undefined) continue;
      const failed = result.status === "rejected";
      if (failed !== this.#failing.has(id)) {
        changed = true;
        if (failed) this.#failing.add(id);
        else this.#failing.delete(id);
      }
      if (result.status === "fulfilled") values.push(result.value);
    }
    if (changed) {
      this.#folders = this.#folders.map((f) => ({ ...f, available: this.#readable(f.id) }));
      this.#tellFolders();
    }
    return values;
  }

  #readable(folder: string): boolean {
    return this.#stores.has(folder) && !this.#failing.has(folder);
  }

  #tellFolders(): void {
    for (const listener of this.#folderListeners) listener();
  }

  #store(folder: string): FolderStore {
    const store = this.#stores.get(folder);
    if (!store) throw new FolderError("no_folder", `The folder ${folder} is not open`);
    return store;
  }

  #first(): string {
    const first = this.openFolders()[0];
    if (first === undefined) throw new FolderError("no_folder", "No folder is connected");
    return first;
  }
}

function split(id: string): { folder: string; path: string } {
  const slash = id.indexOf("/");
  return slash > 0
    ? { folder: id.slice(0, slash), path: id.slice(slash + 1) }
    : { folder: "", path: id };
}

function prefixed(folder: string, note: Note): Note {
  return { ...note, id: `${folder}/${note.id}` };
}

function prefixedEntries(folder: string, entries: readonly TagEntry[]): TagEntry[] {
  return entries.map((entry) => ({ ...entry, noteId: `${folder}/${entry.noteId}` }));
}
