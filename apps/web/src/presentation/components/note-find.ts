import { createContext } from "react";

/** A search in the open note, as the editors show it. */
export type NoteFind = {
  readonly query: string;
  /** The selected match, counted from the first (editors clamp it to their matches). */
  readonly selected: number;
  /**
   * A new number each time the selected match should be scrolled to (the
   * query or the selection changed). An editor that opens with a search under
   * way marks the matches without scrolling.
   */
  readonly reveal: number;
};

export const NO_FIND: NoteFind = { query: "", selected: 0, reveal: 0 };

/**
 * From the layout (the top bar's search box) to the note page: what to find
 * in the note, and back how many matches there are. The note page clears the
 * search when it closes, so it belongs to one note.
 */
export type NoteFindChannel = {
  readonly find: NoteFind;
  readonly onCount: (count: number) => void;
  readonly onClose: () => void;
};

export const NoteFindContext = createContext<NoteFindChannel | null>(null);

/**
 * Scrolls the page so that `rect` (a match, in window coordinates) is in the
 * middle of what can be seen of it: below the sticky top bar.
 */
export function revealMatch(rect: DOMRect): void {
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const middle = top + (window.innerHeight - top) / 2;
  window.scrollTo({ top: window.scrollY + rect.top + rect.height / 2 - middle });
}
