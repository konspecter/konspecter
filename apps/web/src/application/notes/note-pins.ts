import { recentNotes, type NoteSummary } from "./note-catalog";
import type { NoteRepository } from "./note-repository";

/** The keys a note can be pinned to (Ctrl+1…0), in the order Recent lists the pins. */
export const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export type PinKey = (typeof PIN_KEYS)[number];

/** Which note each key holds. A key holds one note and a note one key. */
export type Pins = Readonly<Partial<Record<PinKey, string>>>;

export type PinnedNote = { readonly key: PinKey; readonly note: NoteSummary };

export function isPinKey(value: string): value is PinKey {
  return (PIN_KEYS as readonly string[]).includes(value);
}

/** The pins without the note `noteId`. */
function without(pins: Pins, noteId: string): Partial<Record<PinKey, string>> {
  return Object.fromEntries(Object.entries(pins).filter(([, id]) => id !== noteId));
}

/**
 * Ctrl+key on a note: unpins it when the key holds it already, else pins it
 * there, taking the key from another note and the note from another key.
 */
export function togglePin(pins: Pins, key: PinKey, noteId: string): Pins {
  if (pins[key] === noteId) return without(pins, noteId);
  return { ...without(pins, noteId), [key]: noteId };
}

/** A renamed note (File Mode: its file moved) keeps its key. */
export function renamePinned(pins: Pins, from: string, to: string): Pins {
  const key = PIN_KEYS.find((pin) => pins[pin] === from);
  return key === undefined ? pins : { ...without(pins, to), [key]: to };
}

/** Validates stored pins: unknown keys, ids that are not strings and repeated notes are dropped. */
export function parsePins(value: unknown): Pins {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const pins: Partial<Record<PinKey, string>> = {};
  const seen = new Set<string>();
  for (const key of PIN_KEYS) {
    const id = record[key];
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    pins[key] = id;
  }
  return pins;
}

/**
 * The sidebar's Recent: the pinned notes first, by key (1…9, then 0), then
 * the notes of the last week (`recentNotes`) that are not pinned. Pins of
 * notes that are gone are not listed.
 */
export function recentWithPins(
  notes: readonly NoteSummary[],
  pins: Pins,
  now: Date,
): { pinned: PinnedNote[]; recent: NoteSummary[] } {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const pinned = PIN_KEYS.flatMap((key) => {
    const note = byId.get(pins[key] ?? "");
    return note ? [{ key, note }] : [];
  });
  const pinnedIds = new Set(pinned.map(({ note }) => note.id));
  return { pinned, recent: recentNotes(notes, now).filter((note) => !pinnedIds.has(note.id)) };
}

const PINS_KEY = "konspecter.pins";

/**
 * The pins of this device, kept in its storage (like the sidebar's folded
 * panes; a factory reset clears them): an external store for
 * useSyncExternalStore. Without storage they last until the app closes.
 */
export class NotePins {
  readonly #storage: Pick<Storage, "getItem" | "setItem"> | null;
  readonly #listeners = new Set<() => void>();
  #pins: Pins;

  constructor(storage: Pick<Storage, "getItem" | "setItem"> | null) {
    this.#storage = storage;
    this.#pins = this.#read();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): Pins => this.#pins;

  toggle(key: PinKey, noteId: string): void {
    this.#set(togglePin(this.#pins, key, noteId));
  }

  /** Keeps the pins on renamed notes. Returns a function that stops following. */
  follow(store: NoteRepository): () => void {
    return store.onChange(({ noteId, previousId }) => {
      if (previousId !== undefined) this.#set(renamePinned(this.#pins, previousId, noteId));
    });
  }

  #set(pins: Pins): void {
    if (pins === this.#pins) return;
    this.#pins = pins;
    try {
      this.#storage?.setItem(PINS_KEY, JSON.stringify(pins));
    } catch {
      // A per-device convenience; without storage the pins last until the app closes.
    }
    for (const listener of this.#listeners) listener();
  }

  #read(): Pins {
    try {
      const saved = this.#storage?.getItem(PINS_KEY);
      return saved ? parsePins(JSON.parse(saved)) : {};
    } catch {
      return {};
    }
  }
}
