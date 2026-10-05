import { unlock } from "@konspecter/crypto";
import { planResolution } from "../../domain/sync/conflicts";
import type { RemoteNote, SyncEntry } from "../../domain/sync/sync-state";
import {
  ApiClient,
  ApiError,
  NetworkError,
  RevisionConflictError,
  type Account,
  type Cipher,
  type DeviceAuthorization,
  type DeviceDescription,
  type ServerConfig,
} from "../http/api-client";
import type { NoteStore } from "../storage/note-store";
import { ChangeStream } from "./change-stream";
import { deviceLogin } from "./device-login";

/**
 * "disconnected": the server stopped accepting this device (disconnected on
 * the site, or the account deleted). Nothing syncs until it signs in again;
 * every note and its sync state stay.
 *
 * "locked": connected, but without the account's content key, so no note
 * can be sent or read: encryption must be set up on the site first, or the
 * passphrase entered (see SyncStatus.lock).
 */
export type SyncState =
  "disabled" | "idle" | "syncing" | "offline" | "error" | "disconnected" | "locked";

/** Why sync is locked: no key on the server yet ("setup"), or one to unlock ("unlock"). */
export type SyncLock = "setup" | "unlock";

export type SyncStatus = {
  readonly state: SyncState;
  readonly account: Account | null;
  readonly serverUrl: string | null;
  /** ISO 8601 time of the last completed cycle. */
  readonly lastSyncedAt: string | null;
  /** Local changes waiting to be pushed. */
  readonly pending: number;
  /** Notes held back: changes the server refused. */
  readonly blocked: number;
  /** Why the last cycle failed (not set when offline); the interface words it. */
  readonly error: Error | null;
  /** Set while the state is "locked". */
  readonly lock: SyncLock | null;
};

/** There is no key to unlock: encryption is not set up on the server. */
export class NoKeyError extends Error {
  override readonly name = "NoKeyError";
  constructor() {
    super("Encryption is not set up for this account");
  }
}

/** The server's key is not the one this device holds (reset, or set up anew). */
class KeyChangedError extends Error {
  constructor(readonly keyId: string | null) {
    super("The account's key changed");
  }
}

type StoredConfig = ServerConfig & { readonly account: Account };

/** Where this device was connected before the server let it go. */
type Disconnected = { readonly serverUrl: string; readonly account: Account };

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
  /** Whether the page is shown; the change stream is closed while it is hidden. */
  isVisible?: () => boolean;
  credentials?: CredentialStore;
};

const CONFIG_KEY = "syncConfig";
/**
 * The content key: `{ keyId, key }`, the key a non-extractable CryptoKey,
 * or null once it was dropped (its id is kept, to tell whether a key
 * unlocked later is the same one).
 */
const KEY_KEY = "syncKey";
/** Between cycles while the change stream reports changes as they happen. */
const INTERVAL_MS = 60_000;
/** Between cycles while it is down (or the server has none). */
const POLL_MS = 10_000;
/**
 * After a local save: long enough to gather the writes of one action (an
 * import), short enough that other devices see an edit about half a second
 * after the typing pauses.
 */
const LOCAL_CHANGE_DELAY_MS = 100;
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
 * from) and then pulls the server's changes since the last cursor. A note
 * changed on both sides is settled at the end of the cycle: the later edit
 * wins (see domain/sync/conflicts.ts). The server's change stream starts a
 * cycle whenever something changes there.
 */
export class SyncEngine {
  readonly #store: NoteStore;
  readonly #fetch: SyncEngineOptions["fetch"];
  readonly #scheduler: Scheduler;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #isOnline: () => boolean;
  readonly #isVisible: () => boolean;
  readonly #credentials: CredentialStore | null;

