import { sealKeyForTransfer, type KeyTransfer } from "@konspecter/crypto";
import { useEffect, useState, type SubmitEvent } from "react";

/**
 * The account's content key, remembered in this browser, so the QR codes it
 * shows hand the key to the app too: the app then opens the conspects
 * without the passphrase (ADR-025). It is remembered where the passphrase
 * or the recovery key opened it on this site (encryption.tsx), for one
 * account at a time, and forgotten on sign-out, on reset, and when the
 * server's key is another one.
 *
 * It is kept in IndexedDB as an extractable CryptoKey, since sealing it for
 * an app needs its bytes. On the server, or where IndexedDB fails, nothing
 * is remembered and apps ask for the passphrase as before.
 */

const DB_NAME = "konspecter-site";
const STORE = "keys";
const ENTRY = "content";

interface Remembered {
  /** The signed-in account's email: another account's key is never used. */
  readonly account: string;
  readonly keyId: string;
  readonly key: CryptoKey;
}

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE);
  };
  return request(req);
}

async function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error("IndexedDB transaction failed"));
      };
    });
    const [result] = await Promise.all([request(use(tx.objectStore(STORE))), done]);
    return result;
  } finally {
    db.close();
  }
}

function isRemembered(value: unknown): value is Remembered {
  if (typeof value !== "object" || value === null) return false;
  const { account, keyId, key } = value as Record<string, unknown>;
  return typeof account === "string" && typeof keyId === "string" && key instanceof CryptoKey;
}

/** This account's remembered key, or null. */
async function load(account: string): Promise<Remembered | null> {
  try {
    const value: unknown = await withStore("readonly", (store) => store.get(ENTRY));
    return isRemembered(value) && value.account === account ? value : null;
  } catch (error) {
    console.error("The remembered key could not be read:", error);
    return null;
  }
}

/**
 * Remembers the raw content key `raw` (of `keyId`) for `account`, in place
 * of any key remembered before. `raw` is copied; the caller still owns it.
 */
export async function rememberKey(
  account: string,
  keyId: string,
  raw: Uint8Array<ArrayBuffer>,
): Promise<void> {
  try {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
    const entry: Remembered = { account, keyId, key };
    await withStore("readwrite", (store) => store.put(entry, ENTRY));
  } catch (error) {
    console.error("The key could not be remembered:", error);
  }
  changed();
}

/** Forgets the remembered key, whichever account's it is. */
export async function forgetKey(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(ENTRY));
  } catch (error) {
    console.error("The remembered key could not be forgotten:", error);
  }
  changed();
}

/**
 * Forgets the remembered key unless it is `account`'s key `keyId` (null:
 * the account has none): another account's, or a key reset since.
 */
export async function forgetKeyUnless(account: string, keyId: string | null): Promise<void> {
  const remembered = await load(account);
  if (remembered === null || remembered.keyId !== keyId) await forgetKey();
}

/** The remembered key sealed with a new one-time secret for one app; null if none. */
export async function sealRememberedKey(
  account: string,
): Promise<(KeyTransfer & { keyId: string }) | null> {
  const remembered = await load(account);
  if (!remembered) return null;
  try {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", remembered.key));
    try {
      return { keyId: remembered.keyId, ...(await sealKeyForTransfer(raw, remembered.keyId)) };
    } finally {
      raw.fill(0);
    }
  } catch (error) {
    console.error("The remembered key could not be sealed:", error);
    return null;
  }
}

/**
 * The id of the key this browser remembers for `account`: undefined until
 * known (and on the server), null when there is none.
 */
export function useRememberedKeyId(account: string): string | null | undefined {
  const [keyId, setKeyId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const refresh = () => {
      void load(account).then((remembered) => {
        if (current) setKeyId(remembered?.keyId ?? null);
      });
    };
    listeners.add(refresh);
    refresh();
    return () => {
      current = false;
      listeners.delete(refresh);
    };
  }, [account]);
  return keyId;
}

/**
 * For a sign-out form: forgets the remembered key first, then submits. The
 * form's fields go with it; a plain form (without a script) just submits.
 */
export function forgetKeyThenSubmit(event: SubmitEvent<HTMLFormElement>): void {
  event.preventDefault();
  const form = event.currentTarget;
  void forgetKey().finally(() => {
    form.submit();
  });
}
