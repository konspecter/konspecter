import type { PinKey } from "../../domain/document/document";
import { documentHeadings, type Heading } from "../../domain/document/outline";
import { inlinePlainText, plainText } from "../../domain/document/plain-text";
import {
  noteTitle,
  noteUpdated,
  noteWrittenTags,
  readNote,
  type Note,
} from "../../domain/note/note";
import { writtenTagList } from "../../domain/tag/tags";
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
  /**
   * The note's headings up to h3, for the tree's outline: not the leading one
   * that is its title, nor empty ones. Their `index` still counts every heading.
   * Empty unless asked for (`SummaryOptions`): finding them reads the whole body.
   */
  readonly headings: readonly Heading[];
  /** The key the frontmatter pins the note to (`pin: 3`), if any. */
  readonly pin: PinKey | null;
  /** False when the frontmatter cannot be read. */
  readonly valid: boolean;
};

export type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "ready"; readonly notes: readonly NoteSummary[] };

const EXCERPT_SOURCE = 800;
const EXCERPT_LENGTH = 200;
/**
 * Within a burst of changes (an import, a first sync) the list is published at
 * most this often: each publish sorts every note and re-renders the sidebar.
 */
const PUBLISH_INTERVAL = 100;

/** What a summary holds beyond the defaults. */
export type SummaryOptions = {
  /** The headings, for the tree's outline (Settings → Headings in the sidebar). */
  readonly headings?: boolean;
};

export function summarize(note: Note, { headings = false }: SummaryOptions = {}): NoteSummary {
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
    headings: headings && read.valid ? outlineHeadings(read.document.body, title) : [],
    pin: read.valid ? read.document.metadata.pin : null,
    valid: read.valid,
  };
}

/** The body's headings without the leading one that repeats the title, and without empty ones. */
function outlineHeadings(body: string, title: string): Heading[] {
  const headings = documentHeadings(body);
  const [first] = headings;
  const leading =
    first !== undefined &&
    // The title is the line as written (`# Hash *maps*` gives `Hash *maps*`).
    first.text === inlinePlainText(title).trim() &&
    body.split("\n", first.line).every((line) => line.trim() === "");
  return headings.filter((heading) => heading.text !== "" && !(leading && heading === first));
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
 * The notes with these ids, by title: the documents inside a folder of the
 * tag tree (`TagNode.noteIds`). Ids without a note are skipped.
 */
export async function notesInFolder(
  store: NoteRepository,
  noteIds: readonly string[],
  options: SummaryOptions = {},
): Promise<NoteSummary[]> {
  const notes = await Promise.all(noteIds.map((id) => store.get(id)));
  return notes
    .filter((note): note is Note => note !== undefined)
    .map((note) => summarize(note, options))
    .sort(byTitleSummary);
}

/** How far back the sidebar's recent notes go. */
const RECENT_DAYS = 7;

/**
 * The notes created or edited in the last week before `now`, in their order
 * (newest first): the sidebar's recent notes. Undated notes are not recent.
 */
export function recentNotes(notes: readonly NoteSummary[], now: Date): NoteSummary[] {
  const since = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return notes.filter((note) => note.updated !== null && Date.parse(note.updated) >= since);
}

/**
 * The notes without a tag, by title: the documents at the root of the tag
 * tree, beside the tag folders.
 */
export function untaggedNotes(notes: readonly NoteSummary[]): NoteSummary[] {
  return notes.filter((note) => note.tags.length === 0).sort(byTitleSummary);
}

/**
 * Every note's summary, most recently edited first, for the sidebar and the
 * note list. Loaded once, then kept current one note at a time from the
 * repository's change events (local edits and remote ones), so a save does
 * not re-read the whole library. A lone change shows at once; a burst of them
 * shows every PUBLISH_INTERVAL. An external store for useSyncExternalStore.
 */
export class NoteCatalog {
  readonly #store: NoteRepository;
  #options: SummaryOptions;
  readonly #listeners = new Set<() => void>();
  readonly #notes = new Map<string, NoteSummary>();
  /** Per note, the latest change being read; older reads are dropped. */
  readonly #reads = new Map<string, number>();
  #state: CatalogState = { status: "loading" };
  #loading: Promise<void> | null = null;
  #reloadAfterLoad = false;
  #readCount = 0;
  #publishedAt = Number.NEGATIVE_INFINITY;
  #publishTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(store: NoteRepository, options: SummaryOptions = {}) {
    this.#store = store;
    this.#options = options;
  }

  /**
   * Whether the summaries hold the notes' headings. A change reads every note
   * again, so the headings appear (or the memory they took is let go).
   */
  setHeadings(headings: boolean): void {
    if (headings === (this.#options.headings ?? false)) return;
    this.#options = { ...this.#options, headings };
    void this.reload();
  }

  /** Loads the notes and follows changes. Returns a function that stops following. */
  start(): () => void {
    const stop = this.#store.onChange((change) => {
      this.#apply(change);
    });
    void this.reload();
    return () => {
      stop();
      clearTimeout(this.#publishTimer);
      this.#publishTimer = undefined;
    };
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
        for (const note of notes) this.#notes.set(note.id, summarize(note, this.#options));
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
      this.#publishSoon();
    }
    const id = change.noteId;
    const read = (this.#readCount += 1);
    this.#reads.set(id, read);
    this.#store.get(id).then(
      (note) => {
        if (this.#reads.get(id) !== read) return;
        this.#reads.delete(id);
        if (note) this.#notes.set(id, summarize(note, this.#options));
        else this.#notes.delete(id);
        this.#publishSoon();
      },
      () => {
        if (this.#reads.get(id) === read) this.#reads.delete(id);
        void this.reload();
      },
    );
  }

  /** Publishes now, or, if the last publish was under PUBLISH_INTERVAL ago, then. */
  #publishSoon(): void {
    if (this.#publishTimer !== undefined) return;
    const wait = this.#publishedAt + PUBLISH_INTERVAL - Date.now();
    if (wait <= 0) this.#publish();
    else
      this.#publishTimer = setTimeout(() => {
        this.#publish();
      }, wait);
  }

  #publish(): void {
    clearTimeout(this.#publishTimer);
    this.#publishTimer = undefined;
    this.#publishedAt = Date.now();
    this.#state = { status: "ready", notes: [...this.#notes.values()].sort(byMostRecentSummary) };
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
