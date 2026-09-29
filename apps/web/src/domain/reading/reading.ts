/** Where the reader was in a note. Kept apart from the note; never in its Markdown. */
export type ReadingState = {
  readonly noteId: string;
  /** Scroll position as a fraction of the scrollable height, 0–1. */
  readonly position: number;
  /** ISO 8601 timestamp of when it was saved. */
  readonly updatedAt: string;
};

export type ReadingPositionMode = "restore" | "ask" | "off";

export class InvalidReadingStateError extends Error {
  override readonly name = "InvalidReadingStateError";
}

export function parseReadingState(value: unknown): ReadingState {
  if (typeof value !== "object" || value === null) {
    throw new InvalidReadingStateError("Reading state is not an object");
  }
  const { noteId, position, updatedAt } = value as Record<string, unknown>;
  if (typeof noteId !== "string" || noteId === "") {
    throw new InvalidReadingStateError("Reading state has no note id");
  }
  if (typeof position !== "number" || !(position >= 0 && position <= 1)) {
    throw new InvalidReadingStateError(`Reading state for ${noteId} has an invalid position`);
  }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    throw new InvalidReadingStateError(`Reading state for ${noteId} has an invalid date`);
  }
  return { noteId, position, updatedAt };
}

/** Scroll offset → position, or null when the page does not scroll. */
export function scrollToPosition(scrollTop: number, scrollHeight: number, viewport: number) {
  const scrollable = scrollHeight - viewport;
  if (scrollable <= 0) return null;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}

/** Position → scroll offset for the current layout. */
export function positionToScroll(position: number, scrollHeight: number, viewport: number) {
  return Math.round(position * Math.max(0, scrollHeight - viewport));
}
