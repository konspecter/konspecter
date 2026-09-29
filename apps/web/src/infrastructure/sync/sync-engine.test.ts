import { parseDocument } from "../../domain/document/document";
import { createNote, updateNote } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../storage/note-store";
import { FakeServer } from "./fake-server";
import { SyncEngine, type Scheduler } from "./sync-engine";
import { mustGet } from "../storage/test-utils";

let databaseCount = 0;
const config = { serverUrl: "https://sync.example.com", token: "ksp_ada" };
const date = new Date("2026-09-28T10:00:00Z");

/** Records scheduled callbacks so tests decide when time passes. */
class ManualScheduler implements Scheduler {
  pending: { callback: () => void; delayMs: number }[] = [];
  set = (callback: () => void, delayMs: number) => {
    const task = { callback, delayMs };
    this.pending.push(task);
    return task;
  };
  clear = (handle: unknown) => {
    this.pending = this.pending.filter((task) => task !== handle);
  };
  get nextDelay() {
    return this.pending.at(-1)?.delayMs;
  }
}

type Device = {
  store: NoteStore;
  engine: SyncEngine;
  scheduler: ManualScheduler;
  online: { value: boolean };
};

async function device(server: FakeServer): Promise<Device> {
  databaseCount += 1;
  let copies = 0;
  const deviceId = databaseCount;
  const store = await openNoteStore(`sync-test-${String(databaseCount)}`);
  const scheduler = new ManualScheduler();
  const online = { value: true };
  const engine = new SyncEngine(store, {
    fetch: server.fetch,
    scheduler,
    random: () => 0.5,
    isOnline: () => online.value,
    now: () => date,
    newId: () => {
      copies += 1;
      return `copy-${String(deviceId)}-${String(copies)}`;
    },
  });
  return { store, engine, scheduler, online };
}

/** Conflict copies of a note, as their Markdown bodies. */
async function copiesOf(store: NoteStore, id: string): Promise<string[]> {
  return (await store.list())
    .map((note) => parseDocument(note.markdown))
    .filter((doc) => doc.metadata.conflictOf === id)
    .map((doc) => doc.body);
}

async function markdownOf(store: NoteStore, id: string) {
  return (await store.get(id))?.markdown;
}

