import { WrongSecretError } from "@konspecter/crypto";
import { parseDocument } from "../../domain/document/document";
import { createNote, updateNote, type Note } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../storage/note-store";
import { FakeServer, TEST_PASSPHRASE } from "./fake-server";
import { DeviceLoginError } from "./device-login";
import { NoKeyError, SyncEngine, type Scheduler } from "./sync-engine";
import { mustGet } from "../storage/test-utils";

let databaseCount = 0;
const config = { serverUrl: "https://sync.example.com", token: "ksp_ada" };
const date = new Date("2026-09-28T10:00:00Z");
const minutesLater = (minutes: number) => new Date(date.getTime() + minutes * 60_000);

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

async function device(server: FakeServer, fetch = server.fetch): Promise<Device> {
  databaseCount += 1;
  const store = await openNoteStore(`sync-test-${String(databaseCount)}`);
  const scheduler = new ManualScheduler();
  const online = { value: true };
  const engine = new SyncEngine(store, {
    fetch,
    scheduler,
    random: () => 0.5,
    isOnline: () => online.value,
    now: () => date,
    isVisible: () => true,
  });
  return { store, engine, scheduler, online };
}

/** Connects an engine and unlocks the account's key, as its owner would. */
async function connected(engine: SyncEngine, to: typeof config = config): Promise<void> {
  await engine.connect(to);
  await engine.unlock(TEST_PASSPHRASE);
}

/** Edits the note on a device, as saved at `when`. */
async function edit(d: Device, id: string, body: string, when: Date): Promise<void> {
  await d.store.put(updateNote(await mustGet(d.store, id), body, when));
}

const bodyOf = (note: Note | undefined) => (note ? parseDocument(note.markdown).body : undefined);

async function markdownOf(store: NoteStore, id: string) {
  return (await store.get(id))?.markdown;
}

