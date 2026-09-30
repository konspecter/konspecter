import { InvalidDocumentError } from "../../domain/document/document";
import { updateNote, type Note } from "../../domain/note/note";
import type { NoteRepository } from "./note-repository";

export type AutosaveEvents = {
  /** A new note's first save stored it: the editing continues under its id. */
  onCreated?: (note: Note) => void;
  onSaved?: (note: Note) => void;
  /** A save gave the note a new id (File Mode: the file was renamed after its title). */
  onRenamed?: (note: Note) => void;
  /** A save failed or the text is not a valid document; `null` once a save succeeds. */
  onProblem?: (problem: unknown) => void;
  /** True from the first unsaved change until it is written. */
  onBusy?: (busy: boolean) => void;
};

export type AutosaveOptions = {
  /** Quiet time after the last change before saving, in ms. */
  delay?: number;
  /** Longest time a change waits while typing continues, in ms. */
  maxWait?: number;
  /**
   * Quiet time before a new note is first stored while its first line is
   * still being typed. A File Mode note is named after its title when it is
   * created, so this keeps "Ha.md" from being made on the way to "Hash maps".
   */
  createDelay?: number;
  now?: () => Date;
};

/** Per repository and note id, the saves running or waiting to run. */
const saving = new WeakMap<NoteRepository, Map<string, Promise<void>>>();

function track(store: NoteRepository, noteId: string, save: Promise<void>): void {
  let notes = saving.get(store);
  if (!notes) {
    notes = new Map();
    saving.set(store, notes);
  }
  notes.set(noteId, save);
  void save.finally(() => {
    if (notes.get(noteId) === save) notes.delete(noteId);
  });
}

/**
 * Resolves once no save of `noteId` is running in `store`. Read a note only
 * then: an editor just left may still be writing its last changes, and
 * reading earlier would show the text before them.
 */
export async function savesSettled(store: NoteRepository, noteId: string): Promise<void> {
  for (
    let save = saving.get(store)?.get(noteId);
    save !== undefined;
    save = saving.get(store)?.get(noteId)
  ) {
    await save;
  }
}

/**
 * Saves an editor's text as it changes, without React: changes are coalesced
 * (a quiet `delay`, at most `maxWait` while typing continues), one write is in
 * flight at a time, and the latest text wins. The editor hands over a
 * function that produces its text, so it is serialized only when saved.
 *
 * A new note (no base) is created by its first non-blank save. The last
 * write wins: a save replaces whatever changed the stored version meanwhile
 * (sync, another program), since the edit being saved is the newest, and it
 * brings back a note deleted elsewhere.
 */
export class Autosave {
  readonly #store: NoteRepository;
  readonly #events: AutosaveEvents;
  readonly #delay: number;
  readonly #maxWait: number;
  readonly #createDelay: number;
  readonly #now: () => Date;
  /** The stored version this session last saw (loaded or written). */
  #base: Note | null;
  /** The editor text last written (or loaded), to skip saves that change nothing. */
  #written: string;
  #pending: (() => string) | null = null;
  /** Text whose write failed, tried again by the next change or flush. */
  #retry: string | null = null;
  #pendingSince: number | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  /** The last text could not be saved (invalid document, failed write). */
  #unsaved = false;
  #busy = false;
  #disposed = false;
  /** Whether events other than onBusy reach the editor (see detach). */
  #attached = true;

  constructor(
    store: NoteRepository,
    base: Note | null,
    events: AutosaveEvents = {},
    options: AutosaveOptions = {},
  ) {
    this.#store = store;
    this.#base = base;
    this.#written = base?.markdown ?? "";
    this.#events = events;
    this.#delay = options.delay ?? 400;
    this.#maxWait = options.maxWait ?? 1000;
    this.#createDelay = options.createDelay ?? 2000;
    this.#now = options.now ?? (() => new Date());
  }

  /** The stored note being edited; null until a new note's first save. */
  get note(): Note | null {
    return this.#base;
  }

  /** Whether some of the editor's text is not stored yet. */
  get dirty(): boolean {
    return this.#pending !== null || this.#running !== null || this.#unsaved;
  }

