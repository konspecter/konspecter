import { planResolution } from "../../domain/sync/conflicts";
import type { RemoteNote, SyncEntry } from "../../domain/sync/sync-state";
import {
  ApiClient,
  ApiError,
  NetworkError,
  RevisionConflictError,
  type Account,
  type ServerConfig,
} from "../http/api-client";
import type { NoteStore } from "../storage/note-store";

export type SyncState = "disabled" | "idle" | "syncing" | "offline" | "error";

export type SyncStatus = {
  readonly state: SyncState;
  readonly account: Account | null;
  readonly serverUrl: string | null;
  /** ISO 8601 time of the last completed cycle. */
  readonly lastSyncedAt: string | null;
  /** Local changes waiting to be pushed. */
  readonly pending: number;
  /** Notes held back: conflicts or changes the server refused. */
  readonly blocked: number;
  readonly error: string | null;
};

type StoredConfig = ServerConfig & { readonly account: Account };

/**
 * Where the access token is kept. Without one, it is stored with the rest of
 * the connection in IndexedDB; the desktop app keeps it in the OS keychain.
 */
export type CredentialStore = {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
};

export type Scheduler = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

export type SyncEngineOptions = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  scheduler?: Scheduler;
  now?: () => Date;
  random?: () => number;
  isOnline?: () => boolean;
  /** Ids for conflict copies. */
  newId?: () => string;
  credentials?: CredentialStore;
};

const CONFIG_KEY = "syncConfig";
const INTERVAL_MS = 60_000;
const LOCAL_CHANGE_DELAY_MS = 1_500;
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

const browserScheduler: Scheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Keeps the local notes and the server in step in the background. The UI
 * never waits for it: every read and write goes to local storage, and the
 * engine exchanges changes whenever it can.
 *
 * A cycle pushes local changes (each based on the revision it was edited
 * from) and then pulls the server's changes since the last cursor. Anything
 * that changed on both sides is held back as a conflict, with both versions
 * kept, instead of being overwritten.
 */
export class SyncEngine {
  readonly #store: NoteStore;
  readonly #fetch: SyncEngineOptions["fetch"];
  readonly #scheduler: Scheduler;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #isOnline: () => boolean;
  readonly #newId: () => string;
  readonly #credentials: CredentialStore | null;

