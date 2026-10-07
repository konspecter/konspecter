/** Settings' "Reset to factory settings": what it asks before, and the reset itself. */
export type FactoryReset = {
  /** How many conspects the app library holds; the reset erases them. */
  appNotes(): Promise<number>;
  /** Erases everything the app keeps and starts it afresh (the page reloads). */
  run(): Promise<void>;
};

/** One part per place the app keeps something. */
export type FactoryResetParts = {
  /** Signs this device out of sync and forgets the connection and its key. */
  sync: { forget(): Promise<void> };
  /** Desktop: forgets the chosen Markdown folder. Its files stay as they are. */
  closeFolder?: (() => Promise<void>) | undefined;
  /** The app library, settings, reading positions and indexes (IndexedDB). */
  store: { erase(): Promise<void> };
  /** The interface's own state: sidebar, toolbar, last location. */
  storage: Pick<Storage, "clear">;
};

/**
 * Clears what the app keeps, never the user's files: sync first, while its
 * connection can still be read from the database, the database last.
 */
export async function factoryReset(parts: FactoryResetParts): Promise<void> {
  await parts.sync.forget();
  await parts.closeFolder?.();
  await parts.store.erase();
  try {
    parts.storage.clear();
  } catch {
    // Without storage there is nothing to clear.
  }
}
