import {
  frontmatterTags,
  InvalidDocumentError,
  documentTitle,
  bodyFirstLine,
  formatTimestamp,
  parseDocument,
  replaceBody,
  setFrontmatterTags,
  updateMetadata,
  type MarkdownDocument,
} from "../document/document";
import { plainText } from "../document/plain-text";
import { parseTagName, writtenTags, type Tag } from "../tag/tags";

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

/**
 * `text` with the dates a save wrote into `saved` (`created`, `updated`), so
 * an editor's document shows what is stored. Everything else in `text` stays
 * as it is, so text typed while the save ran is kept. Returns `text` itself
 * when nothing changes or either document is invalid.
 */
export function withSavedDates(text: string, saved: Note): string {
  try {
    const { created, updated } = parseDocument(saved.markdown).metadata;
    const current = parseDocument(text).metadata;
    if (current.created === created && current.updated === updated) return text;
    return updateMetadata(text, { created, updated });
  } catch {
    return text;
  }
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

/**
 * The note's tags: those listed in the frontmatter's `tags` field, then those
 * written in the body, each once (by name). None if its document is invalid.
 */
export function noteTags(read: ReadNote): Tag[] {
  return noteWrittenTags(read).flatMap((written) => parseTagName(written) ?? []);
}

/** The note's tags as written, case kept, in the order of `noteTags`. */
export function noteWrittenTags(read: ReadNote): string[] {
  if (!read.valid) return [];
  const seen = new Map<string, string>();
  for (const written of [
    ...frontmatterTags(read.note.markdown),
    ...writtenTags(read.document.body),
  ]) {
    const tag = parseTagName(written);
    if (tag && !seen.has(tag.name)) seen.set(tag.name, written);
  }
  return [...seen.values()];
}

/**
 * The title a body's first non-blank line gives, as readable text: without
 * heading markers or inline Markdown (`# Using **maps**` → `Using maps`).
 */
export function firstLineTitle(body: string): string {
  return plainText(bodyFirstLine(body)).replace(/\s+/g, " ").trim();
}

/**
 * `markdown` with its body replaced by `body` (the text editor's), and its
 * frontmatter following what the body now says, so the title and tags the
 * app shows are always the document's own `title` and `tags`:
 *
 * - `title` becomes the body's first line (`firstLineTitle`) while it is
 *   absent or still equal to the previous body's first line. A title set to
 *   something else is the author's and is kept.
 * - `tags` lists every tag written in the body. A tag that was in the
 *   previous body and no longer is leaves the list; tags only ever listed in
 *   the frontmatter stay.
 *
 * Everything else is kept as written. With invalid frontmatter only the body
 * is replaced.
 */
export function withBody(markdown: string, body: string): string {
  let previous: MarkdownDocument;
  try {
    previous = parseDocument(markdown);
  } catch (error) {
    if (error instanceof InvalidDocumentError) return replaceBody(markdown, body);
    throw error;
  }
  let result = replaceBody(markdown, body);

  const current = previous.metadata.title?.trim() ?? "";
  const following = current === "" || current === firstLineTitle(previous.body);
  const next = firstLineTitle(body);
  if (following && next !== current) {
    result = updateMetadata(result, { title: next === "" ? null : next });
  }

  const tagName = (written: string) => parseTagName(written)?.name;
  const before = new Set(writtenTags(previous.body).map(tagName));
  const written = writtenTags(body);
  const now = new Set(written.map(tagName));
  const listed = frontmatterTags(markdown);
  const kept = listed.filter((entry) => {
    const name = tagName(entry);
    return name === undefined || !before.has(name) || now.has(name);
  });
  const keptNames = new Set(kept.map(tagName));
  const tags = [...kept, ...written.filter((entry) => !keptNames.has(tagName(entry)))];
  if (tags.length !== listed.length || tags.some((entry, index) => entry !== listed[index])) {
    result = setFrontmatterTags(result, tags);
  }
  return result;
}
