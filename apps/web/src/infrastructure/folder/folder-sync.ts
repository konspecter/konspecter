import type { NoteChange } from "../../application/notes/note-repository";
import type { Note } from "../../domain/note/note";
import type { Resolution } from "../../domain/sync/conflicts";
import {
  isPending,
  parseSyncBlock,
  type RemoteNote,
  type SyncBlock,
  type SyncEntry,
} from "../../domain/sync/sync-state";
import type { NoteStore, RemoteApplyResult, StoreChange } from "../storage/note-store";
import type { SyncStore } from "../sync/sync-engine";
import type { FolderStore } from "./folder-store";

/** One file's tie to a synced note, stored in IndexedDB (`links`) under the note's id. */
export type FolderLink = {
  readonly noteId: string;
  /** The file, relative to the folder; null once it was deleted (the deletion is queued). */
  readonly path: string | null;
  /** The server revision the file is based on; null if it never reached the server. */
  readonly baseRevision: number | null;
  /** SHA-256 of the text last pushed or pulled; null when the file must be pushed anyway. */
  readonly syncedHash: string | null;
  readonly blocked: SyncBlock | null;
};

/** Which folder the links belong to, and whether it is still being matched with the server. */
const STATE_KEY = "folderSync";

type State = { readonly folder: string; readonly adopting: boolean };

/**
 * Desktop: sync for a folder of Markdown files (ADR-024). The files stay as
 * they are; the app keeps one link per file in its database, keyed by the
 * server's note id. A file whose text no longer hashes to what was last
 * synced is dirty, whoever changed it, and a linked file that is gone is a
 * deletion.
 *
 * A folder new to sync (another folder chosen, or a new account or key) is
 * **adopted**: until the first complete pull, files that never reached the
 * server wait, and a note pulled with the same text as such a file is linked
 * to it instead of written again. So a copy of the folder duplicates nothing.
 */
