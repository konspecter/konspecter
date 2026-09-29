/**
 * Test double for the Go server: the same routes, revision rules, per-user
 * change sequence, tombstones and change events, in memory, behind a `fetch`
 * function. Used only by tests.
 */
type StoredNote = {
  id: string;
  markdown: string;
  revision: number;
  deletedAt: string | null;
  seq: number;
};

type Json = Record<string, unknown>;

export class FakeServer {
  readonly notes = new Map<string, StoredNote>();
  #seq = 0;
  readonly tokens = new Map<string, { id: string; email: string }>([
    ["ksp_ada", { id: "user-ada", email: "ada@example.com" }],
  ]);
  /** Makes the server fail requests: a status code, or "network" to refuse connections. */
  failWith: number | "network" | null = null;
  /** Runs before each request is answered (to simulate concurrent activity). */
  beforeRespond: ((method: string, path: string) => Promise<void> | void) | null = null;
  readonly requests: string[] = [];
  /** Tests use a tiny limit to exercise rejected notes; the real server allows 5 MB. */
  maxMarkdownLength = 1000;
  /** Serves `GET /api/events`; off by default, like an older server (404). */
  eventStreams = false;
  readonly #streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    if (this.failWith === "network") throw new TypeError("Failed to fetch");
    if (typeof this.failWith === "number") return json(this.failWith, error("boom", "failure"));
    await this.beforeRespond?.(method, url.pathname);

    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    const user = this.tokens.get(auth.replace(/^Bearer /, ""));
    if (!user) return json(401, error("unauthorized", "a valid bearer token is required"));

    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : {};
    const noteId = /^\/api\/notes\/([^/]+)$/.exec(url.pathname)?.[1];

    if (method === "GET" && url.pathname === "/api/me") return json(200, user);
    if (method === "GET" && url.pathname === "/api/events" && this.eventStreams) {
      return this.#events(init?.signal ?? null);
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
    // After the change is stored: a client that syncs on the event sees it.
    queueMicrotask(() => {
      for (const stream of this.#streams) send(stream);
    });
    return this.#seq;
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
  write(id: string, markdown: string): void {
    const existing = this.notes.get(id);
    this.notes.set(id, {
      id,
      markdown,
      revision: (existing?.revision ?? 0) + 1,
      deletedAt: null,
      seq: this.#nextSeq(),
    });
  }

  #create(body: Json): Response {
    const id = String(body.id);
    if (typeof body.markdown === "string" && body.markdown.length > this.maxMarkdownLength) {
      return json(400, error("invalid_markdown", "note is too large"));
    }
    const existing = this.notes.get(id);
    if (existing) return conflict(existing);
    const note = {
      id,
      markdown: String(body.markdown),
      revision: 1,
      deletedAt: null,
      seq: this.#nextSeq(),
    };
    this.notes.set(id, note);
    return json(201, wire(note));
  }

  #update(id: string, body: Json): Response {
    const note = this.notes.get(id);
    if (!note) return json(404, error("not_found", "note not found"));
    if (note.revision !== body.base_revision) return conflict(note);
    // At a deleted note's own revision, an update brings it back.
    Object.assign(note, {
      markdown: String(body.markdown),
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
    });
  }
}

function wire(note: StoredNote): Json {
  return {
    id: note.id,
    markdown: note.markdown,
    revision: note.revision,
    created_at: "2026-09-28T10:00:00Z",
    updated_at: "2026-09-28T10:00:00Z",
    ...(note.deletedAt ? { deleted_at: note.deletedAt } : {}),
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