describe("SyncEngine", () => {
  it("pushes local notes and marks them synced", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Local", date, "n1"));

    await connected(a.engine, config);

    expect(server.notes.get("n1")?.markdown).toBe(await markdownOf(a.store, "n1"));
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 1, dirty: false });
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0, blocked: 0 });
    expect(a.engine.getStatus().account?.email).toBe("ada@example.com");
  });

  it("uploads notes written before sync was set up", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("old", date, "old"));

    await connected(a.engine, config);

    expect(server.notes.has("old")).toBe(true);
  });

  it("brings changes from another device, and ignores its own changes coming back", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Shared", date, "n1"));
    await connected(a.engine, config);

    await connected(b.engine, config);
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
    await connected(a.engine, config);
    await connected(b.engine, config);

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
    await connected(a.engine, config);
    await connected(b.engine, config);

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
    await connected(a.engine, config);
    await a.store.put(createNote("draft", date, "draft"));
    await a.store.delete("draft");

    await a.engine.syncNow();

    expect(server.notes.has("draft")).toBe(false);
    expect(server.requests.filter((r) => r.startsWith("DELETE"))).toEqual([]);
  });

  it("queues edits made offline and pushes the latest version once", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await connected(a.engine, config);
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
    await connected(a.engine, config);
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

  it("settles a note changed on both sides: the later edit wins everywhere", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Plan\n\noriginal", date, "n1"));
    await connected(a.engine, config);
    await connected(b.engine, config);

    await edit(b, "n1", "# Plan\n\nedited on B, later", minutesLater(5));
    await edit(a, "n1", "# Plan\n\nedited on A", minutesLater(1));
    await a.engine.syncNow(); // A reaches the server first...
    await b.engine.syncNow(); // ...but B's later edit wins,
    await a.engine.syncNow(); // and A takes it.

    for (const store of [a.store, b.store]) {
      expect(bodyOf(await store.get("n1"))).toBe("# Plan\n\nedited on B, later");
      expect(await store.list()).toHaveLength(1);
      expect(await store.pendingSync()).toEqual([]);
    }
    expect(bodyOf(server.notes.get("n1"))).toBe("# Plan\n\nedited on B, later");
    expect(b.engine.getStatus()).toMatchObject({ state: "idle", pending: 0, blocked: 0 });
  });

  it("lets an older offline edit that arrives late lose to a newer one", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Plan\n\noriginal", date, "n1"));
    await connected(a.engine, config);
    await connected(b.engine, config);

    b.online.value = false;
    await edit(b, "n1", "# Plan\n\nold offline edit", minutesLater(1));
    await edit(a, "n1", "# Plan\n\nnewer edit", minutesLater(5));
    await a.engine.syncNow();
    b.online.value = true;
    await b.engine.syncNow();

    expect(bodyOf(await b.store.get("n1"))).toBe("# Plan\n\nnewer edit");
    expect(bodyOf(server.notes.get("n1"))).toBe("# Plan\n\nnewer edit");
  });

  it("keeps a local edit of a note deleted elsewhere, and restores it on the server", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Draft", date, "n1"));
    await connected(a.engine, config);
    server.remove("n1");
    await edit(a, "n1", "# Draft\n\nmore work", minutesLater(1));

    await a.engine.syncNow();

    expect(bodyOf(await a.store.get("n1"))).toBe("# Draft\n\nmore work");
    expect(server.notes.get("n1")).toMatchObject({ deletedAt: null });
    expect(bodyOf(server.notes.get("n1"))).toBe("# Draft\n\nmore work");
    expect(await a.store.pendingSync()).toEqual([]);
  });

  it("brings back a note deleted here but edited elsewhere", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Keep me", date, "n1"));
    await connected(a.engine, config);
    await server.write("n1", "# Keep me\n\nedited elsewhere");
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
    await connected(a.engine, config);
    // The same account connected again from scratch (disconnecting signed
    // the old token out): every note is re-uploaded.
    await a.engine.disconnect();
    await a.store.resetSync();
    server.tokens.set("ksp_ada_again", { id: "user-ada", email: "ada@example.com" });
    await connected(a.engine, { ...config, token: "ksp_ada_again" });

    expect(await a.store.list()).toEqual([note]);
    expect(await a.store.syncEntry("n1")).toMatchObject({
      baseRevision: 1,
      dirty: false,
      blocked: null,
    });
  });

  it("converges three devices editing the same note on the latest edit", async () => {
    const server = new FakeServer();
    const devices = [await device(server), await device(server), await device(server)];
    const [a, b, c] = devices as [Device, Device, Device];
    await a.store.put(createNote("start", date, "n1"));
    for (const d of devices) await connected(d.engine, config);

    await edit(a, "n1", "version A", minutesLater(1));
    await edit(b, "n1", "version B, the latest", minutesLater(3));
    await edit(c, "n1", "version C", minutesLater(2));
    for (let round = 0; round < 2; round += 1) {
      for (const d of devices) await d.engine.syncNow();
    }

    for (const d of devices) {
      expect((await d.store.list()).map(bodyOf)).toEqual(["version B, the latest"]);
    }
  });

  it("holds back a note the server refuses and syncs the rest", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await connected(a.engine, config);
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
    await connected(a.engine, config);
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
    expect(a.scheduler.nextDelay).toBe(10_000); // This server has no change stream: poll.
  });

  it("syncs soon after a local change", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.start();
    await connected(a.engine, config);

    await a.store.put(createNote("new", date, "n1"));

    expect(a.scheduler.nextDelay).toBe(100);
    a.scheduler.pending.at(-1)?.callback();
    await a.engine.syncNow();
    expect(server.notes.has("n1")).toBe(true);
    a.engine.stop();
  });

  it("brings another device's edit at once through the change stream", async () => {
    const server = new FakeServer();
    server.eventStreams = true;
    const a = await device(server);
    const b = await device(server);
    await a.store.put(createNote("# Live", date, "n1"));
    await connected(a.engine, config);
    await connected(b.engine, config);
    await vi.waitFor(() => {
      expect(server.openStreams).toBe(2);
    });

    await edit(a, "n1", "# Live\n\ntyped on A", minutesLater(1));
    await a.engine.syncNow();

    // B never syncs by itself here: the event from the server starts its cycle.
    await vi.waitFor(async () => {
      expect(bodyOf(await b.store.get("n1"))).toBe("# Live\n\ntyped on A");
    });
    await vi.waitFor(() => {
      expect(b.scheduler.nextDelay).toBe(60_000); // While streaming, polling is a safety net.
    });
    a.engine.stop();
    b.engine.stop();
    expect(server.openStreams).toBe(0);
  });

  it("polls while the change stream is down, and reconnects with backoff", async () => {
    const server = new FakeServer();
    server.eventStreams = true;
    const a = await device(server);
    await connected(a.engine, config);
    await vi.waitFor(() => {
      expect(server.openStreams).toBe(1);
    });

    server.dropStreams();
    await vi.waitFor(() => {
      expect(a.scheduler.pending.map((task) => task.delayMs)).toEqual(
        expect.arrayContaining([1000, 10_000]),
      );
    });

    a.scheduler.pending.find((task) => task.delayMs === 1000)?.callback();
    await vi.waitFor(() => {
      expect(server.openStreams).toBe(1);
    });
    expect(server.requests.filter((r) => r === "GET /api/events")).toHaveLength(2);
    a.engine.stop();
  });

  it("does without a change stream on a server that has none", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await connected(a.engine, config);
    await a.engine.syncNow();

    await vi.waitFor(() => {
      expect(server.requests.filter((r) => r === "GET /api/events")).toHaveLength(1);
    });
    expect(a.scheduler.pending.map((task) => task.delayMs)).toEqual([10_000]);
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
    await connected(a.engine, config);

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

describe("SyncEngine and the account's devices", () => {
  const laptop = { name: "Firefox on Linux", platform: "web", clientVersion: "0.1.0" };

  /** Runs the next scheduled wait (a poll's interval) once one is due. */
  async function nextWait(d: Device) {
    await vi.waitFor(() => {
      expect(d.scheduler.pending).toHaveLength(1);
    });
    const task = d.scheduler.pending.shift();
    task?.callback();
  }

  it("signs in through the browser once the owner approves the code", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Local", date, "n1"));
    const codes: string[] = [];

    const signingIn = a.engine.signInWithBrowser("https://sync.example.com/", laptop, (auth) => {
      codes.push(auth.userCode);
      expect(auth.verificationUriComplete).toBe(
        `https://sync.example.com/activate?code=${auth.userCode}`,
      );
    });
    await nextWait(a);
    await vi.waitFor(() => {
      expect(a.scheduler.pending).toHaveLength(1); // Not approved yet: waits again.
    });
    expect(codes).toHaveLength(1);
    server.decide(codes[0] ?? "", true);
    await nextWait(a);

    expect((await signingIn).email).toBe("ada@example.com");
    expect([...server.authorizations.values()]).toEqual([]);
    expect(server.requests.filter((r) => r === "POST /api/devices/token")).toHaveLength(2);
    // Signed in, but nothing goes out before the passphrase unlocks the key.
    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "unlock" });
    expect(server.notes.has("n1")).toBe(false);
    await a.engine.unlock(TEST_PASSPHRASE);
    expect(server.notes.has("n1")).toBe(true);
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", serverUrl: config.serverUrl });
  });

  it("connects with a link scanned from the site, then asks for the passphrase", async () => {
    const server = new FakeServer();
    const code = "ksc_abcdefghijklmnopqrstuvwxyz012345";
    server.connectCodes.set(code, "ksp_ada");
    const a = await device(server);
    await a.store.put(createNote("# Local", date, "n1"));

    const account = await a.engine.connectWithLink(
      { serverUrl: "https://sync.example.com", code },
      laptop,
    );

    expect(account.email).toBe("ada@example.com");
    expect(server.connected).toEqual([
      { code, name: "Firefox on Linux", platform: "web", client_version: "0.1.0" },
    ]);
    expect(a.engine.getStatus()).toMatchObject({
      state: "locked",
      lock: "unlock",
      serverUrl: "https://sync.example.com",
    });
    expect(server.notes.has("n1")).toBe(false);
    // The code is used up.
    await expect(
      a.engine.connectWithLink({ serverUrl: "https://sync.example.com", code }, laptop),
    ).rejects.toMatchObject({ code: "invalid_connect_code" });
  });

  it("tells when the owner denies the device", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const signingIn = a.engine.signInWithBrowser(config.serverUrl, laptop, (auth) => {
      server.decide(auth.userCode, false);
    });
    void nextWait(a);
    await expect(signingIn).rejects.toBeInstanceOf(DeviceLoginError);
    await expect(signingIn).rejects.toMatchObject({ reason: "denied" });
    expect(a.engine.getStatus().state).toBe("disabled");
  });

  it("stops waiting when the sign-in is cancelled", async () => {
    const server = new FakeServer();
    const a = await device(server);
    const cancel = new AbortController();
    const signingIn = a.engine.signInWithBrowser(
      config.serverUrl,
      laptop,
      () => undefined,
      cancel.signal,
    );
    await vi.waitFor(() => {
      expect(a.scheduler.pending).toHaveLength(1);
    });
    cancel.abort();
    await expect(signingIn).rejects.toMatchObject({ name: "AbortError" });
    expect(a.scheduler.pending).toEqual([]);
  });

  it("keeps every note when the device is disconnected on the site, and resumes after signing in again", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Kept", date, "n1"));
    await connected(a.engine, config);
    server.disconnectDevice("ksp_ada");
    await edit(a, "n1", "edited while disconnected", minutesLater(1));

    await a.engine.syncNow();

    expect(a.engine.getStatus()).toMatchObject({
      state: "disconnected",
      account: { email: "ada@example.com" },
      serverUrl: config.serverUrl,
      pending: 1,
      error: { code: "device_revoked" },
    });
    expect(bodyOf(await a.store.get("n1"))).toBe("edited while disconnected");
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 1, dirty: true });
    expect(a.scheduler.pending).toEqual([]); // Nothing more is tried.
    expect(JSON.stringify(await a.store.loadMeta("syncConfig"))).not.toContain("ksp_ada");

    const restarted = new SyncEngine(a.store, { fetch: server.fetch, scheduler: a.scheduler });
    await restarted.start();
    expect(restarted.getStatus()).toMatchObject({ state: "disconnected", pending: 1 });

    // Signing in again to the same account carries on where it stopped.
    server.tokens.set("ksp_again", { id: "user-ada", email: "ada@example.com" });
    await connected(restarted, { ...config, token: "ksp_again" });
    expect(await a.store.syncEntry("n1")).toMatchObject({ baseRevision: 2, dirty: false });
    expect(server.notes.get("n1")?.markdown).toContain("edited while disconnected");
    expect(restarted.getStatus().state).toBe("idle");
    restarted.stop();
  });

  it("signs the device out of the server when disconnecting", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await connected(a.engine, config);

    await a.engine.disconnect();

    await vi.waitFor(() => {
      expect(server.requests).toContain("DELETE /api/tokens/current");
    });
    expect(server.tokens.has("ksp_ada")).toBe(false);
    expect(a.engine.getStatus().state).toBe("disabled");
  });
});

