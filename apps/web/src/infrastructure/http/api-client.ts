import { decryptNote, encryptNote, keyFromJson, type KeyRecord } from "@konspecter/crypto";
import { parseRemoteNote, type RemoteNote } from "../../domain/sync/sync-state";

export type ServerConfig = {
  /** Base URL of the Konspecter server, e.g. "https://notes.example.com". */
  readonly serverUrl: string;
  readonly token: string;
};

export type Account = { readonly id: string; readonly email: string };

/**
 * Whether the account may sync (paid sync): "free" where sync costs
 * nothing, else the account's entitlement; "expired" waits for a payment.
 * `until` is when sync stops by itself (an ISO 8601 time); an expired
 * account that never had any time has none.
 */
export type SyncAccess = {
  readonly state: "free" | "trialing" | "active" | "past_due" | "canceled" | "expired";
  readonly until: string | null;
};

const ACCESS_STATES: readonly SyncAccess["state"][] = [
  "free",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
];

export type ChangesPage = {
  readonly notes: readonly RemoteNote[];
  readonly cursor: number;
  readonly more: boolean;
  /** The account's current content key; null when encryption is not set up. */
  readonly keyId: string | null;
};

/** The account's content key, unlocked: notes are encrypted and decrypted with it. */
export type Cipher = { readonly keyId: string; readonly key: CryptoKey };

/** The client has no unlocked key, so it cannot send or read notes. */
export class LockedError extends Error {
  override readonly name = "LockedError";
}

/** The server answered with an error. */
export class ApiError extends Error {
  override readonly name: string = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The change was based on an old revision; `current` is the server's version. */
export class RevisionConflictError extends ApiError {
  override readonly name = "RevisionConflictError";
  constructor(
    message: string,
    readonly current: RemoteNote,
  ) {
    super(409, "revision_conflict", message);
  }
}

/** The server could not be reached. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A 409 revision conflict as the server sent it, before decryption. */
class WireConflict extends Error {
  constructor(
    message: string,
    readonly current: unknown,
  ) {
    super(message);
  }
}

/**
 * HTTP/JSON client for the server API. Every response is validated.
 *
 * It is the one place notes are encrypted: with a cipher, notes go out as
 * envelopes and come back decrypted, so everything above it (the sync
 * engine, conflict resolution, the note store) works with plain Markdown.
 */
export class ApiClient {
  readonly #base: string;
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #cipher: Cipher | null;

  constructor(
    config: ServerConfig,
    fetchFn: Fetch = (input, init) => fetch(input, init),
    cipher: Cipher | null = null,
  ) {
    this.#base = config.serverUrl.endsWith("/") ? config.serverUrl : `${config.serverUrl}/`;
    this.#token = config.token;
    this.#fetch = fetchFn;
    this.#cipher = cipher;
  }

