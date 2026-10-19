import { PIN_KEYS, updateMetadata, type PinKey } from "../../domain/document/document";
import { updateNote } from "../../domain/note/note";
import { savesSettled } from "./autosave";
import { byMostRecentSummary, recentNotes, summarize, type NoteSummary } from "./note-catalog";
import type { NoteRepository } from "./note-repository";

/**
 * A pin is the note's own frontmatter (`pin: 3`), so it syncs with the note
 * and is in its file (ADR-027). The pins here are read from the notes.
 */

/** Which note each key holds. A key holds one note and a note one key. */
export type Pins = Readonly<Partial<Record<PinKey, string>>>;

export type PinnedNote = { readonly key: PinKey; readonly note: NoteSummary };

/** A note whose `pin` is to be set to a key, or removed with null. */
export type PinChange = { readonly noteId: string; readonly pin: PinKey | null };

/**
 * The note each key holds. Two notes can claim one key (pinned on two devices
 * before they synced): the one edited last holds it, the others are not pinned.
 */
export function pinsOf(notes: readonly NoteSummary[]): Pins {
  const pins: Partial<Record<PinKey, string>> = {};
  for (const note of [...notes].sort(byMostRecentSummary)) {
    if (note.pin !== null && pins[note.pin] === undefined) pins[note.pin] = note.id;
  }
  return pins;
}

/**
 * Mod+Alt+key on a note: unpins it when the key holds it already, else pins
 * it there; every other note claiming the key lets it go. The changes to
 * write, the note itself last.
 */
export function pinChanges(
  notes: readonly NoteSummary[],
  key: PinKey,
  noteId: string,
): PinChange[] {
  if (pinsOf(notes)[key] === noteId) return [{ noteId, pin: null }];
  const others = notes
    .filter((note) => note.pin === key && note.id !== noteId)
    .map((note): PinChange => ({ noteId: note.id, pin: null }));
  return [...others, { noteId, pin: key }];
}

/**
 * The sidebar's Recent: the pinned notes first, by key (1…9, then 0), then
 * the notes of the last week (`recentNotes`) that are not pinned.
 */
export function recentWithPins(
  notes: readonly NoteSummary[],
  now: Date,
): { pinned: PinnedNote[]; recent: NoteSummary[] } {
  const pins = pinsOf(notes);
  const byId = new Map(notes.map((note) => [note.id, note]));
  const pinned = PIN_KEYS.flatMap((key) => {
    const note = byId.get(pins[key] ?? "");
    return note ? [{ key, note }] : [];
  });
  const pinnedIds = new Set(pinned.map(({ note }) => note.id));
  return { pinned, recent: recentNotes(notes, now).filter((note) => !pinnedIds.has(note.id)) };
}

/**
 * Sets a stored note's pin, after any save of it still running. It is an
 * edit like any other (`updated` moves on), so the last write wins when it
 * syncs. A note that is gone, or whose frontmatter cannot be read, is left
 * alone.
 */
export async function setStoredPin(
  store: NoteRepository,
  noteId: string,
  pin: PinKey | null,
  now: Date,
): Promise<void> {
  await savesSettled(store, noteId);
  const note = await store.get(noteId);
  if (!note) return;
  let markdown: string;
  try {
    markdown = updateMetadata(note.markdown, { pin });
  } catch {
    return;
  }
  if (markdown !== note.markdown) await store.put(updateNote(note, markdown, now));
}

const OLD_PINS_KEY = "konspecter.pins";

/**
 * Pins used to be kept per device (localStorage, `{ "3": "note id" }`). Moves
 * them into the notes, once, and forgets them on the device.
 */
export async function movePinsIntoNotes(
  store: NoteRepository,
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  now: Date,
): Promise<void> {
  let saved: unknown;
  try {
    const text = storage?.getItem(OLD_PINS_KEY);
    if (!text) return;
    storage?.removeItem(OLD_PINS_KEY);
    saved = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof saved !== "object" || saved === null) return;
  let notes = (await store.list()).map(summarize);
  for (const key of PIN_KEYS) {
    const noteId = (saved as Record<string, unknown>)[key];
    if (typeof noteId !== "string" || pinsOf(notes)[key] === noteId) continue;
    if (!notes.some((note) => note.id === noteId)) continue;
    for (const change of pinChanges(notes, key, noteId)) {
      await setStoredPin(store, change.noteId, change.pin, now);
    }
    notes = (await store.list()).map(summarize);
  }
}
