import {
  InvalidDocumentError,
  documentTitle,
  formatTimestamp,
  parseDocument,
  updateMetadata,
  type MarkdownDocument,
} from "../document/document";
import { parseTags, type Tag } from "../tag/tags";

/**
 * A stored note: an id plus its Markdown document. Everything else (title,
 * dates, cover) is read from the document's frontmatter.
 */
export type Note = {
  readonly id: string;
  readonly markdown: string;
  /**
   * When the storage last saw the note change (a file's modification time),
   * used for ordering when the document has no `updated` date. Not stored.
   */
  readonly modifiedAt?: string;
};

export class InvalidNoteError extends Error {
  override readonly name = "InvalidNoteError";
}

/**
 * A note whose document has been parsed. A note with invalid frontmatter is
 * still a note: it can be listed, opened, fixed and deleted.
 */
export type ReadNote =
  | { readonly note: Note; readonly valid: true; readonly document: MarkdownDocument }
  | { readonly note: Note; readonly valid: false; readonly error: InvalidDocumentError };

/**
 * A new note from the given Markdown, with `created` (unless the text already
 * has one) and `updated` set in its frontmatter. Throws InvalidDocumentError.
 */
export function createNote(markdown: string, now: Date, id: string = crypto.randomUUID()): Note {
  return { id, markdown: stampDates(markdown, now, null) };
}

/**
 * The note with new Markdown and `updated` set to now. `created` is kept from
 * the previous version if the new text drops it. Throws InvalidDocumentError.
 */
export function updateNote(note: Note, markdown: string, now: Date): Note {
  const previous = readNote(note);
  const created = previous.valid ? previous.document.metadata.created : null;
  const { modifiedAt: _stale, ...rest } = note;
  return { ...rest, markdown: stampDates(markdown, now, created) };
}

function stampDates(markdown: string, now: Date, fallbackCreated: string | null): string {
  const { metadata } = parseDocument(markdown);
  const timestamp = formatTimestamp(now);
  return updateMetadata(markdown, {
    created: metadata.created ?? fallbackCreated ?? timestamp,
    updated: timestamp,
  });
}

/** Validates a stored record and returns it as a Note. */
export function parseNote(value: unknown): Note {
  if (typeof value !== "object" || value === null) {
    throw new InvalidNoteError("Note record is not an object");
  }
  const { id, markdown } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    throw new InvalidNoteError("Note record has no id");
  }
  if (typeof markdown !== "string") {
    throw new InvalidNoteError(`Note ${id} has no Markdown text`);
  }
  return { id, markdown };
}

export function readNote(note: Note): ReadNote {
  try {
    return { note, valid: true, document: parseDocument(note.markdown) };
  } catch (error) {
    if (error instanceof InvalidDocumentError) {
      return { note, valid: false, error };
    }
    throw error;
  }
}

/** Parses notes and orders them most recently updated first. */
export function readNotes(notes: readonly Note[]): ReadNote[] {
  return notes.map(readNote).sort(byMostRecent);
}

/** The title from the frontmatter or the first line; empty if there is none or it is unreadable. */
export function noteTitle(read: ReadNote): string {
  return read.valid ? documentTitle(read.document) : "";
}

/** The document's `updated` date, else the storage's modification time. */
export function noteUpdated(read: ReadNote): string | null {
  return (read.valid ? read.document.metadata.updated : null) ?? read.note.modifiedAt ?? null;
}

/**
 * Most recently updated first. Notes without a readable `updated` date come
 * last. Ties are broken by id for a stable order.
 */
export function byMostRecent(a: ReadNote, b: ReadNote): number {
  const aTime = updatedTime(a);
  const bTime = updatedTime(b);
  if (aTime !== bTime) {
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return bTime - aTime;
  }
  return a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0;
}

function updatedTime(read: ReadNote): number | null {
  const updated = noteUpdated(read);
  return updated === null ? null : Date.parse(updated);
}

/** The tags written in the note's body; none if its document is invalid. */
export function noteTags(read: ReadNote): Tag[] {
  return read.valid ? parseTags(read.document.body) : [];
}