  /** The editor's text changed; `read` returns it. */
  change(read: () => string): void {
    if (this.#disposed) return;
    this.#pending = read;
    const now = Date.now();
    this.#pendingSince ??= now;
    this.#setBusy(true);
    clearTimeout(this.#timer);
    const wait = this.#titleInProgress(read)
      ? this.#createDelay
      : Math.min(this.#delay, Math.max(0, this.#pendingSince + this.#maxWait - now));
    this.#timer = setTimeout(() => void this.flush(), wait);
  }

  /** Saves any pending change now. Never rejects: problems go to `onProblem`. */
  flush(): Promise<void> {
    const done = this.#flush();
    const id = this.#base?.id;
    if (id !== undefined) track(this.#store, id, done);
    return done;
  }

  async #flush(): Promise<void> {
    clearTimeout(this.#timer);
    while (this.#running) await this.#running;
    const retry = this.#retry;
    const read = this.#pending ?? (retry === null ? null : () => retry);
    if (read === null || this.#disposed) {
      this.#setBusy(false);
      return;
    }
    this.#pending = null;
    this.#retry = null;
    this.#pendingSince = null;
    this.#running = this.#save(read).finally(() => {
      this.#running = null;
    });
    await this.#running;
    if (this.#idle()) this.#setBusy(false);
  }

  /**
   * The editor is gone (the user moved on): pending text is still saved, but
   * onCreated, onRenamed, onSaved and onProblem are no longer called. `attach` undoes it.
   */
  detach(): void {
    this.#attached = false;
  }

  attach(): void {
    this.#attached = true;
  }

  /** Adopts a version stored elsewhere (the editor now shows it). */
  rebase(note: Note): void {
    this.#base = note;
    this.#written = note.markdown;
    this.#unsaved = false;
  }

  /**
   * Stops saving and drops pending changes (the note is being deleted).
   * Resolves once a write already in flight has finished.
   */
  async dispose(): Promise<void> {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#pending = null;
    this.#retry = null;
    this.#setBusy(false);
    while (this.#running) await this.#running;
  }

  async #save(read: () => string): Promise<void> {
    let markdown: string;
    try {
      markdown = read();
    } catch (error) {
      this.#problem(error);
      return;
    }
    // Nothing new: the text last written, or the stored version itself (an
    // editor that took over the dates the last save wrote).
    const unchanged = markdown === this.#written || markdown === this.#base?.markdown;
    if (unchanged && !this.#unsaved) return;
    try {
      await this.#write(markdown);
      this.#unsaved = false;
      if (this.#attached) this.#events.onProblem?.(null);
    } catch (error) {
      // Keep the text: the next change or flush tries again.
      if (!(error instanceof InvalidDocumentError) && !this.#disposed) this.#retry = markdown;
      this.#problem(error);
    }
  }

  async #write(markdown: string): Promise<void> {
    const now = this.#now();
    const base = this.#base;
    if (base === null) {
      if (markdown.trim() === "") return;
      const note = await this.#store.create(markdown, now);
      this.#adopt(note, markdown);
      if (this.#attached) this.#events.onCreated?.(note);
      return;
    }
    const stored = await this.#store.put(updateNote(base, markdown, now));
    this.#adopt(stored, markdown);
    if (stored.id !== base.id && this.#attached) this.#events.onRenamed?.(stored);
  }

  #adopt(note: Note, markdown: string): void {
    this.#base = note;
    this.#written = markdown;
    if (this.#attached) this.#events.onSaved?.(note);
  }

  #problem(error: unknown): void {
    this.#unsaved = true;
    if (this.#attached) this.#events.onProblem?.(error);
  }

  /** A new note whose first line is still being typed (reading a new note's text is cheap). */
  #titleInProgress(read: () => string): boolean {
    if (this.#base !== null) return false;
    try {
      return !/\S[^\n]*\n/.test(read());
    } catch {
      return false;
    }
  }

  /** Nothing waits to be written (read through a method: it changes across awaits). */
  #idle(): boolean {
    return this.#pending === null;
  }

  #setBusy(busy: boolean): void {
    if (busy === this.#busy) return;
    this.#busy = busy;
    this.#events.onBusy?.(busy);
  }
}