export class FolderSync implements SyncStore {
  readonly #files: FolderStore;
  /** Links, the sync cursor and the connection. */
  readonly #db: NoteStore;
  readonly #folder: string;
  readonly #links = new Map<string, FolderLink>();
  /** File path → note id. */
  readonly #byPath = new Map<string, string>();
  readonly #hashes = new Map<string, { readonly markdown: string; readonly hash: string }>();
  readonly #listeners = new Set<(change: StoreChange) => void>();
  #adopting = false;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(files: FolderStore, db: NoteStore, folder: string) {
    this.#files = files;
    this.#db = db;
    this.#folder = folder;
  }

  /**
   * Loads the links of `folder` and squares them with its files: a file
   * renamed while the app was closed keeps its link (found by its unchanged
   * text), a file that is gone queues its deletion, and a new file gets a
   * link. Then follows the folder's changes.
   */
  static async open(files: FolderStore, db: NoteStore, folder: string): Promise<FolderSync> {
    const sync = new FolderSync(files, db, folder);
    await sync.#load();
    files.onChange((change) => {
      void sync.#serial(() => sync.#onFileChange(change));
    });
    return sync;
  }

  async #load(): Promise<void> {
    for (const link of (await this.#db.folderLinks()).flatMap(parseLink)) this.#index(link);
    const state = parseState(await this.#db.loadMeta(STATE_KEY));
    this.#adopting = state?.adopting ?? false;
    const files = await this.#files.list();
    const present = new Set(files.map((file) => file.id));
    const linked = [...this.#links.values()].filter((link) => link.path !== null);
    const foreign = state !== null && state.folder !== this.#folder;
    // A folder without any of its linked files is not one whose notes were all
    // deleted: it is another folder (or one not there yet). Nothing is deleted.
    const emptied = linked.length > 0 && linked.every((link) => !present.has(link.path ?? ""));
    if (foreign || emptied) {
      await this.#forgetLinks();
    } else {
      await this.#square(files);
    }
    const unlinked = files.filter((file) => !this.#byPath.has(file.id));
    await this.#save(unlinked.map((file) => newLink(file.id)));
    await this.#saveState();
  }

  /** Links whose files are gone: renamed (same text elsewhere) or deleted. */
  async #square(files: readonly Note[]): Promise<void> {
    const present = new Set(files.map((file) => file.id));
    const missing = [...this.#links.values()].filter(
      (link) => link.path !== null && !present.has(link.path),
    );
    if (missing.length === 0) return;
    // Unlinked files by the hash of their text; one rename takes each.
    const unlinked = new Map<string, string[]>();
    for (const file of files) {
      if (this.#byPath.has(file.id)) continue;
      const hash = await this.#hashOf(file);
      unlinked.set(hash, [...(unlinked.get(hash) ?? []), file.id]);
    }
    const changed: FolderLink[] = [];
    const removed: string[] = [];
    for (const link of missing) {
      const renamed = link.syncedHash === null ? undefined : unlinked.get(link.syncedHash)?.shift();
      if (renamed !== undefined) {
        changed.push({ ...link, path: renamed });
      } else if (link.baseRevision === null) {
        removed.push(link.noteId);
      } else {
        changed.push({ ...link, path: null });
      }
    }
    await this.#save(changed, removed);
  }

  /** The folder is new to sync: every file is matched with the server again. */
  async #forgetLinks(): Promise<void> {
    this.#links.clear();
    this.#byPath.clear();
    await this.#db.clearFolderLinks();
    await this.#db.setSyncCursor(0);
    this.#adopting = true;
  }

  /**
   * Moves the app library's notes into the folder (once, on the desktop):
   * each becomes a file, or links to a file with the same text, keeping its
   * id and sync state, so nothing is uploaded again. Reading positions move
   * along, and queued deletions stay queued. The notes then leave the library
   * without their deletion being queued. Returns how many moved.
   */
  moveLibrary(): Promise<number> {
    return this.#serial(async () => {
      const notes = await this.#db.list();
      const entries = await this.#db.syncEntries();
      if (notes.length === 0 && entries.length === 0) return 0;
      const entryOf = new Map(entries.map((entry) => [entry.noteId, entry]));
      for (const note of notes) {
        const entry = entryOf.get(note.id);
        const path = this.#links.get(note.id)?.path ?? (await this.#placeFromLibrary(note));
        const syncedHash = entry && !entry.dirty ? await this.#hash(note.markdown) : null;
        await this.#save([
          {
            noteId: note.id,
            path,
            baseRevision: entry?.baseRevision ?? null,
            syncedHash,
            blocked: null,
          },
        ]);
        await this.#moveReadingState(note.id, path);
      }
      const deletions = entries.filter((entry) => entry.deleted && entry.baseRevision !== null);
      await this.#save(
        deletions.map((entry) => ({
          noteId: entry.noteId,
          path: null,
          baseRevision: entry.baseRevision,
          syncedHash: null,
          blocked: null,
        })),
      );
      await this.#db.forgetNotes([...notes.map((note) => note.id), ...entryOf.keys()]);
      return notes.length;
    });
  }

  /** A library note's file: one never synced with the same text, or a new one. */
  async #placeFromLibrary(note: Note): Promise<string> {
    const twin = await this.#unsyncedTwin(note.markdown);
    if (twin) {
      await this.#save([], [twin.noteId]);
      return twin.path;
    }
    return (await this.#files.receive(null, note.markdown)).id;
  }

  async #moveReadingState(noteId: string, path: string): Promise<void> {
    const state = await this.#db.readingState(noteId);
    if (!state) return;
    await this.#files.saveReadingPosition(path, state.position);
    if (state.selection) await this.#files.saveEditorSelection(path, state.selection);
  }

  // --- Following the folder ------------------------------------------------

  /**
   * A file changed (in the app, in another program, or by sync): its link
   * follows a rename, a new file gets one, and a file that is gone queues its
   * deletion. Sync hears of it when the file now differs from the server.
   */
  async #onFileChange(change: NoteChange): Promise<void> {
    if (change.previousId !== undefined) {
      const id = this.#byPath.get(change.previousId);
      const link = id === undefined ? undefined : this.#links.get(id);
      if (link) await this.#save([{ ...link, path: change.noteId }]);
    }
    const file = await this.#files.get(change.noteId);
    const id = this.#byPath.get(change.noteId);
    const link = id === undefined ? undefined : this.#links.get(id);
    if (file && !link) {
      await this.#save([newLink(file.id)]);
    } else if (file && link) {
      if (!(await this.#isDirty(link))) return;
    } else if (link) {
      if (link.baseRevision === null) await this.#save([], [link.noteId]);
      else await this.#save([{ ...link, path: null }]);
    } else {
      return;
    }
    this.#emit({ noteId: id ?? change.noteId, source: "local" });
  }

  // --- SyncStore -----------------------------------------------------------

  async get(noteId: string): Promise<Note | undefined> {
    const path = this.#links.get(noteId)?.path;
    const file = path ? await this.#files.get(path) : undefined;
    return file && { id: noteId, markdown: file.markdown };
  }

  onChange(listener: (change: StoreChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(change: StoreChange): void {
    for (const listener of this.#listeners) listener(change);
  }

  syncEntries(): Promise<SyncEntry[]> {
    return this.#serial(() =>
      Promise.all([...this.#links.values()].map((link) => this.#entry(link))),
    );
  }

  /** While a folder is adopted, files that never reached the server wait for the pull. */
  async pendingSync(): Promise<SyncEntry[]> {
    const entries = await this.syncEntries();
    return entries.filter(
      (entry) =>
        isPending(entry) && !(this.#adopting && entry.baseRevision === null && !entry.deleted),
    );
  }

  markPushed(noteId: string, result: { revision: number; markdown: string } | "deleted") {
    return this.#serial(async () => {
      const link = this.#links.get(noteId);
      if (!link) return;
      if (result === "deleted") {
        await this.#save([], [noteId]);
        return;
      }
      // Edited again meanwhile: the file's text differs, so it stays dirty.
      const syncedHash = await this.#hash(result.markdown);
      await this.#save([{ ...link, baseRevision: result.revision, syncedHash }]);
    });
  }

  blockSync(noteId: string, blocked: SyncBlock): Promise<void> {
    return this.#serial(async () => {
      const link = this.#links.get(noteId);
      if (link) await this.#save([{ ...link, blocked }]);
    });
  }

  applyRemote(remote: RemoteNote): Promise<RemoteApplyResult> {
    return this.#serial(async () => {
      const link = this.#links.get(remote.id);
      if (!link) {
        if (remote.deleted) return "unchanged";
        const twin = await this.#unsyncedTwin(remote.markdown);
        if (twin) await this.#save([], [twin.noteId]);
        const path = twin?.path ?? (await this.#files.receive(null, remote.markdown)).id;
        await this.#linkSynced(remote, path);
        return "applied";
      }
      const entry = await this.#entry(link);
      if (entry.baseRevision === remote.revision && !entry.dirty) return "unchanged";
      if (entry.dirty && entry.deleted && remote.deleted) {
        await this.#save([], [remote.id]);
        return "applied";
      }
      if (entry.dirty) {
        const alreadyKnown = entry.baseRevision !== null && entry.baseRevision >= remote.revision;
        if (!alreadyKnown) await this.#save([{ ...link, blocked: { reason: "conflict", remote } }]);
        return alreadyKnown ? "unchanged" : "conflict";
      }
      await this.#takeRemote(link, remote);
      return "applied";
    });
  }

  applyResolution(noteId: string, resolution: Resolution): Promise<void> {
    return this.#serial(async () => {
      const link = this.#links.get(noteId);
      if (!link) return;
      const { remote } = resolution;
      if (resolution.kind === "keep-local") {
        const baseRevision = remote.revision > 0 ? remote.revision : null;
        await this.#save([{ ...link, baseRevision, syncedHash: null, blocked: null }]);
        return;
      }
      await this.#takeRemote(link, remote);
    });
  }

  /** The server's version replaces the file (or trashes it). */
  async #takeRemote(link: FolderLink, remote: RemoteNote): Promise<void> {
    if (remote.deleted) {
      if (link.path !== null) await this.#files.remove(link.path).catch(() => undefined);
      await this.#save([], [link.noteId]);
      return;
    }
    const written = await this.#files.receive(link.path, remote.markdown);
    await this.#linkSynced(remote, written.id);
  }

  async #linkSynced(remote: RemoteNote, path: string): Promise<void> {
    const syncedHash = await this.#hash(remote.markdown);
    await this.#save([
      { noteId: remote.id, path, baseRevision: remote.revision, syncedHash, blocked: null },
    ]);
  }

  /** Another account, or a new key: every file is matched with the server again. */
  resetSync(): Promise<void> {
    return this.#serial(async () => {
      const links = [...this.#links.values()];
      await this.#save(
        links
          .filter((link) => link.path !== null)
          .map((link) => ({ ...link, baseRevision: null, syncedHash: null, blocked: null })),
        links.filter((link) => link.path === null).map((link) => link.noteId),
      );
      await this.#db.setSyncCursor(0);
      this.#adopting = true;
      await this.#saveState();
    });
  }

  pulled(): Promise<boolean> {
    return this.#serial(async () => {
      if (!this.#adopting) return false;
      this.#adopting = false;
      await this.#saveState();
      return true;
    });
  }

  syncCursor(): Promise<number> {
    return this.#db.syncCursor();
  }

  setSyncCursor(cursor: number): Promise<void> {
    return this.#db.setSyncCursor(cursor);
  }

  loadMeta(key: string): Promise<unknown> {
    return this.#db.loadMeta(key);
  }

  saveMeta(key: string, value: unknown): Promise<void> {
    return this.#db.saveMeta(key, value);
  }

  // --- Links -----------------------------------------------------------------

  async #entry(link: FolderLink): Promise<SyncEntry> {
    const deleted = link.path === null;
    return {
      noteId: link.noteId,
      baseRevision: link.baseRevision,
      dirty: deleted || (await this.#isDirty(link)),
      deleted,
      blocked: link.blocked,
    };
  }

  async #isDirty(link: FolderLink): Promise<boolean> {
    if (link.path === null || link.syncedHash === null) return true;
    const file = await this.#files.get(link.path);
    return file !== undefined && (await this.#hashOf(file)) !== link.syncedHash;
  }

  /** A file that never reached the server with exactly this text, if any. */
  async #unsyncedTwin(markdown: string): Promise<{ noteId: string; path: string } | null> {
    const twins = await this.#twinIndex();
    const id = twins.get(markdown);
    const link = id === undefined ? undefined : this.#links.get(id);
    if (!link || link.baseRevision !== null || link.path === null) return null;
    if ((await this.#files.get(link.path))?.markdown !== markdown) return null; // Edited since.
    twins.delete(markdown);
    return { noteId: link.noteId, path: link.path };
  }

  /**
   * Text → id of the files that never reached the server, so matching a whole
   * pull takes one pass. Built once, then extended with the links saved since;
   * entries gone stale are checked on use.
   */
  #twins: Map<string, string> | null = null;
  #newTwins = new Set<string>();

  async #twinIndex(): Promise<Map<string, string>> {
    const ids = this.#twins === null ? [...this.#links.keys()] : [...this.#newTwins];
    this.#twins ??= new Map();
    this.#newTwins.clear();
    for (const id of ids) {
      const link = this.#links.get(id);
      if (!link || link.baseRevision !== null || link.path === null) continue;
      const file = await this.#files.get(link.path);
      if (file && !this.#twins.has(file.markdown)) this.#twins.set(file.markdown, id);
    }
    return this.#twins;
  }

  async #save(links: readonly FolderLink[], removed: readonly string[] = []): Promise<void> {
    if (links.length === 0 && removed.length === 0) return;
    for (const id of removed) this.#unindex(id);
    for (const link of links) {
      this.#index(link);
      if (link.baseRevision === null) this.#newTwins.add(link.noteId);
    }
    await this.#db.saveFolderLinks(links, removed);
  }

  #index(link: FolderLink): void {
    this.#unindex(link.noteId);
    this.#links.set(link.noteId, link);
    if (link.path !== null) this.#byPath.set(link.path, link.noteId);
  }

  #unindex(noteId: string): void {
    const path = this.#links.get(noteId)?.path;
    if (path != null && this.#byPath.get(path) === noteId) this.#byPath.delete(path);
    this.#links.delete(noteId);
  }

  #saveState(): Promise<void> {
    return this.#db.saveMeta(STATE_KEY, {
      folder: this.#folder,
      adopting: this.#adopting,
    } satisfies State);
  }

  async #hashOf(file: Note): Promise<string> {
    const known = this.#hashes.get(file.id);
    if (known?.markdown === file.markdown) return known.hash;
    const hash = await this.#hash(file.markdown);
    this.#hashes.set(file.id, { markdown: file.markdown, hash });
    return hash;
  }

  async #hash(markdown: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** One thing at a time: file changes and sync never interleave their link updates. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

function newLink(path: string): FolderLink {
  return { noteId: crypto.randomUUID(), path, baseRevision: null, syncedHash: null, blocked: null };
}

/** A stored link; anything malformed is dropped (its file is linked anew). */
function parseLink(value: unknown): FolderLink[] {
  if (typeof value !== "object" || value === null) return [];
  const { noteId, path, baseRevision, syncedHash, blocked } = value as Record<string, unknown>;
  if (typeof noteId !== "string" || noteId === "") return [];
  if (path !== null && typeof path !== "string") return [];
  if (
    baseRevision !== null &&
    !(typeof baseRevision === "number" && Number.isInteger(baseRevision))
  )
    return [];
  if (syncedHash !== null && typeof syncedHash !== "string") return [];
  try {
    return [{ noteId, path, baseRevision, syncedHash, blocked: parseSyncBlock(blocked) }];
  } catch {
    return [];
  }
}

function parseState(value: unknown): State | null {
  if (typeof value !== "object" || value === null) return null;
  const { folder, adopting } = value as Record<string, unknown>;
  return typeof folder === "string" ? { folder, adopting: adopting === true } : null;
}
