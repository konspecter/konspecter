import { plainText } from "../../domain/document/plain-text";
import {
  noteTitle,
  noteUpdated,
  noteWrittenTags,
  readNote,
  type Note,
} from "../../domain/note/note";
import { parseTagChain, writtenTagList, type Tag } from "../../domain/tag/tags";
import type { NoteChange, NoteRepository } from "./note-repository";

/** What lists show of a note, without keeping its whole text in memory. */
export type NoteSummary = {
  readonly id: string;
  /** Empty when the note has no title. */
  readonly title: string;
  readonly updated: string | null;
  /** The cover's URL or path, as the frontmatter writes it. */
  readonly cover: string | null;
  /** The note's tags as written, a chain as its tags (`#java#maps` → java, maps). */
  readonly tags: readonly string[];
  /** The start of the note's readable text, without the heading that is its title. */
  readonly excerpt: string;
  /** False when the frontmatter cannot be read. */
  readonly valid: boolean;
};

export type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "ready"; readonly notes: readonly NoteSummary[] };

const EXCERPT_SOURCE = 800;
const EXCERPT_LENGTH = 200;

export function summarize(note: Note): NoteSummary {
  const read = readNote(note);
  const title = noteTitle(read);
  const blocks = (
    read.valid ? plainText(read.document.body.slice(0, EXCERPT_SOURCE)) : note.markdown
  ).split("\n");
  // Lists show the title already; do not repeat a leading heading.
  if (title !== "" && blocks[0]?.trim() === title) blocks.shift();
  return {
    id: note.id,
    title,
    updated: noteUpdated(read),
    cover: read.valid ? read.document.metadata.cover : null,
    tags: writtenTagList(noteWrittenTags(read)).map(({ written }) => written),
    excerpt: blocks.join(" ").replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH),
    valid: read.valid,
  };
}

/** The same order as `byMostRecent` for notes: newest first, undated last, then by id. */
export function byMostRecentSummary(a: NoteSummary, b: NoteSummary): number {
  const aTime = a.updated === null ? null : Date.parse(a.updated);
  const bTime = b.updated === null ? null : Date.parse(b.updated);
  if (aTime !== bTime) {
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return bTime - aTime;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** By title, untitled notes last, then by id. */
function byTitleSummary(a: NoteSummary, b: NoteSummary): number {
  if ((a.title === "") !== (b.title === "")) return a.title === "" ? 1 : -1;
  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  if (byTitle !== 0) return byTitle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The notes with a tag chain that ends in `tag`, by title: the documents
 * inside a tag in the tag tree. A note written `#java#collections` sits in
 * collections, not in java; one written `#java #collections` sits in both.
 */
export async function notesInTag(store: NoteRepository, tag: Tag): Promise<NoteSummary[]> {
  const notes = await store.notesWithTag(tag);
  return notes
    .filter((note) =>
      noteWrittenTags(readNote(note)).some(
        (written) => parseTagChain(written)?.tags.at(-1)?.name === tag.name,
      ),
    )
    .map(summarize)
    .sort(byTitleSummary);
}

/**
 * Every note's summary, most recently edited first, for the sidebar and the
 * note list. Loaded once, then kept current one note at a time from the
 * repository's change events (local edits and remote ones), so a save does
 * not re-read the whole library. An external store for useSyncExternalStore.
 */
export class NoteCatalog {
  readonly #store: NoteRepository;
  readonly #listeners = new Set<() => void>();
  readonly #notes = new Map<string, NoteSummary>();
  /** Per note, the latest change being read; older reads are dropped. */
  readonly #reads = new Map<string, number>();
  #state: CatalogState = { status: "loading" };
  #loading: Promise<void> | null = null;
  #reloadAfterLoad = false;
  #readCount = 0;

  constructor(store: NoteRepository) {
    this.#store = store;
  }

  /** Loads the notes and follows changes. Returns a function that stops following. */
  start(): () => void {
    const stop = this.#store.onChange((change) => {
      this.#apply(change);
    });
    void this.reload();
    return stop;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): CatalogState => this.#state;

  /** Reads every note again (also the way to retry after an error). */
  reload(): Promise<void> {
    if (this.#loading) {
      this.#reloadAfterLoad = true;
      return this.#loading;
    }
    this.#loading = this.#store.list().then(
      (notes) => {
        this.#notes.clear();
        for (const note of notes) this.#notes.set(note.id, summarize(note));
        this.#publish();
      },
      (error: unknown) => {
        this.#state = { status: "error", error };
        this.#notify();
      },
    );
    return this.#loading.finally(() => {
      this.#loading = null;
      if (this.#reloadAfterLoad) {
        this.#reloadAfterLoad = false;
        void this.reload();
      }
    });
  }

  #apply(change: NoteChange): void {
    if (this.#loading) {
      // The list being read may predate this change: read it again afterwards.
      this.#reloadAfterLoad = true;
      return;
    }
    if (change.previousId !== undefined && this.#notes.delete(change.previousId)) {
      this.#publish();
    }
    const id = change.noteId;
    const read = (this.#readCount += 1);
    this.#reads.set(id, read);
    this.#store.get(id).then(
      (note) => {
        if (this.#reads.get(id) !== read) return;
        this.#reads.delete(id);
        if (note) this.#notes.set(id, summarize(note));
        else this.#notes.delete(id);
        this.#publish();
      },
      () => {
        if (this.#reads.get(id) === read) this.#reads.delete(id);
        void this.reload();
      },
    );
  }

  #publish(): void {
    this.#state = { status: "ready", notes: [...this.#notes.values()].sort(byMostRecentSummary) };
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