  #config: StoredConfig | null = null;
  #disconnected: Disconnected | null = null;
  #cipher: Cipher | null = null;
  /** The id of the key this device last held; null if it never held one. */
  #keyId: string | null = null;
  #status: SyncStatus = {
    state: "disabled",
    account: null,
    serverUrl: null,
    lastSyncedAt: null,
    pending: 0,
    blocked: 0,
    error: null,
    lock: null,
  };
  readonly #listeners = new Set<() => void>();
  #timer: unknown = null;
  #running: Promise<void> | null = null;
  /** The cycle queued to follow the running one. */
  #next: Promise<void> | null = null;
  #failures = 0;
  #stopListening: (() => void) | null = null;
  #stream: ChangeStream | null = null;
  #streaming = false;

  constructor(store: NoteStore, options: SyncEngineOptions = {}) {
    this.#store = store;
    this.#fetch = options.fetch;
    this.#scheduler = options.scheduler ?? browserScheduler;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#isOnline = options.isOnline ?? (() => navigator.onLine);
    this.#isVisible = options.isVisible ?? (() => document.visibilityState === "visible");
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
    await this.#loadKey();
    const saved = parseStoredConfig(await this.#store.loadMeta(CONFIG_KEY));
    if (saved?.disconnected) {
      this.#disconnected = { serverUrl: saved.serverUrl, account: saved.account };
      this.#listen();
      await this.#refreshCounts({ state: "disconnected", ...this.#disconnected });
      return;
    }
    this.#config = await this.#loadConfig();
    this.#listen();
    if (this.#config) {
      this.#setStatus({
        state: "idle",
        account: this.#config.account,
        serverUrl: this.#config.serverUrl,
      });
      this.#openStream();
      await this.syncNow();
    }
  }

  stop(): void {
    this.#stopListening?.();
    this.#stopListening = null;
    this.#closeStream();
    this.#cancelTimer();
  }

  /**
   * Checks the credentials, saves them and syncs. Connecting to another
   * account queues every local note for upload to it.
   */
  async connect(config: ServerConfig): Promise<Account> {
    const serverUrl = normalizeServerUrl(config.serverUrl);
    const token = config.token.trim();
    const account = await this.#client({ serverUrl, token }).me();
    // Back to the account this device was disconnected from: carry on.
    const previous = this.#config ?? this.#disconnected;
    const sameAccount = previous?.serverUrl === serverUrl && previous.account.id === account.id;
    if (!sameAccount) {
      await this.#store.resetSync();
      await this.#saveKey(null, null); // Another account has another key.
    }
    this.#closeStream();
    this.#disconnected = null;
    this.#config = { serverUrl, token, account };
    await this.#saveConfig(this.#config);
    this.#failures = 0;
    this.#setStatus({ state: "idle", account, serverUrl, error: null, lock: null });
    this.#openStream();
    await this.syncNow();
    return account;
  }

  /**
   * Unlocks the account's content key with the passphrase and syncs. A key
   * this device has not held before (the first, or a new one after a reset)
   * means the server's notes were made without this device: everything is
   * uploaded again. Throws WrongSecretError for a wrong passphrase and
   * NoKeyError when encryption is not set up.
   */
  async unlock(passphrase: string): Promise<void> {
    const config = this.#config;
    if (!config) throw new Error("Not connected");
    const record = await this.#client(config).key();
    if (!record) {
      this.#setStatus({ state: "locked", lock: "setup" });
      throw new NoKeyError();
    }
    const key = await unlock(record, passphrase);
    if (record.keyId !== this.#keyId) await this.#store.resetSync();
    await this.#saveKey(record.keyId, key);
    this.#failures = 0;
    this.#setStatus({ state: "idle", lock: null, error: null });
    await this.syncNow();
  }

  /**
   * Signs in through the browser: shows the owner a code (`onCode`), waits
   * while they approve it on the site, then connects with the token the
   * server hands over. Aborting `signal` cancels the wait.
   */
  async signInWithBrowser(
    serverUrl: string,
    device: DeviceDescription,
    onCode: (authorization: DeviceAuthorization) => void,
    signal?: AbortSignal,
  ): Promise<Account> {
    const url = normalizeServerUrl(serverUrl);
    const token = await deviceLogin(url, device, {
      fetch: this.#fetch,
      onCode,
      sleep: (ms) => this.#sleep(ms, signal),
    });
    signal?.throwIfAborted();
    return this.connect({ serverUrl: url, token });
  }

  #sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const handle = this.#scheduler.set(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          this.#scheduler.clear(handle);
          reject(signal.reason as Error);
        },
        { once: true },
      );
    });
  }

  /**
   * Stops syncing and signs this device out of the server (when it can be
   * reached; the device then leaves the account's list). Local notes stay;
   * reconnecting to the same account resumes.
   */
  async disconnect(): Promise<void> {
    this.#closeStream();
    this.#cancelTimer();
    await this.#running;
    const config = this.#config;
    if (config)
      void this.#client(config)
        .revokeCurrentToken()
        .catch(() => undefined);
    this.#config = null;
    this.#disconnected = null;
    await this.#store.saveMeta(CONFIG_KEY, undefined);
    await this.#credentials?.clear();
    await this.#saveKey(null, null);
    this.#setStatus({
      state: "disabled",
      account: null,
      serverUrl: null,
      error: null,
      lock: null,
    });
  }

  async #loadKey(): Promise<void> {
    const { keyId, key } = parseStoredKey(await this.#store.loadMeta(KEY_KEY));
    this.#keyId = keyId;
    this.#cipher = keyId !== null && key !== null ? { keyId, key } : null;
  }

  async #saveKey(keyId: string | null, key: CryptoKey | null): Promise<void> {
    this.#keyId = keyId;
    this.#cipher = keyId !== null && key !== null ? { keyId, key } : null;
    await this.#store.saveMeta(KEY_KEY, keyId === null ? undefined : { keyId, key });
  }

  /** Sync stops until the owner sets up encryption or enters the passphrase. */
  async #lock(serverKeyId: string | null, client: ApiClient | null): Promise<void> {
    if (this.#cipher && this.#cipher.keyId !== serverKeyId) {
      await this.#saveKey(this.#keyId, null); // That key is gone; keep its id.
    }
    let lock: SyncLock = serverKeyId === null ? "setup" : "unlock";
    if (serverKeyId === null && client) lock = (await client.key()) ? "unlock" : "setup";
    await this.#refreshCounts({ state: "locked", lock, error: null });
    // Set-up on the site wakes the stream; meanwhile look now and then.
    this.#schedule(INTERVAL_MS);
  }

  /**
   * The server no longer accepts this device. Forget its token, keep every
   * note and its sync state, and remember the account to resume it after
   * signing in again.
   */
  async #becomeDisconnected(config: StoredConfig, error: ApiError): Promise<void> {
    this.#closeStream();
    this.#cancelTimer();
    this.#config = null;
    this.#disconnected = { serverUrl: config.serverUrl, account: config.account };
    await this.#store.saveMeta(CONFIG_KEY, { ...this.#disconnected, disconnected: true });
    await this.#credentials?.clear();
    await this.#saveKey(this.#keyId, null); // Forget the key; its id tells the same one again.
    await this.#refreshCounts({ state: "disconnected", error, lock: null, ...this.#disconnected });
  }

  /** The saved connection, with the token from the credential store if there is one. */
  async #loadConfig(): Promise<StoredConfig | null> {
    const stored = parseStoredConfig(await this.#store.loadMeta(CONFIG_KEY));
    if (!stored || stored.disconnected) return null;
    const { serverUrl, account } = stored;
    if (!this.#credentials)
      return stored.token ? { serverUrl, account, token: stored.token } : null;
    if (stored.token) {
      // Saved before the credential store was used: move the token there.
      const config = { serverUrl, account, token: stored.token };
      await this.#saveConfig(config);
      return config;
    }
    const token = await this.#credentials.load();
    return token ? { serverUrl, account, token } : null;
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
    const onOnline = () => {
      this.#openStream();
      void this.syncNow();
    };
    const onVisible = () => {
      if (!this.#isVisible()) {
        this.#closeStream(); // Nothing to show meanwhile; saves the connection.
        return;
      }
      this.#openStream();
      void this.syncNow();
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

  // --- The change stream ---------------------------------------------------

  #openStream(): void {
    const config = this.#config;
    if (!config || !this.#isVisible()) return;
    this.#stream ??= new ChangeStream(
      this.#client(config),
      {
        onChange: () => void this.syncNow(),
        onConnected: (connected) => {
          this.#streaming = connected;
          if (!connected) this.#schedule(POLL_MS, { sooner: true });
        },
      },
      { scheduler: this.#scheduler, random: this.#random },
    );
    this.#stream.start();
  }

  #closeStream(): void {
    this.#stream?.stop();
    this.#stream = null;
    this.#streaming = false;
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

  /**
   * Runs a cycle now. If one is running, another follows it (one, however
   * often this is called meanwhile), and the promise waits for that one: it
   * sees every change made before the call.
   */
  syncNow(): Promise<void> {
    if (!this.#config) return Promise.resolve();
    if (this.#running) {
      this.#next ??= this.#running.then(() => {
        this.#next = null;
        return this.syncNow();
      });
      return this.#next;
    }
    this.#running = this.#cycle().finally(() => {
      this.#running = null;
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
      if (!this.#cipher) {
        // Nothing can be sent or read without the key: say what is missing.
        const record = await client.key();
        await this.#lock(record?.keyId ?? null, null);
        return;
      }
      await this.#push(client);
      await this.#pull(client);
      if (await this.#resolveConflicts(client)) {
        await this.#push(client); // Upload the local versions that won right away.
      }
      this.#failures = 0;
      await this.#refreshCounts({
        state: "idle",
        lastSyncedAt: this.#now().toISOString(),
        error: null,
        lock: null,
      });
      this.#schedule(this.#streaming ? INTERVAL_MS : POLL_MS);
    } catch (error) {
      if (error instanceof KeyChangedError) {
        await this.#lock(error.keyId, error.keyId === null ? client : null);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // Disconnected on the site, the account deleted, or the token revoked.
        await this.#becomeDisconnected(config, error);
        return;
      }
      this.#failures += 1;
      const offline = error instanceof NetworkError;
      await this.#refreshCounts({
        state: offline ? "offline" : "error",
        error: offline ? null : error instanceof Error ? error : new Error(String(error)),
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
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        (error.code === "key_mismatch" || error.code === "encryption_required")
      ) {
        throw new KeyChangedError(null); // Not this note's fault: the key changed.
      }
      if (error instanceof RevisionConflictError && entry.deleted && error.current.deleted) {
        await this.#store.markPushed(noteId, "deleted"); // Deleted on both sides.
      } else if (error instanceof RevisionConflictError) {
        await this.#store.blockSync(noteId, { reason: "conflict", remote: error.current });
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
      if (page.keyId !== this.#cipher?.keyId) throw new KeyChangedError(page.keyId);
      for (const remote of page.notes) {
        await this.#store.applyRemote(remote);
      }
      cursor = page.cursor;
      await this.#store.setSyncCursor(cursor);
      if (!page.more) return;
    }
  }

  /**
   * Settles every note held back as a conflict: the later edit wins (see
   * domain/sync/conflicts.ts). Returns whether any conflict was settled.
   */
  async #resolveConflicts(client: ApiClient): Promise<boolean> {
    let resolved = false;
    for (const entry of await this.#store.syncEntries()) {
      if (entry.blocked?.reason !== "conflict") continue;
      const remote = entry.blocked.remote ?? (await this.#serverVersion(client, entry.noteId));
      const local = entry.deleted ? null : ((await this.#store.get(entry.noteId)) ?? null);
      await this.#store.applyResolution(entry.noteId, planResolution(local, remote));
      resolved = true;
    }
    return resolved;
  }

  /** The server's version, or (revision 0) none: the note is not on the server. */
  async #serverVersion(client: ApiClient, noteId: string): Promise<RemoteNote> {
    return (
      (await client.getNote(noteId)) ?? { id: noteId, markdown: "", revision: 0, deleted: true }
    );
  }

  #client(config: ServerConfig): ApiClient {
    return new ApiClient(config, this.#fetch, this.#cipher);
  }
}

/** The stored content key; a key that is not a CryptoKey (or is missing) reads as null. */
function parseStoredKey(value: unknown): { keyId: string | null; key: CryptoKey | null } {
  if (typeof value !== "object" || value === null) return { keyId: null, key: null };
  const { keyId, key } = value as Record<string, unknown>;
  return {
    keyId: typeof keyId === "string" ? keyId : null,
    key: key instanceof CryptoKey ? key : null,
  };
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

/**
 * The saved connection; the token is absent when a credential store holds
 * it, or when the server disconnected this device.
 */
function parseStoredConfig(value: unknown): {
  serverUrl: string;
  token: string | null;
  account: Account;
  disconnected: boolean;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const { serverUrl, token, account, disconnected } = value as Record<string, unknown>;
  const { id, email } = (typeof account === "object" && account !== null ? account : {}) as Record<
    string,
    unknown
  >;
  if (typeof serverUrl !== "string") return null;
  if (typeof id !== "string" || typeof email !== "string") return null;
  return {
    serverUrl,
    token: typeof token === "string" ? token : null,
    account: { id, email },
    disconnected: disconnected === true,
  };
}
