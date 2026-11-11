import type { WipeReceipt } from "../../infrastructure/sync/sync-engine";

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
  /**
   * Desktop: forgets the connected Markdown folders (the next start connects
   * ~/Konspecter). Their files stay as they are.
   */
  forgetFolders?: (() => Promise<void>) | undefined;
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
  await parts.forgetFolders?.();
  await parts.store.erase();
  try {
    parts.storage.clear();
  } catch {
    // Without storage there is nothing to clear.
  }
}

/** Makes the next start say that the device was wiped (localStorage). */
const WIPED_KEY = "konspecter.wiped";
/** The wiped device's receipt, kept until the server has heard it (localStorage). */
const RECEIPT_KEY = "konspecter.wipeReceipt";

export type WipeParts = {
  /** Desktop: deletes the files sync covers, for good. */
  deleteFiles?: (() => Promise<unknown>) | undefined;
  /** The app library, settings, reading positions, indexes and sync's own records. */
  store: { erase(): Promise<void> };
  /** Desktop: forgets the connected folders. */
  forgetFolders?: (() => Promise<void>) | undefined;
  /** Forgets the token kept outside the database (the desktop's keychain). */
  sync: { forgetToken(): Promise<void> };
  storage: Pick<Storage, "clear" | "setItem">;
  /** What tells the server, at the next start, that the wipe is done. */
  receipt: WipeReceipt;
  /** Hears a failure that does not stop the wipe. */
  report: (error: unknown) => void;
};

/**
 * The device was disconnected on the site to be wiped: the synced files go
 * for good, then everything the app keeps, as in a factory reset. The server
 * hears it is done only after that: the receipt is kept for the next start
 * (`sendWipeReceipt`). If the database cannot be erased, nothing is
 * confirmed and the token stays, so the next start wipes again. A file that
 * cannot be deleted does not keep the rest.
 */
export async function wipe(parts: WipeParts): Promise<void> {
  try {
    await parts.deleteFiles?.();
  } catch (error) {
    parts.report(error);
  }
  await parts.store.erase();
  await parts.forgetFolders?.();
  try {
    parts.storage.clear();
    parts.storage.setItem(RECEIPT_KEY, JSON.stringify(parts.receipt));
    parts.storage.setItem(WIPED_KEY, "yes");
  } catch {
    // Without storage the server is not told; the site lets its owner remove the device.
  }
  await parts.sync.forgetToken();
}

/** Whether the device was wiped just before this start; true only once. */
export function takeWipedNotice(storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  try {
    const wiped = storage.getItem(WIPED_KEY) !== null;
    if (wiped) storage.removeItem(WIPED_KEY);
    return wiped;
  } catch {
    return false;
  }
}

function readReceipt(storage: Pick<Storage, "getItem">): WipeReceipt | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECEIPT_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { serverUrl, token } = value as Record<string, unknown>;
    return typeof serverUrl === "string" && typeof token === "string" ? { serverUrl, token } : null;
  } catch {
    return null;
  }
}

/** Between tries to send the receipt, in one run of the app; the next start tries again. */
const RECEIPT_RETRIES_MS = [5_000, 30_000, 120_000, 600_000];

/**
 * Tells the server a wipe is done, if one is waiting to be told: tries now,
 * then a few more times while the app runs, and forgets the receipt once the
 * server has heard it.
 */
export async function sendWipeReceipt(
  storage: Pick<Storage, "getItem" | "removeItem">,
  confirm: (receipt: WipeReceipt) => Promise<boolean>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  const receipt = readReceipt(storage);
  if (!receipt) return false;
  for (const delay of [0, ...RECEIPT_RETRIES_MS]) {
    if (delay > 0) await wait(delay);
    if (await confirm(receipt)) {
      try {
        storage.removeItem(RECEIPT_KEY);
      } catch {
        // Sent again next time: the server answers the same.
      }
      return true;
    }
  }
  return false;
}