  #config: StoredConfig | null = null;
  #status: SyncStatus = {
    state: "disabled",
    account: null,
    serverUrl: null,
    lastSyncedAt: null,
    pending: 0,
    blocked: 0,
    error: null,
  };
  readonly #listeners = new Set<() => void>();
  #timer: unknown = null;
  #running: Promise<void> | null = null;
  #again = false;
  #failures = 0;
  #stopListening: (() => void) | null = null;

  constructor(store: NoteStore, options: SyncEngineOptions = {}) {
    this.#store = store;
    this.#fetch = options.fetch;
    this.#scheduler = options.scheduler ?? browserScheduler;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#isOnline = options.isOnline ?? (() => navigator.onLine);
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#credentials = options.credentials ?? null;
  }

  // --- Status for the UI (useSyncExternalStore) -------------------------

  getStatus = (): SyncStatus => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #setStatus(changes: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...changes };
    for (const listener of this.#listeners) listener();
  }

  // --- Lifecycle ---------------------------------------------------------

  /** Loads the saved server connection and starts syncing if there is one. */
  async start(): Promise<void> {
    this.#config = await this.#loadConfig();
    this.#listen();
    if (this.#config) {
      this.#setStatus({
        state: "idle",
        account: this.#config.account,
        serverUrl: this.#config.serverUrl,
      });
      await this.syncNow();
    }
  }

  stop(): void {
    this.#stopListening?.();
    this.#stopListening = null;
    this.#cancelTimer();
  }

  /**
   * Checks the credentials, saves them and syncs. Connecting to another
   * account queues every local note for upload to it.
   */
  async connect(config: ServerConfig): Promise<Account> {
    const serverUrl = config.serverUrl.trim().replace(/\/+$/, "");
    const token = config.token.trim();
    const account = await this.#client({ serverUrl, token }).me();
    const previous = this.#config;
    const sameAccount = previous?.serverUrl === serverUrl && previous.account.id === account.id;
    if (!sameAccount) await this.#store.resetSync();
    this.#config = { serverUrl, token, account };
    await this.#saveConfig(this.#config);
    this.#failures = 0;
    this.#setStatus({ state: "idle", account, serverUrl, error: null });
    await this.syncNow();
    return account;
  }

  /** Stops syncing. Local notes stay; reconnecting to the same account resumes. */
  async disconnect(): Promise<void> {
    this.#cancelTimer();
    await this.#running;
    this.#config = null;
    await this.#store.saveMeta(CONFIG_KEY, undefined);
    await this.#credentials?.clear();
    this.#setStatus({ state: "disabled", account: null, serverUrl: null, error: null });
  }

  /** The saved connection, with the token from the credential store if there is one. */
  async #loadConfig(): Promise<StoredConfig | null> {
    const stored = parseStoredConfig(await this.#store.loadMeta(CONFIG_KEY));
    if (!stored) return null;
    if (!this.#credentials) return stored.token ? { ...stored, token: stored.token } : null;
    if (stored.token) {
      // Saved before the credential store was used: move the token there.
      await this.#saveConfig({ ...stored, token: stored.token });
      return { ...stored, token: stored.token };
    }
    const token = await this.#credentials.load();
    return token ? { ...stored, token } : null;
  }

  async #saveConfig(config: StoredConfig): Promise<void> {
    if (!this.#credentials) {
      await this.#store.saveMeta(CONFIG_KEY, config);
      return;
    }
    await this.#credentials.save(config.token);
    const { token: _token, ...withoutToken } = config;
    await this.#store.saveMeta(CONFIG_KEY, withoutToken);
  }

  #listen(): void {
    if (this.#stopListening) return;
    const onOnline = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.syncNow();
    };
    const offChange = this.#store.onChange((change) => {
      if (change.source === "local") this.#schedule(LOCAL_CHANGE_DELAY_MS, { sooner: true });
    });
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    this.#stopListening = () => {
      offChange();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  // --- Scheduling ----------------------------------------------------------

  #scheduledAt: number | null = null;

  #schedule(delayMs: number, { sooner = false } = {}): void {
    if (!this.#config) return;
    const at = this.#now().getTime() + delayMs;
    if (sooner && this.#scheduledAt !== null && this.#scheduledAt <= at) return;
    this.#cancelTimer();
    this.#scheduledAt = at;
    this.#timer = this.#scheduler.set(() => {
      this.#timer = null;
      this.#scheduledAt = null;
      void this.syncNow();
    }, delayMs);
  }

  #cancelTimer(): void {
    if (this.#timer !== null) this.#scheduler.clear(this.#timer);
    this.#timer = null;
    this.#scheduledAt = null;
  }

  // --- A sync cycle --------------------------------------------------------

  /** Runs a cycle now. If one is running, another follows it. */
  syncNow(): Promise<void> {
    if (!this.#config) return Promise.resolve();
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#cycle().finally(() => {
      this.#running = null;
      if (this.#again) {
        this.#again = false;
        void this.syncNow();
      }
    });
    return this.#running;
  }

  async #cycle(): Promise<void> {
    const config = this.#config;
    if (!config) return;
    this.#cancelTimer();
    if (!this.#isOnline()) {
      await this.#refreshCounts({ state: "offline", error: null });
      return; // The "online" event starts the next cycle.
    }
    this.#setStatus({ state: "syncing" });
    const client = this.#client(config);
    try {
      await this.#push(client);
      await this.#pull(client);
      if (await this.#resolveConflicts(client)) {
        await this.#push(client); // Upload the conflict copies right away.
      }
      this.#failures = 0;
      await this.#refreshCounts({
        state: "idle",
        lastSyncedAt: this.#now().toISOString(),
        error: null,
      });
      this.#schedule(INTERVAL_MS);
    } catch (error) {
      this.#failures += 1;
      const offline = error instanceof NetworkError;
      await this.#refreshCounts({
        state: offline ? "offline" : "error",
        error: offline ? null : describe(error),
      });
      this.#schedule(this.#retryDelay());
    }
  }

  /** Exponential backoff with jitter: about 2 s, 4 s, 8 s … up to 5 minutes. */
  #retryDelay(): number {
    const base = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (this.#failures - 1));
    return Math.round(base * (0.75 + this.#random() * 0.5));
  }

  async #refreshCounts(changes: Partial<SyncStatus>): Promise<void> {
    const entries = await this.#store.syncEntries();
    this.#setStatus({
      ...changes,
      pending: entries.filter((entry) => entry.dirty && entry.blocked === null).length,
      blocked: entries.filter((entry) => entry.blocked !== null).length,
    });
  }

  async #push(client: ApiClient): Promise<void> {
    for (const entry of await this.#store.pendingSync()) {
      await this.#pushOne(client, entry);
    }
  }

  async #pushOne(client: ApiClient, entry: SyncEntry): Promise<void> {
    const { noteId, baseRevision } = entry;
    try {
      if (entry.deleted) {
        if (baseRevision !== null) await client.deleteNote(noteId, baseRevision);
        await this.#store.markPushed(noteId, "deleted");
        return;
      }
      const note = await this.#store.get(noteId);
      if (!note) return; // Deleted meanwhile; its deletion is queued.
      const remote =
        baseRevision === null
          ? await client.createNote(noteId, note.markdown)
          : await client.updateNote(noteId, note.markdown, baseRevision);
      await this.#store.markPushed(noteId, { revision: remote.revision, markdown: note.markdown });
    } catch (error) {
      if (error instanceof RevisionConflictError && entry.deleted && error.current.deleted) {
        await this.#store.markPushed(noteId, "deleted"); // Deleted on both sides.
      } else if (error instanceof RevisionConflictError) {
        await this.#store.blockSync(noteId, { reason: "conflict", remote: error.current });
      } else if (error instanceof ApiError && error.code === "exists") {
        await this.#store.blockSync(noteId, { reason: "conflict", remote: null });
      } else if (error instanceof ApiError && error.status === 404) {
        if (entry.deleted) {
          await this.#store.markPushed(noteId, "deleted"); // Already gone.
        } else {
          await this.#store.blockSync(noteId, { reason: "conflict", remote: null });
        }
      } else if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401 &&
        error.status !== 429
      ) {
        // The server will never accept this version (e.g. too large); hold it
        // back instead of retrying forever, and keep syncing the rest.
        await this.#store.blockSync(noteId, { reason: "rejected", message: error.message });
      } else {
        throw error; // Offline, server error, bad credentials: retry the cycle later.
      }
    }
  }

  async #pull(client: ApiClient): Promise<void> {
    let cursor = await this.#store.syncCursor();
    for (;;) {
      const page = await client.changes(cursor);
      for (const remote of page.notes) {
        await this.#store.applyRemote(remote);
      }
      cursor = page.cursor;
      await this.#store.setSyncCursor(cursor);
      if (!page.more) return;
    }
  }

  /**
   * Settles every note held back as a conflict, deterministically and without
   * losing a version (see domain/sync/conflicts.ts). Returns whether any
   * conflict was settled.
   */
  async #resolveConflicts(client: ApiClient): Promise<boolean> {
    let resolved = false;
    for (const entry of await this.#store.syncEntries()) {
      if (entry.blocked?.reason !== "conflict") continue;
      const remote = entry.blocked.remote ?? (await this.#serverVersion(client, entry.noteId));
      const local = entry.deleted ? null : ((await this.#store.get(entry.noteId)) ?? null);
      const now = this.#now();
      await this.#store.applyResolution(
        entry.noteId,
        planResolution(local, remote, now),
        now,
        this.#newId(),
      );
      resolved = true;
    }
    return resolved;
  }

  /** The server's version, or a tombstone if it has none. */
  async #serverVersion(client: ApiClient, noteId: string): Promise<RemoteNote> {
    return (
      (await client.getNote(noteId)) ?? { id: noteId, markdown: "", revision: 0, deleted: true }
    );
  }

  #client(config: ServerConfig): ApiClient {
    return new ApiClient(config, this.#fetch);
  }
}

/** The saved connection; the token is absent when a credential store holds it. */
function parseStoredConfig(
  value: unknown,
): { serverUrl: string; token: string | null; account: Account } | null {
  if (typeof value !== "object" || value === null) return null;
  const { serverUrl, token, account } = value as Record<string, unknown>;
  const { id, email } = (typeof account === "object" && account !== null ? account : {}) as Record<
    string,
    unknown
  >;
  if (typeof serverUrl !== "string") return null;
  if (typeof id !== "string" || typeof email !== "string") return null;
  return { serverUrl, token: typeof token === "string" ? token : null, account: { id, email } };
}

function describe(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "The server did not accept the token. Connect again with a valid token.";
  }
  return error instanceof Error ? error.message : String(error);
}
