/**
 * Work that has to reach storage before the app closes: the open note's
 * autosave, and its reading position and caret. Each registers while it is
 * alive, and the desktop window waits for all of it before it closes.
 * (A browser closes a page without waiting; there the pagehide saves are what
 * there is.)
 */
const registered = new Set<() => Promise<void>>();

/** Registers `flush` (writes what is pending) until the returned function is called. */
export function saveBeforeClosing(flush: () => Promise<void>): () => void {
  registered.add(flush);
  return () => registered.delete(flush);
}

/** Writes everything pending. Never rejects: closing goes on regardless. */
export async function flushBeforeClosing(): Promise<void> {
  await Promise.all([...registered].map((flush) => flush().catch(() => undefined)));
}
