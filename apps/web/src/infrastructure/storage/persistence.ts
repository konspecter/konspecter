export type PersistenceStatus = "persistent" | "best-effort" | "unsupported";

/** Missing in older browsers and some embedded web views, despite the DOM types. */
function storageManager(): StorageManager | undefined {
  const storage: StorageManager | undefined = navigator.storage;
  return storage;
}

/**
 * Whether the browser may evict this app's storage (IndexedDB included) under
 * storage pressure. "persistent" means it will only be cleared by the user.
 */
export async function persistenceStatus(): Promise<PersistenceStatus> {
  const storage = storageManager();
  if (typeof storage?.persisted !== "function") return "unsupported";
  try {
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/**
 * Asks the browser to keep this app's storage. Some browsers decide silently,
 * others ask the user. Never throws.
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  const storage = storageManager();
  if (typeof storage?.persist !== "function") return "unsupported";
  try {
    return (await storage.persist()) ? "persistent" : "best-effort";
  } catch {
    return "best-effort";
  }
}