describe("SyncEngine", () => {
  it("pushes local notes and marks them synced", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Local", date, "n1"));

    await a.engine.connect(config);

    expect(server.notes.get("n1")?.markdown).toBe(await markdownOf(a.store, "n1"));
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 1, dirty: false });
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0, blocked: 0 });
    expect(a.engine.getStatus().account?.email).toBe("ada@example.com");
  });

  it("uploads notes written before sync was set up", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("old", date, "old"));

    await a.engine.connect(config);

    expect(server.notes.has("old")).toBe(true);
  });

  it("brings changes from another device, and ignores its own changes coming back", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Shared", date, "n1"));
    await a.engine.connect(config);

    await b.engine.connect(config);
    expect(await markdownOf(b.store, "n1")).toBe(await markdownOf(a.store, "n1"));

    const note = await mustGet(b.store, "n1");
    await b.store.put(updateNote(note, "# Shared, edited on B", date));
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(await markdownOf(a.store, "n1")).toContain("edited on B");
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 2, dirty: false });
  });

  it("propagates deletions in both directions", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("x", date, "x"));
    await a.store.put(createNote("y", date, "y"));
    await a.engine.connect(config);
    await b.engine.connect(config);

    await a.store.delete("x");
    await b.store.delete("y");
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    for (const store of [a.store, b.store]) {
      expect(await store.list()).toEqual([]);
      expect(await store.syncEntries()).toEqual([]);
    }
    expect([...server.notes.values()].every((note) => note.deletedAt !== null)).toBe(true);
  });

  it("settles a note deleted on two devices at once", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("x", date, "x"));
    await a.engine.connect(config);
    await b.engine.connect(config);

    await a.store.delete("x");
    await b.store.delete("x");
    await a.engine.syncNow();
    await b.engine.syncNow();

    expect(await b.store.syncEntries()).toEqual([]);
    expect(b.engine.getStatus()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it("forgets a note deleted before it was ever synced", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    await a.store.put(createNote("draft", date, "draft"));
    await a.store.delete("draft");

    await a.engine.syncNow();

    expect(server.notes.has("draft")).toBe(false);
    expect(server.requests.filter((r) => r.startsWith("DELETE"))).toEqual([]);
  });

  it("queues edits made offline and pushes the latest version once", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    a.online.value = false;
    const note = createNote("v1", date, "n1");
    await a.store.put(note);
    await a.store.put(updateNote(note, "v2", date));
    await a.store.put(updateNote(note, "v3", date));

    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "offline", pending: 1 });
    expect(server.notes.has("n1")).toBe(false);

    a.online.value = true;
    server.requests.length = 0;
    await a.engine.syncNow();

    expect(server.requests.filter((r) => r === "POST /api/notes")).toHaveLength(1);
    expect(server.notes.get("n1")?.markdown).toContain("v3");
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
  });

  it("keeps a note queued when it is edited while its push is in flight", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    const note = createNote("first", date, "n1");
    await a.store.put(note);
    server.beforeRespond = async (method) => {
      if (method === "POST") {
        server.beforeRespond = null;
        await a.store.put(updateNote(note, "typed during the upload", date));
      }
    };

    await a.engine.syncNow();
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 1, dirty: true });

    await a.engine.syncNow();
    expect(server.notes.get("n1")?.markdown).toContain("typed during the upload");
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 2, dirty: false });
  });

  it("settles a note changed on both sides: server version keeps it, local becomes a copy", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Plan\n\noriginal", date, "n1"));
    await a.engine.connect(config);
    await b.engine.connect(config);

    await a.store.put(updateNote(await mustGet(a.store, "n1"), "# Plan\n\nedited on A", date));
    await b.store.put(updateNote(await mustGet(b.store, "n1"), "# Plan\n\nedited on B", date));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    for (const store of [a.store, b.store]) {
      expect(await markdownOf(store, "n1")).toContain("edited on A");
      expect(await copiesOf(store, "n1")).toEqual(["# Plan\n\nedited on B"]);
      expect(await store.pendingSync()).toEqual([]);
    }
    const copyNote = (await b.store.list()).find((note) => note.id !== "n1");
    expect(parseDocument(copyNote?.markdown ?? "").metadata.title).toBe(
      "Plan (conflict copy 2026-09-28 10:00 UTC)",
    );
    expect(server.notes.get(copyNote?.id ?? "")?.markdown).toContain("edited on B");
    expect(b.engine.getStatus()).toMatchObject({ state: "idle", pending: 0, blocked: 0 });
  });

  it("keeps a local edit of a note deleted elsewhere as a copy", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Draft", date, "n1"));
    await a.engine.connect(config);
    server.remove("n1");
    await a.store.put(updateNote(await mustGet(a.store, "n1"), "# Draft\n\nmore work", date));

    await a.engine.syncNow();

    expect(await a.store.get("n1")).toBeUndefined();
    expect(await copiesOf(a.store, "n1")).toEqual(["# Draft\n\nmore work"]);
    expect(
      [...server.notes.values()].filter((n) => n.deletedAt === null).map((n) => n.markdown),
    ).toEqual([expect.stringContaining("more work")]);
  });

  it("brings back a note deleted here but edited elsewhere", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Keep me", date, "n1"));
    await a.engine.connect(config);
    server.write("n1", "# Keep me\n\nedited elsewhere");
    await a.store.delete("n1");

    await a.engine.syncNow();

    expect(await markdownOf(a.store, "n1")).toBe("# Keep me\n\nedited elsewhere");
    expect(server.notes.get("n1")?.deletedAt).toBeNull();
    expect(await a.store.list()).toHaveLength(1);
  });

  it("settles identical versions without making a copy", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const note = createNote("# Same", date, "n1");
    await a.store.put(note);
    await a.engine.connect(config);
    // The same account connected again from scratch: every note is re-uploaded.
    await a.engine.disconnect();
    await a.store.resetSync();
    await a.engine.connect(config);

    expect(await a.store.list()).toEqual([note]);
    expect(await a.store.syncEntry("n1")).toMatchObject({
      baseRevision: 1,
      dirty: false,
      blocked: null,
    });
  });

  it("converges three devices editing the same note, keeping every version", async () => {
    const server = new FakeServer();
    const devices = [await device(server), await device(server), await device(server)];
    const [a, b, c] = devices as [Device, Device, Device];
    await a.store.put(createNote("start", date, "n1"));
    for (const d of devices) await d.engine.connect(config);

    for (const [name, d] of [
      ["A", a],
      ["B", b],
      ["C", c],
    ] as const) {
      await d.store.put(updateNote(await mustGet(d.store, "n1"), `version ${name}`, date));
    }
    for (let round = 0; round < 2; round += 1) {
      for (const d of devices) await d.engine.syncNow();
    }

    const texts = async (d: Device) =>
      (await d.store.list()).map((note) => parseDocument(note.markdown).body).sort();
    const expected = await texts(a);
    expect(expected).toEqual(["version A", "version B", "version C"]);
    expect(await texts(b)).toEqual(expected);
    expect(await texts(c)).toEqual(expected);
  });

  it("holds back a note the server refuses and syncs the rest", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    await a.store.put(createNote("x".repeat(2000), date, "huge"));
    await a.store.put(createNote("fine", date, "ok"));

    await a.engine.syncNow();

    expect(server.notes.has("ok")).toBe(true);
    expect((await a.store.syncEntry("huge"))?.blocked).toEqual({
      reason: "rejected",
      message: "note is too large",
    });
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", blocked: 1 });
  });

  it("retries with exponential backoff and recovers", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    await a.store.put(createNote("n", date, "n1"));

    server.failWith = 503;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "error", pending: 1 });
    expect(a.scheduler.nextDelay).toBe(2000);
    await a.engine.syncNow();
    expect(a.scheduler.nextDelay).toBe(4000);
    await a.engine.syncNow();
    expect(a.scheduler.nextDelay).toBe(8000);

    server.failWith = "network";
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("offline");

    server.failWith = null;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0, error: null });
    expect(a.scheduler.nextDelay).toBe(60_000);
  });

  it("syncs soon after a local change", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.start();
    await a.engine.connect(config);

    await a.store.put(createNote("new", date, "n1"));

    expect(a.scheduler.nextDelay).toBe(1500);
    a.scheduler.pending.at(-1)?.callback();
    await a.engine.syncNow();
    expect(server.notes.has("n1")).toBe(true);
    a.engine.stop();
  });

  it("rejects bad credentials without connecting", async () => {
    const server = new FakeServer();
    const a = await device(server);

    await expect(a.engine.connect({ ...config, token: "ksp_wrong" })).rejects.toThrow(
      "a valid bearer token is required",
    );
    expect(a.engine.getStatus().state).toBe("disabled");
  });

  it("remembers the connection across restarts and can disconnect", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);

    const restarted = new SyncEngine(a.store, {
      fetch: server.fetch,
      scheduler: a.scheduler,
      isOnline: () => true,
    });
    await restarted.start();
    expect(restarted.getStatus()).toMatchObject({ state: "idle", serverUrl: config.serverUrl });

    await restarted.disconnect();
    expect(restarted.getStatus().state).toBe("disabled");
    const again = new SyncEngine(a.store, { fetch: server.fetch, scheduler: a.scheduler });
    await again.start();
    expect(again.getStatus().state).toBe("disabled");
    restarted.stop();
    again.stop();
  });
});