describe("SyncEngine and end-to-end encryption", () => {
  it("sends and receives only ciphertext", async () => {
    const server = new FakeServer();
    const bodies: string[] = [];
    const a = await device(server, (input, init) => {
      if (typeof init?.body === "string") bodies.push(init.body);
      return server.fetch(input, init);
    });
    await a.store.put(createNote("# Secret plan\n\nnobody reads this", date, "n1"));
    await connected(a.engine);

    const stored = server.notes.get("n1");
    expect(stored?.content).toMatch(new RegExp(`^ksp1\\.${server.keyId ?? ""}\\.`));
    expect(stored?.content).not.toContain("Secret");
    expect(bodies.some((body) => body.includes("Secret"))).toBe(false);
    expect(stored?.markdown).toBe(await markdownOf(a.store, "n1")); // What the server holds, opened.

    const b = await device(server);
    await connected(b.engine);
    expect(bodyOf(await b.store.get("n1"))).toBe("# Secret plan\n\nnobody reads this");
  });

  it("asks to set up encryption on the site first, then for the passphrase", async () => {
    const server = new FakeServer({ encrypted: false });
    const a = await device(server);
    await a.store.put(createNote("# Waiting", date, "n1"));
    await a.engine.connect(config);

    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "setup", pending: 1 });
    await expect(a.engine.unlock(TEST_PASSPHRASE)).rejects.toBeInstanceOf(NoKeyError);
    expect(server.requests).not.toContain("POST /api/notes");

    await server.setUpKey();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "unlock" });
    await a.engine.unlock(TEST_PASSPHRASE);
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", lock: null, pending: 0 });
    expect(server.notes.get("n1")?.markdown).toBe(await markdownOf(a.store, "n1"));
  });

  it("refuses a wrong passphrase and stays locked", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.engine.connect(config);
    await expect(a.engine.unlock("wrong horse battery")).rejects.toBeInstanceOf(WrongSecretError);
    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "unlock" });
  });

  it("keeps the unlocked key across restarts, out of reach", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await connected(a.engine);
    const stored = (await a.store.loadMeta("syncKey")) as { keyId: string; key: CryptoKey };
    expect(stored.keyId).toBe(server.keyId);
    expect(stored.key.extractable).toBe(false);

    const restarted = new SyncEngine(a.store, {
      fetch: server.fetch,
      scheduler: a.scheduler,
      isOnline: () => true,
      isVisible: () => true,
    });
    await restarted.start();
    expect(restarted.getStatus()).toMatchObject({ state: "idle", lock: null });
    restarted.stop();
  });

  it("after a reset on the site, unlocks the new key and uploads everything again", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# Kept on the device", date, "n1"));
    await connected(a.engine);

    server.resetKey();
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "setup" });
    await server.setUpKey("a new passphrase");
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "unlock" });
    await expect(a.engine.unlock(TEST_PASSPHRASE)).rejects.toBeInstanceOf(WrongSecretError);

    await a.engine.unlock("a new passphrase");
    expect(server.notes.get("n1")?.markdown).toBe(await markdownOf(a.store, "n1"));
    expect(server.notes.get("n1")?.content).toContain(`ksp1.${server.keyId ?? ""}.`);
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
  });

  it("locks when a push meets another key, without holding the note back", async () => {
    const server = new FakeServer();
    const a = await device(server);
    await a.store.put(createNote("# One", date, "n1"));
    await connected(a.engine);
    await server.setUpKey("rotated"); // A key this device does not have yet.
    await edit(a, "n1", "edited", minutesLater(1));

    await a.engine.syncNow();

    expect(a.engine.getStatus()).toMatchObject({ state: "locked", lock: "unlock", blocked: 0 });
    expect(await a.store.syncEntry("n1")).toMatchObject({ dirty: true, blocked: null });
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

    await connected(engine, config);

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
    await connected(a.engine, config); // Saved in the database (no credential store).
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
