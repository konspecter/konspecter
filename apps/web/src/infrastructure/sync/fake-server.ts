/**
 * Test double for the Go server: the same routes, revision rules, per-user
 * change sequence and tombstones, in memory, behind a `fetch` function.
 * Used only by tests.
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
        seq: ++this.#seq,
      });
  }

  /** A change made by another device, directly on the server. */
  write(id: string, markdown: string): void {
    const existing = this.notes.get(id);
    this.notes.set(id, {
      id,
      markdown,
      revision: (existing?.revision ?? 0) + 1,
      deletedAt: null,
      seq: ++this.#seq,
    });
  }

  #create(body: Json): Response {
    const id = String(body.id);
    if (typeof body.markdown === "string" && body.markdown.length > this.maxMarkdownLength) {
      return json(400, error("invalid_markdown", "note is too large"));
    }
    if (this.notes.has(id)) return json(409, error("exists", "a note with this id already exists"));
    const note = {
      id,
      markdown: String(body.markdown),
      revision: 1,
      deletedAt: null,
      seq: ++this.#seq,
    };
    this.notes.set(id, note);
    return json(201, wire(note));
  }

  #update(id: string, body: Json): Response {
    const note = this.notes.get(id);
    if (!note) return json(404, error("not_found", "note not found"));
    if (note.revision !== body.base_revision || note.deletedAt !== null) return conflict(note);
    Object.assign(note, {
      markdown: String(body.markdown),
      revision: note.revision + 1,
      seq: ++this.#seq,
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
      seq: ++this.#seq,
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
