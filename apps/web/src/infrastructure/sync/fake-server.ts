import {
  createKey,
  decryptNote,
  encryptNote,
  envelopeKeyId,
  sealKeyForTransfer,
  unlock,
  type KeyRecord,
} from "@konspecter/crypto";

/**
 * Test double for the Go server: the same routes, revision rules, per-user
 * change sequence, tombstones, change events and encryption rules, in
 * memory, behind a `fetch` function. Used only by tests.
 *
 * Like the real server it takes only envelopes of the account's current
 * key. Unlike it, it knows the key (it made it, see `setUpKey`), so it
 * keeps each note's text beside the envelope for tests to look at.
 */

/** The passphrase of the key FakeServer sets up. */
export const TEST_PASSPHRASE = "correct horse battery";

type StoredNote = {
  id: string;
  /** The envelope, as the server stores it. */
  content: string;
  /** The text inside, for tests (the real server cannot read it). */
  markdown: string;
  revision: number;
  deletedAt: string | null;
  seq: number;
};

type Json = Record<string, unknown>;

export class FakeServer {
  readonly notes = new Map<string, StoredNote>();
  /** The account's key: the wrapped record, and the content key the server should not have. */
  #key: { record: KeyRecord; contentKey: CryptoKey; raw: Uint8Array<ArrayBuffer> } | null = null;
  #ready: Promise<unknown>;
  #seq = 0;
  readonly tokens = new Map<string, { id: string; email: string }>([
    ["ksp_ada", { id: "user-ada", email: "ada@example.com" }],
  ]);
  /** Tokens of devices disconnected on the site: 401 device_revoked. */
  readonly revoked = new Set<string>();
  /** Requests to connect through the browser, by device code. */
  readonly authorizations = new Map<
    string,
    { userCode: string; device: Json; status: "pending" | "approved" | "denied"; token: string }
  >();
  #codes = 0;
  /** Makes the server fail requests: a status code, or "network" to refuse connections. */
  failWith: number | "network" | null = null;
  /** Runs before each request is answered (to simulate concurrent activity). */
  beforeRespond: ((method: string, path: string) => Promise<void> | void) | null = null;
  readonly requests: string[] = [];
  /** Tests use a tiny limit to exercise rejected notes; the real server allows 5 MB. */
  maxMarkdownLength = 1000;
  /** Serves `GET /api/events`; off by default, like an older server (404). */
  eventStreams = false;
  /**
   * Paid sync: the account's state as `GET /api/me` reports it. Expired, the
   * sync routes answer 402.
   */
  access: { state: string; until: string | null } = { state: "free", until: null };
  readonly #streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** `encrypted: false` starts without a key: encryption not set up yet. */
  constructor({ encrypted = true }: { encrypted?: boolean } = {}) {
    this.#ready = encrypted ? this.setUpKey() : Promise.resolve();
  }

  /** Sets up a new key (as its owner does on the site); returns its recovery key. */
  async setUpKey(passphrase = TEST_PASSPHRASE): Promise<string> {
    // Light stretching keeps tests fast; the record says how much was used.
    const { record, recoveryKey, raw } = await createKey(passphrase, 1_000);
    this.#key = { record, contentKey: await unlock(record, passphrase), raw };
    this.#announce();
    return recoveryKey;
  }

  /** Resets encryption, as on the site: the key and every note go. */
  resetKey(): void {
    this.#key = null;
    this.notes.clear();
    this.#announce();
  }

