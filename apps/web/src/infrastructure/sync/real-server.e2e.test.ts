import { createKey, keyToJson } from "@konspecter/crypto";
import { createNote, updateNote } from "../../domain/note/note";
import { openNoteStore } from "../storage/note-store";
import { SyncEngine } from "./sync-engine";
import { mustGet } from "../storage/test-utils";

/**
 * Two devices syncing through a real Konspecter server. Runs only when
 * KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN are set (see
 * docs/architecture/sync.md); the fake server covers the same rules otherwise.
 * When the account has no encryption yet, the test sets it up with
 * KONSPECTER_E2E_PASSPHRASE (default below); otherwise that must be its
 * passphrase.
 */
// Read without Node types: the app's TypeScript config targets the browser.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const url = env?.KONSPECTER_E2E_URL;
const token = env?.KONSPECTER_E2E_TOKEN;
const passphrase = env?.KONSPECTER_E2E_PASSPHRASE ?? "konspecter e2e passphrase";

/** Sets up encryption for the account, unless it has a key already. */
async function ensureKey(serverUrl: string, accessToken: string): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const existing = await fetch(`${serverUrl}/api/keys`, { headers });
  if (existing.ok) return;
  const { record } = await createKey(passphrase);
  const created = await fetch(`${serverUrl}/api/keys`, {
    method: "PUT",
    headers,
    body: JSON.stringify(keyToJson(record)),
  });
  if (!created.ok) throw new Error(`Setting up encryption failed: ${String(created.status)}`);
}

describe.skipIf(!url || !token)("sync against a real server", () => {
  const config = { serverUrl: url ?? "", token: token ?? "" };
  const noop = { set: () => null, clear: () => undefined };
  const run = Date.now().toString(36);

  beforeAll(() => ensureKey(config.serverUrl, config.token), 30_000);

  async function device(name: string) {
    const store = await openNoteStore(`e2e-${run}-${name}`);
    const engine = new SyncEngine(store, { scheduler: noop, isOnline: () => true });
    await engine.connect(config);
    await engine.unlock(passphrase);
    return { store, engine };
  }

  it("syncs creates, edits, the later of two edits, restores and deletes", async () => {
    const a = await device("a");
    const id = `e2e-${run}`;
    await a.store.put(createNote("# From A", new Date(), id));
    await a.engine.syncNow();

    const b = await device("b");
    expect((await b.store.get(id))?.markdown).toContain("# From A");

    await b.store.put(updateNote(await mustGet(b.store, id), "# Edited on B", new Date()));
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.store.get(id))?.markdown).toContain("Edited on B");

    // B's edit is the later one: it wins, though A reaches the server first.
    const now = Date.now();
    await a.store.put(updateNote(await mustGet(a.store, id), "# Earlier on A", new Date(now)));
    await b.store.put(
      updateNote(await mustGet(b.store, id), "# Later on B", new Date(now + 60_000)),
    );
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    for (const store of [a.store, b.store]) {
      expect((await store.get(id))?.markdown).toContain("Later on B");
      // No copy: the account may hold notes of earlier runs, but none has A's text.
      const copies = (await store.list()).filter((note) => note.markdown.includes("Earlier on A"));
      expect(copies).toEqual([]);
    }

    // Edits beat deletions: A deletes it, B edits it meanwhile, and it stays.
    await a.store.delete(id);
    await b.store.put(
      updateNote(await mustGet(b.store, id), "# Still needed", new Date(now + 120_000)),
    );
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    for (const store of [a.store, b.store]) {
      expect((await store.get(id))?.markdown).toContain("Still needed");
    }

    await a.store.delete(id);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(await b.store.get(id)).toBeUndefined();
    // The change stream may have A looking again on its own; it settles with nothing left.
    await vi.waitFor(() => {
      expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
    });
    a.engine.stop();
    b.engine.stop();
  });

  it("brings a change to the other device at once, through the change stream", async () => {
    const a = await device("stream-a");
    const b = await device("stream-b");
    const id = `e2e-stream-${run}`;

    await a.store.put(createNote("# Pushed", new Date(), id));
    await a.engine.syncNow();

    // B never calls syncNow: the server's event starts its cycle.
    await vi.waitFor(
      async () => {
        expect((await b.store.get(id))?.markdown).toContain("# Pushed");
      },
      { timeout: 5000 },
    );
    a.engine.stop();
    b.engine.stop();
  });
});