describe("SyncEngine with a credential store", () => {
  function memoryCredentials() {
    let token: string | null = null;
    return {
      get token() {
        return token;
      },
      load: () => Promise.resolve(token),
      save: (value: string) => {
        token = value;
        return Promise.resolve();
      },
      clear: () => {
        token = null;
        return Promise.resolve();
      },
    };
  }

  it("keeps the token out of the database", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const credentials = memoryCredentials();
    const engine = new SyncEngine(a.store, {
      fetch: server.fetch,
      scheduler: a.scheduler,
      credentials,
      isOnline: () => true,
    });

    await engine.connect(config);

    expect(credentials.token).toBe("ksp_ada");
    expect(JSON.stringify(await a.store.loadMeta("syncConfig"))).not.toContain("ksp_ada");

    const restarted = new SyncEngine(a.store, {
      fetch: server.fetch,
      scheduler: a.scheduler,
      credentials,
      isOnline: () => true,
    });
    await restarted.start();
    expect(restarted.getStatus().state).toBe("idle");

    await restarted.disconnect();
    expect(credentials.token).toBeNull();
    restarted.stop();
  });

  it("moves a token saved in the database into the credential store", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config); // Saved in the database (no credential store).
    const credentials = memoryCredentials();

    const engine = new SyncEngine(a.store, {
      fetch: server.fetch,
      scheduler: a.scheduler,
      credentials,
      isOnline: () => true,
    });
    await engine.start();

    expect(credentials.token).toBe("ksp_ada");
    expect(JSON.stringify(await a.store.loadMeta("syncConfig"))).not.toContain("ksp_ada");
    expect(engine.getStatus().state).toBe("idle");
    engine.stop();
  });
});
