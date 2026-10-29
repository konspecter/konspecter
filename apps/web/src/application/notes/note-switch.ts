import { byMostRecentSummary, recentNotes, type NoteSummary } from "./note-catalog";

/**
 * Ctrl+Tab goes from note to note as an editor's tabs do. Pressed and let go,
 * it opens the note opened before this one, so pressed again it comes back:
 * a toggle between two notes. With Ctrl held, each further Tab goes one note
 * further back, round in a loop, and Shift+Tab one step back in the loop;
 * letting go of Ctrl settles on the note.
 * The order is the notes last opened, then those of Recent not opened yet.
 */

/** How many opened notes are remembered. */
const REMEMBERED = 50;

/** One Ctrl hold: the order it goes round, fixed while Ctrl is down, and where it is. */
export type NoteSwitch = { readonly order: readonly string[]; readonly index: number };

/** The opened notes, last opened first, after `id` was opened. */
export function noteOpened(opened: readonly string[], id: string): string[] {
  return [id, ...opened.filter((other) => other !== id)].slice(0, REMEMBERED);
}

/**
 * A new Ctrl hold from the note `current` (null away from a note): the notes
 * opened (that still exist), then the rest of Recent, newest edit first.
 */
export function startSwitch(
  opened: readonly string[],
  notes: readonly NoteSummary[],
  current: string | null,
  now: Date,
): NoteSwitch {
  const exists = new Set(notes.map((note) => note.id));
  const recent = recentNotes(notes, now).sort(byMostRecentSummary);
  const order = [
    ...new Set([
      ...(current === null ? [] : [current]),
      ...opened,
      ...recent.map((note) => note.id),
    ]),
  ].filter((id) => exists.has(id));
  return { order, index: current === null ? -1 : order.indexOf(current) };
}

/**
 * One Tab further (1) or Shift+Tab a step back in the loop (-1): the note to
 * open, and the hold after it; null when there is no other note. A step back
 * from the first note (or from away from a note) is round to the last.
 */
export function switchStep(
  state: NoteSwitch,
  step: 1 | -1 = 1,
): { id: string; next: NoteSwitch } | null {
  const { order, index } = state;
  if (order.length === 0) return null;
  const from = index === -1 && step === -1 ? 0 : index;
  const at = (from + step + order.length) % order.length;
  const id = order[at];
  if (id === undefined || at === index) return null;
  return { id, next: { order, index: at } };
}