  /** The account's wrapped content key, or null when encryption is not set up. */
  async key(): Promise<KeyRecord | null> {
    try {
      return parseKey(await this.#request("GET", "api/keys"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  #requireCipher(): Cipher {
    if (!this.#cipher) throw new LockedError("Encryption is locked");
    return this.#cipher;
  }

  async #encrypt(noteId: string, markdown: string): Promise<string> {
    const { key, keyId } = this.#requireCipher();
    return encryptNote(key, keyId, noteId, markdown);
  }

  /** A note from the wire, decrypted. A deleted note's text is not needed (and not read). */
  async #remote(value: unknown): Promise<RemoteNote> {
    const wire = asRecord(value);
    const { id, content, deleted_at: deletedAt } = wire;
    const deleted = deletedAt !== undefined && deletedAt !== null;
    if (typeof id !== "string" || typeof content !== "string") throw invalid("note");
    let markdown = "";
    if (!deleted) {
      const { key, keyId } = this.#requireCipher();
      markdown = await decryptNote(key, keyId, id, content);
    }
    return parseRemoteNote({ id, markdown, revision: wire.revision, deleted });
  }

  /** Signs this device out: its token stops working and it leaves the account's device list. */
  async revokeCurrentToken(): Promise<void> {
    await this.#request("DELETE", "api/tokens/current");
  }

  async me(): Promise<Account> {
    const body = await this.#request("GET", "api/me");
    const { id, email } = asRecord(body);
    if (typeof id !== "string" || typeof email !== "string") throw invalid("account");
    return { id, email };
  }

  /** Whether the account may sync; a server without paid sync says nothing: free. */
  async access(): Promise<SyncAccess> {
    const { sync } = asRecord(await this.#request("GET", "api/me"));
    const { state, until } = asRecord(sync);
    const known = ACCESS_STATES.find((value) => value === state);
    return { state: known ?? "free", until: typeof until === "string" ? until : null };
  }

  /** The server's version of a note, or null if it has none (or deleted it). */
  async getNote(id: string): Promise<RemoteNote | null> {
    try {
      return await this.#remote(await this.#request("GET", `api/notes/${encodeURIComponent(id)}`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async createNote(id: string, markdown: string): Promise<RemoteNote> {
    const content = await this.#encrypt(id, markdown);
    return this.#remote(await this.#request("POST", "api/notes", { id, content }));
  }

  async updateNote(id: string, markdown: string, baseRevision: number): Promise<RemoteNote> {
    const path = `api/notes/${encodeURIComponent(id)}`;
    const content = await this.#encrypt(id, markdown);
    return this.#remote(await this.#request("PUT", path, { content, base_revision: baseRevision }));
  }

  async deleteNote(id: string, baseRevision: number): Promise<void> {
    const path = `api/notes/${encodeURIComponent(id)}?base_revision=${String(baseRevision)}`;
    await this.#request("DELETE", path);
  }

  async changes(since: number, limit = 100): Promise<ChangesPage> {
    const body = asRecord(
      await this.#request("GET", `api/sync?since=${String(since)}&limit=${String(limit)}`),
    );
    const { notes, cursor, more, key_id: keyId } = body;
    if (!Array.isArray(notes) || typeof cursor !== "number" || typeof more !== "boolean") {
      throw invalid("changes");
    }
    const current = typeof keyId === "string" ? keyId : null;
    // Notes of another key cannot be read: nothing is taken (the cursor stays),
    // and the caller sees keyId and unlocks the current key first.
    if (current !== this.#cipher?.keyId)
      return { notes: [], cursor: since, more: false, keyId: current };
    const remote: RemoteNote[] = [];
    for (const note of notes as unknown[]) remote.push(await this.#remote(note));
    return { notes: remote, cursor, more, keyId: current };
  }

  /**
   * The server's change events (`GET /api/events`, Server-Sent Events) as a
   * byte stream, open until `signal` aborts or the server ends it.
   */
  async events(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    let response: Response;
    try {
      response = await this.#fetch(new URL("api/events", this.#base).toString(), {
        headers: { Authorization: `Bearer ${this.#token}`, Accept: "text/event-stream" },
        signal,
      });
    } catch (error) {
      throw new NetworkError("Could not reach the server", { cause: error });
    }
    if (!response.ok) await failure(response);
    if (!response.body) throw invalid("event stream");
    return response.body;
  }

  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    try {
      return await send(
        this.#fetch,
        new URL(path, this.#base).toString(),
        method,
        body,
        this.#token,
      );
    } catch (error) {
      if (error instanceof WireConflict) {
        throw new RevisionConflictError(error.message, await this.#remote(error.current));
      }
      throw error;
    }
  }
}

function parseKey(value: unknown): KeyRecord {
  try {
    return keyFromJson(value);
  } catch {
    throw invalid("key");
  }
}

/** Sends a JSON request and returns the JSON answer (null for 204), or throws its error. */
async function send(
  fetchFn: Fetch,
  url: string,
  method: string,
  body: unknown,
  token: string | null,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new NetworkError("Could not reach the server", { cause: error });
  }
  if (response.status === 204) return null;
  if (!response.ok) return failure(response);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw invalid("response");
  }
}

// --- Connecting through the browser (the device flow, RFC 8628) ------------

/** What this app tells the server about itself; its owner sees it on the site. */
export type DeviceDescription = {
  readonly name: string;
  readonly platform: string;
  readonly clientVersion: string;
};

/** The codes of a request to connect: the app polls with one, its owner approves the other. */
export type DeviceAuthorization = {
  readonly deviceCode: string;
  /** Shown to the owner, e.g. "BCDF-GHJK". */
  readonly userCode: string;
  readonly verificationUri: string;
  /** The approval page with the code filled in. */
  readonly verificationUriComplete: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
};

/** One poll's answer: the token once approved, else why not yet (or never). */
export type DeviceTokenPoll =
  | { readonly status: "approved"; readonly token: string }
  | { readonly status: "pending" | "slow_down" | "denied" | "expired" };

function apiUrl(serverUrl: string, path: string): string {
  return new URL(path, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`).toString();
}

/** Asks the server to connect this app; the owner then approves it in the browser. */
export async function authorizeDevice(
  serverUrl: string,
  device: DeviceDescription,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<DeviceAuthorization> {
  const body = asRecord(
    await send(
      fetchFn,
      apiUrl(serverUrl, "api/devices/authorize"),
      "POST",
      {
        name: device.name,
        platform: device.platform,
        client_version: device.clientVersion,
      },
      null,
    ),
  );
  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval,
  } = body;
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string" ||
    typeof verificationUriComplete !== "string" ||
    typeof expiresIn !== "number" ||
    typeof interval !== "number"
  ) {
    throw invalid("device authorization");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresInSeconds: expiresIn,
    intervalSeconds: Math.max(1, interval),
  };
}

const POLL_ERRORS = {
  authorization_pending: "pending",
  slow_down: "slow_down",
  access_denied: "denied",
  expired_token: "expired",
} as const;

/** Polls once with the device code. */
export async function pollDeviceToken(
  serverUrl: string,
  deviceCode: string,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<DeviceTokenPoll> {
  let body: unknown;
  try {
    body = await send(
      fetchFn,
      apiUrl(serverUrl, "api/devices/token"),
      "POST",
      { device_code: deviceCode },
      null,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.code in POLL_ERRORS) {
      return { status: POLL_ERRORS[error.code as keyof typeof POLL_ERRORS] };
    }
    throw error;
  }
  const { token } = asRecord(body);
  if (typeof token !== "string") throw invalid("device token");
  return { status: "approved", token };
}

/** The content key a browser sealed for this app (ADR-025): only the link's secret opens it. */
export type HandedKey = { readonly keyId: string; readonly sealedKey: string };

/**
 * Trades a connect code (scanned from the account site's QR code) for this
 * app's token, and the content key sealed with it if there is one: no one
 * has to approve anything. ApiError `invalid_connect_code` when the code is
 * wrong, used or expired.
 */
export async function connectDevice(
  serverUrl: string,
  code: string,
  device: DeviceDescription,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<{ token: string; key: HandedKey | null }> {
  const body = asRecord(
    await send(
      fetchFn,
      apiUrl(serverUrl, "api/devices/connect"),
      "POST",
      { code, name: device.name, platform: device.platform, client_version: device.clientVersion },
      null,
    ),
  );
  if (typeof body.token !== "string") throw invalid("device token");
  const { key_id: keyId, sealed_key: sealedKey } = asRecord(body.key);
  const key =
    typeof keyId === "string" && typeof sealedKey === "string" ? { keyId, sealedKey } : null;
  return { token: body.token, key };
}

/** Throws the error a failed response describes. */
async function failure(response: Response): Promise<never> {
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // No JSON body: the status says enough.
  }
  const record = asRecord(json);
  const error = asRecord(record.error);
  const code = typeof error.code === "string" ? error.code : "http_error";
  const message =
    typeof error.message === "string" ? error.message : `Server error ${String(response.status)}`;
  if (response.status === 409 && code === "revision_conflict") {
    throw new WireConflict(message, record.current);
  }
  throw new ApiError(response.status, code, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function invalid(what: string) {
  return new ApiError(0, "invalid_response", `The server sent an invalid ${what}`);
}
