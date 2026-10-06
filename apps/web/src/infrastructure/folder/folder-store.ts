import type { NoteChange, NoteRepository } from "../../application/notes/note-repository";
import { documentTitle, parseDocument } from "../../domain/document/document";
import { slugFileNames, slugFor, stemFitsSlug } from "../../domain/note/file-name";
import { ignoreRules, type IgnoreRules } from "../../domain/note/ignore";
import {
  chainFolder,
  foldersOf,
  inChainFolder,
  placingChain,
  sameChain,
  withFolderTags,
} from "../../domain/note/folders";
import { createNote, readNote, type Note } from "../../domain/note/note";
import type { EditorSelection, ReadingState } from "../../domain/reading/reading";
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
import { countTags, tagEntry, type TagCount, type TagEntry } from "../storage/tag-index";

/** Where reading positions are kept: the app's own database, not the files. */
export type ReadingStateStore = {
  readingState(noteId: string): Promise<ReadingState | null>;
  saveReadingPosition(noteId: string, position: number): Promise<void>;
  saveEditorSelection(noteId: string, selection: EditorSelection): Promise<void>;
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
 *
 * The folders follow the tags (ADR-013): a note's folder is its first tag
 * chain. Files found without tags in folders get their folders' chain, a new
 * note is made in its chain's folder, and a save that changes the chain moves
 * the file there.
 *
 * The folder's `.konspecterignore` names what is not a note: such files are
 * not listed (the native side does not even walk into them), and no note is
 * made or moved into a folder it skips.
 */
export class FolderStore implements NoteRepository {
  readonly #folder: FolderBridge;
  readonly #reading: ReadingStateStore;
  readonly #files = new Map<string, CachedFile>();
  #loaded: Promise<void> | null = null;
  #rules: IgnoreRules = ignoreRules("");
  #search: SearchIndex | null = null;
  readonly #listeners = new Set<(change: NoteChange) => void>();
  /** Paths being renamed by this app: the watcher's reports of them are its own. */
  readonly #moving = new Set<string>();

  readonly #graceMs: number;
  #followTitles: boolean;

  /**
   * @param graceMs how long a vanished file gets to reappear before it counts
   *   as deleted (editors that save by deleting and recreating the file)
   * @param followTitles whether a save renames the file after the note's
   *   title (see `followTitles`)
   */
  constructor(
    folder: FolderBridge,
    reading: ReadingStateStore,
    { graceMs = 150, followTitles = false } = {},
  ) {
    this.#folder = folder;
    this.#reading = reading;
    this.#graceMs = graceMs;
    this.#followTitles = followTitles;
  }

  /**
   * The "file names" setting: when on, saving a note whose title no longer
   * matches its file name renames the file ("test.md" titled "Hello мир!"
   * becomes "hello-mir.md"). New files are named after their titles either way.
   */
  followTitles(follow: boolean): void {
    this.#followTitles = follow;
  }

  /** The folder's ignore rules, as written (the default when it has none). */
  ignoreText(): Promise<string> {
    return this.#folder.readIgnore();
  }

  /**
   * Writes the folder's `.konspecterignore` and reads the folder again:
   * files the new rules skip go, files they no longer skip come.
   */
  async setIgnore(text: string): Promise<void> {
    await this.#folder.writeIgnore(text);
    await this.refresh();
  }

  async #loadRules(): Promise<void> {
    try {
      this.#rules = ignoreRules(await this.#folder.readIgnore());
    } catch {
      // Rules that cannot be read skip nothing, as on the native side.
      this.#rules = ignoreRules("");
    }
  }

  /** Reads the rules and every file again, and reports what changed. */
  async refresh(): Promise<void> {
    await this.#ensureLoaded();
    await this.#loadRules();
    const entries = await this.#listed();
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
  async #apply(reported: readonly string[]): Promise<void> {
    await this.#ensureLoaded();
    const paths = reported.filter((path) => !this.#moving.has(path));
    // A file the rules skip is no note, whether it is there or not.
    const reads = await Promise.all(
      paths.map((path) =>
        this.#rules.ignores(path) ? Promise.resolve(null) : this.#readIfPresent(path),
      ),
    );
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
    // New files and moved ones take the tags of the folders they are in.
    const adopted = await Promise.all(
      added.map((file) => this.#adopt(file, renames.get(file.entry.path))),
    );
    for (const file of [...adopted, ...changed]) this.#remember(file.entry, file.text);
    for (const [newPath, oldPath] of renames) await this.#moveReadingState(oldPath, newPath);

    const renamedFrom = new Set(renames.values());
    for (const path of removed) {
      if (!renamedFrom.has(path)) this.#emit({ noteId: path, source: "remote" });
    }
    for (const file of [...adopted, ...changed]) {
      const previousId = renames.get(file.entry.path);
      this.#emit({
        noteId: file.entry.path,
        source: "remote",
        ...(previousId === undefined ? {} : { previousId }),
      });
    }
  }

  async #moveReadingState(oldPath: string, newPath: string): Promise<void> {
    const state = await this.#reading.readingState(readingKey(oldPath));
    if (!state) return;
    await this.#reading.saveReadingPosition(readingKey(newPath), state.position);
    if (state.selection) {
      await this.#reading.saveEditorSelection(readingKey(newPath), state.selection);
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

  /**
   * Disk → app: a file in folders without tags of its own gets its folders'
   * chain, and one moved (from `movedFrom`) out of its chain's folder gets the
   * new folders' (`withFolderTags`), written into the file. A file that cannot
   * be written stays as it is.
   */
  async #adopt(file: FileContents, movedFrom?: string): Promise<FileContents> {
    const text = withFolderTags(file.entry.path, file.text, movedFrom);
    if (text === null) return file;
    try {
      return { entry: await this.#folder.write(file.entry.path, text), text };
    } catch {
      return file;
    }
  }

  /** The files that are notes: listed, and not skipped by the rules. */
  async #listed(): Promise<FileEntry[]> {
    return (await this.#folder.list()).filter((entry) => !this.#rules.ignores(entry.path));
  }

  async #readAll(): Promise<void> {
    await this.#loadRules();
    const entries = await this.#listed();
    const contents = await Promise.all(
      entries.map(async (entry) => this.#adopt(await this.#folder.read(entry.path))),
    );
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

  /**
   * Creates a new file named after the note's title, in the folder of its
   * first tag chain (the top level without tags, or when the rules skip that
   * folder).
   */
  async create(markdown: string, now: Date): Promise<Note> {
    await this.#ensureLoaded();
    const note = createNote(markdown, now);
    const folder = this.#notIgnored(
      chainFolder(placingChain(readNote(note)), foldersOf(this.#files.keys())),
      "",
    );
    const entry = await this.#claimName(folder, slugFor(titleOf(note.markdown)), null, (path) =>
      this.#folder.createAt(path, note.markdown),
    );
    const created = this.#remember(entry, note.markdown);
    this.#moving.delete(entry.path);
    this.#emit({ noteId: entry.path, source: "local" });
    return created;
  }

  /**
   * Writes the file, over whatever another program wrote meanwhile: the last
   * write wins. A file deleted meanwhile is written again. Then the file is
   * moved where the note now says it belongs (`#relocate`): the note returned
   * has the new id.
   */
  async put(note: Note): Promise<Note> {
    await this.#ensureLoaded();
    const previous = this.#files.get(note.id)?.markdown;
    const entry = await this.#folder.write(note.id, note.markdown);
    const written = this.#remember(entry, note.markdown);
    const moved = await this.#relocate(note.id, previous);
    this.#emit({
      noteId: moved?.id ?? note.id,
      source: "local",
      ...(moved ? { previousId: note.id } : {}),
    });
    return moved ?? written;
  }

  /**
   * Moves a saved file where its note says it belongs, unless it is there:
   * into the folder of its first tag chain when the save changed that chain
   * (from `previous`), and to its title's slug when files follow their
   * titles and its name no longer fits. A file whose chain the save kept stays
   * in its folder, so files left where they are (see `reformat`) stay there.
   */
  async #relocate(path: string, previous: string | undefined): Promise<Note | null> {
    const file = this.#files.get(path);
    if (!file) return null;
    const read = readNote({ id: path, markdown: file.markdown });
    if (!read.valid) return null;
    const slash = path.lastIndexOf("/") + 1;
    const here = path.slice(0, slash);
    const stem = path.slice(slash).replace(/\.md$/i, "");
    const chain = placingChain(read);
    const before =
      previous === undefined ? chain : placingChain(readNote({ id: path, markdown: previous }));
    const folder =
      sameChain(before, chain) || inChainFolder(path, read)
        ? here
        : this.#notIgnored(chainFolder(chain, foldersOf(this.#files.keys())), here);
    const slug = this.#followTitles ? slugFor(titleOf(file.markdown)) : stem;
    const name = stemFitsSlug(stem, slug) ? stem : slug;
    if (folder === here && name === stem) return null;
    return this.#move(path, folder, name);
  }

  /**
   * Moves the file to `folder` as `stem.md` (`stem-2.md` … if taken), with its
   * reading position, and removes the folder it leaves empty.
   */
  async #move(path: string, folder: string, stem: string): Promise<Note> {
    const file = this.#files.get(path);
    if (!file) throw new FolderError("not_found", `${path} is not in the folder`);
    this.#moving.add(path);
    try {
      const entry = await this.#claimName(folder, stem, path, (target) =>
        this.#folder.rename(path, target),
      );
      this.#files.delete(path);
      this.#search?.remove(path);
      const moved = this.#remember(entry, file.markdown);
      this.#moving.delete(entry.path);
      await this.#moveReadingState(path, entry.path);
      await this.#removeIfEmpty(path);
      return moved;
    } finally {
      this.#moving.delete(path);
    }
  }

  /** Removes the folder that held `path` if no file is left in it (nor its emptied parents). */
  async #removeIfEmpty(path: string): Promise<void> {
    const slash = path.lastIndexOf("/");
    if (slash <= 0) return;
    const folder = path.slice(0, slash);
    const inside = `${folder.toLowerCase()}/`;
    if ([...this.#files.keys()].some((known) => known.toLowerCase().startsWith(inside))) return;
    try {
      await this.#folder.removeEmptyFolder(folder);
    } catch {
      // An empty folder left behind is harmless.
    }
  }

  /** `folder`, unless the rules skip it: a note put there would vanish. */
  #notIgnored(folder: string, instead: string): string {
    return this.#rules.ignoresFolder(folder) ? instead : folder;
  }

  /**
   * The files with tags that are not in their first chain's folder (see
   * `reformat`), unless the rules skip that folder.
   */
  async misplaced(): Promise<string[]> {
    await this.#ensureLoaded();
    const folders = foldersOf(this.#files.keys());
    return [...this.#files]
      .filter(([path, file]) => {
        const read = readNote({ id: path, markdown: file.markdown });
        if (!read.valid || placingChain(read) === "" || inChainFolder(path, read)) return false;
        return !this.#rules.ignoresFolder(chainFolder(placingChain(read), folders));
      })
      .map(([path]) => path)
      .sort();
  }

  /**
   * Reformats the collection: every file with tags moves into the folder of
   * its first tag chain, keeping its name (numbered if the name is taken
   * there). Returns how many moved.
   */
  async reformat(): Promise<number> {
    let count = 0;
    for (const path of await this.misplaced()) {
      const file = this.#files.get(path);
      if (!file) continue;
      const read = readNote({ id: path, markdown: file.markdown });
      const folder = chainFolder(placingChain(read), foldersOf(this.#files.keys()));
      const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      const moved = await this.#move(path, folder, stem);
      this.#emit({ noteId: moved.id, source: "local", previousId: path });
      count += 1;
    }
    return count;
  }

  /**
   * Takes the first free name for a stem in `dir` ("stem.md", "stem-2.md" …):
   * names of known files are skipped (ignoring case, as macOS and Windows
   * do, except the file's own name: `current`), and `take` fails with
   * "exists" for a file this store does not know yet. The name taken stays
   * in `#moving` until the caller has remembered the file.
   */
  async #claimName(
    dir: string,
    slug: string,
    current: string | null,
    take: (path: string) => Promise<FileEntry>,
  ): Promise<FileEntry> {
    const own = current?.toLowerCase();
    const known = new Set([...this.#files.keys()].map((path) => path.toLowerCase()));
    let tries = 0;
    for (const name of slugFileNames(dir, slug)) {
      const lower = name.toLowerCase();
      if (known.has(lower) && lower !== own) continue;
      this.#moving.add(name);
      try {
        return await take(name);
      } catch (error) {
        this.#moving.delete(name);
        if (!(error instanceof FolderError && error.code === "exists") || (tries += 1) > 100) {
          throw error;
        }
      }
    }
    throw new FolderError("exists", `No free file name for ${slug}`);
  }

  /** Moves the file to the system trash. */
  async delete(id: string): Promise<void> {
    await this.#folder.trash(id);
    this.#files.delete(id);
    this.#search?.remove(id);
    await this.#removeIfEmpty(id);
    this.#emit({ noteId: id, source: "local" });
  }

  async tags(): Promise<TagCount[]> {
    await this.#ensureLoaded();
    return countTags([...this.#files.values()].map((file) => file.tags));
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

  saveEditorSelection(noteId: string, selection: EditorSelection): Promise<void> {
    return this.#reading.saveEditorSelection(readingKey(noteId), selection);
  }

  onChange(listener: (change: NoteChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

function titleOf(markdown: string): string {
  return documentTitle(parseDocument(markdown));
}

function toNote(path: string, markdown: string, modifiedMs: number): Note {
  return { id: path, markdown, modifiedAt: new Date(modifiedMs).toISOString() };
}

/** Reading positions of files are keyed apart from library notes. */
function readingKey(path: string): string {
  return `file:${path}`;
}