  get keyId(): string | null {
    return this.#key?.record.keyId ?? null;
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    if (this.failWith === "network") throw new TypeError("Failed to fetch");
    if (typeof this.failWith === "number") return json(this.failWith, error("boom", "failure"));
    await this.#ready;
    await this.beforeRespond?.(method, url.pathname);

    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : {};
    if (method === "POST" && url.pathname === "/api/devices/authorize")
      return this.#authorize(body);
    if (method === "POST" && url.pathname === "/api/devices/token") return this.#deviceToken(body);
    if (method === "POST" && url.pathname === "/api/devices/connect") return this.#connect(body);

    const token = (new Headers(init?.headers).get("Authorization") ?? "").replace(/^Bearer /, "");
    if (this.revoked.has(token)) {
      return json(401, error("device_revoked", "this device was disconnected from its account"));
    }
    const user = this.tokens.get(token);
    if (!user) return json(401, error("unauthorized", "a valid bearer token is required"));
    if (method === "DELETE" && url.pathname === "/api/tokens/current") {
      this.tokens.delete(token);
      return new Response(null, { status: 204 });
    }

    const noteId = /^\/api\/notes\/([^/]+)$/.exec(url.pathname)?.[1];

    if (method === "GET" && url.pathname === "/api/me") {
      return json(200, { ...user, sync: this.access });
    }
    const paidRoute =
      url.pathname === "/api/sync" ||
      url.pathname === "/api/events" ||
      url.pathname.startsWith("/api/notes");
    if (paidRoute && this.access.state === "expired") {
      return json(402, error("subscription_required", "sync needs a subscription"));
    }
    if (method === "GET" && url.pathname === "/api/events" && this.eventStreams) {
      return this.#events(init?.signal ?? null);
    }
    if (method === "GET" && url.pathname === "/api/keys") {
      return this.#key
        ? json(200, keyWire(this.#key.record))
        : json(404, error("no_key", "encryption is not set up"));
    }
    if (method === "GET" && url.pathname === "/api/sync") return this.#changes(url);
    if (method === "POST" && url.pathname === "/api/notes") return this.#create(body);
    if (method === "GET" && noteId) {
      const note = this.notes.get(decodeURIComponent(noteId));
      return note && note.deletedAt === null
        ? json(200, wire(note))
        : json(404, error("not_found", "note not found"));
    }
    if (method === "PUT" && noteId) return this.#update(decodeURIComponent(noteId), body);
    if (method === "DELETE" && noteId) {
      return this.#delete(
        decodeURIComponent(noteId),
        Number(url.searchParams.get("base_revision")),
      );
    }
    return json(404, error("not_found", "no such endpoint"));
  };

  /** Disconnects the device holding `token`, as its owner does on the site. */
  disconnectDevice(token: string): void {
    this.tokens.delete(token);
    this.revoked.add(token);
  }

  /** The owner approves (or denies) the request with this user code on the site. */
  decide(userCode: string, approve: boolean, token = "ksp_ada"): void {
    for (const request of this.authorizations.values()) {
      if (request.userCode === userCode) {
        request.status = approve ? "approved" : "denied";
        request.token = token;
      }
    }
  }

  /** Connect codes the site handed out, and the token each one gives. */
  readonly connectCodes = new Map<string, string>();
  /** The content key sealed for the app that redeems a code, by code. */
  readonly connectKeys = new Map<string, { key_id: string; sealed_key: string }>();

  /**
   * Hands out a connect code with the content key sealed for the app, as a
   * browser that holds the key does; returns the secret for the link.
   */
  async connectCodeWithKey(code: string, token = "ksp_ada"): Promise<string> {
    await this.#ready;
    if (!this.#key) throw new Error("No key to hand over");
    const { secret, sealedKey } = await sealKeyForTransfer(this.#key.raw, this.#key.record.keyId);
    this.connectCodes.set(code, token);
    this.connectKeys.set(code, { key_id: this.#key.record.keyId, sealed_key: sealedKey });
    return secret;
  }

  #connect(body: Json): Response {
    const code = String(body.code);
    const token = this.connectCodes.get(code);
    const key = this.connectKeys.get(code) ?? null;
    this.connectCodes.delete(code);
    this.connectKeys.delete(code);
    if (!token) return json(400, error("invalid_connect_code", "wrong, used or expired"));
    this.connected.push(body);
    return json(200, { token, device: { id: "d1" }, user: {}, key });
  }

  /** What each app that connected by code said about itself. */
  readonly connected: Json[] = [];

  #authorize(body: Json): Response {
    this.#codes += 1;
    const deviceCode = `ksd_${String(this.#codes)}`;
    const userCode = `BCDF-GHJ${"KLMNPQRSTV"[this.#codes % 10] ?? "K"}`;
    this.authorizations.set(deviceCode, { userCode, device: body, status: "pending", token: "" });
    return json(200, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: "https://sync.example.com/activate",
      verification_uri_complete: `https://sync.example.com/activate?code=${userCode}`,
      expires_in: 600,
      interval: 5,
    });
  }

  #deviceToken(body: Json): Response {
    const deviceCode = String(body.device_code);
    const request = this.authorizations.get(deviceCode);
    if (!request) return json(400, error("expired_token", "the code has expired"));
    if (request.status === "pending") {
      return json(400, error("authorization_pending", "waiting for approval"));
    }
    this.authorizations.delete(deviceCode);
    if (request.status === "denied") return json(400, error("access_denied", "denied"));
    return json(200, { token: request.token, device: { id: "d1" }, user: {} });
  }

  /** A deletion made by another device, directly on the server. */
  remove(id: string): void {
    const note = this.notes.get(id);
    if (note)
      Object.assign(note, {
        revision: note.revision + 1,
        deletedAt: "2026-09-28T10:00:00Z",
        seq: this.#nextSeq(),
      });
  }

  /** Ends every open event stream, as a dropped connection would. */
  dropStreams(): void {
    for (const stream of this.#streams) stream.close();
    this.#streams.clear();
  }

  get openStreams(): number {
    return this.#streams.size;
  }

  #nextSeq(): number {
    this.#seq += 1;
    this.#announce();
    return this.#seq;
  }

  /** Tells the open streams that something changed (after it is stored). */
  #announce(): void {
    queueMicrotask(() => {
      for (const stream of this.#streams) send(stream);
    });
  }

  /**
   * Checks an envelope like the real server (shape, current key) and opens
   * it with the key the server knows here; a Response when it is refused.
   */
  async #open(id: string, content: unknown): Promise<string | Response> {
    const keyId = typeof content === "string" ? envelopeKeyId(content) : null;
    if (typeof content !== "string" || keyId === null) {
      return json(400, error("invalid_content", "note is not encrypted"));
    }
    if (!this.#key) return json(409, error("encryption_required", "set up encryption"));
    if (keyId !== this.#key.record.keyId) {
      return json(409, error("key_mismatch", "the note is encrypted with another key"));
    }
    const markdown = await decryptNote(this.#key.contentKey, keyId, id, content);
    if (markdown.length > this.maxMarkdownLength) {
      return json(400, error("invalid_content", "note is too large"));
    }
    return markdown;
  }

  #events(signal: AbortSignal | null): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.#streams.add(c);
        send(c); // One on connect: the client catches up.
      },
      cancel: () => {
        if (controller) this.#streams.delete(controller);
      },
    });
    signal?.addEventListener("abort", () => {
      if (!controller || !this.#streams.delete(controller)) return;
      controller.error(new DOMException("The request was aborted", "AbortError"));
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  /** A change made by another device, directly on the server. */
  async write(id: string, markdown: string): Promise<void> {
    await this.#ready;
    const key = this.#key;
    if (!key) throw new Error("No key to write with");
    const content = await encryptNote(key.contentKey, key.record.keyId, id, markdown);
    const existing = this.notes.get(id);
    this.notes.set(id, {
      id,
      content,
      markdown,
      revision: (existing?.revision ?? 0) + 1,
      deletedAt: null,
      seq: this.#nextSeq(),
    });
  }

  async #create(body: Json): Promise<Response> {
    const id = String(body.id);
    const markdown = await this.#open(id, body.content);
    if (markdown instanceof Response) return markdown;
    const existing = this.notes.get(id);
    if (existing) return conflict(existing);
    const note = {
      id,
      content: String(body.content),
      markdown,
      revision: 1,
      deletedAt: null,
      seq: this.#nextSeq(),
    };
    this.notes.set(id, note);
    return json(201, wire(note));
  }

  async #update(id: string, body: Json): Promise<Response> {
    const markdown = await this.#open(id, body.content);
    if (markdown instanceof Response) return markdown;
    const note = this.notes.get(id);
    if (!note) return json(404, error("not_found", "note not found"));
    if (note.revision !== body.base_revision) return conflict(note);
    // At a deleted note's own revision, an update brings it back.
    Object.assign(note, {
      content: String(body.content),
      markdown,
      revision: note.revision + 1,
      deletedAt: null,
      seq: this.#nextSeq(),
    });
    return json(200, wire(note));
  }

  #delete(id: string, base: number): Response {
    const note = this.notes.get(id);
    if (!note || note.deletedAt !== null) return json(404, error("not_found", "note not found"));
    if (note.revision !== base) return conflict(note);
    Object.assign(note, {
      revision: note.revision + 1,
      deletedAt: "2026-09-28T10:00:00Z",
      seq: this.#nextSeq(),
    });
    return new Response(null, { status: 204 });
  }

  #changes(url: URL): Response {
    const since = Number(url.searchParams.get("since") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const changed = [...this.notes.values()]
      .filter((note) => note.seq > since)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    return json(200, {
      notes: changed.map(wire),
      cursor: changed.at(-1)?.seq ?? since,
      more: changed.length === limit,
      key_id: this.#key?.record.keyId ?? null,
    });
  }
}

function wire(note: StoredNote): Json {
  return {
    id: note.id,
    content: note.content,
    revision: note.revision,
    created_at: "2026-09-28T10:00:00Z",
    updated_at: "2026-09-28T10:00:00Z",
    ...(note.deletedAt ? { deleted_at: note.deletedAt } : {}),
  };
}

function keyWire(record: KeyRecord): Json {
  return {
    key_id: record.keyId,
    kdf: record.kdf,
    kdf_params: record.kdfParams,
    salt: record.salt,
    wrapped_key: record.wrappedKey,
    recovery_wrapped_key: record.recoveryWrappedKey,
    created_at: "2026-09-28T10:00:00Z",
    updated_at: "2026-09-28T10:00:00Z",
  };
}

function send(stream: ReadableStreamDefaultController<Uint8Array>): void {
  stream.enqueue(new TextEncoder().encode("event: changes\ndata: {}\n\n"));
}

function conflict(note: StoredNote): Response {
  return json(409, { ...error("revision_conflict", "note changed"), current: wire(note) });
}

function error(code: string, message: string): Json {
  return { error: { code, message } };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
