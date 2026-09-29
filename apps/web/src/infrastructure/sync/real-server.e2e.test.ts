import { createNote, updateNote } from "../../domain/note/note";
import { openNoteStore } from "../storage/note-store";
import { SyncEngine } from "./sync-engine";
import { mustGet } from "../storage/test-utils";

/**
 * Two devices syncing through a real Konspecter server. Runs only when
 * KONSPECTER_E2E_URL and KONSPECTER_E2E_TOKEN are set (see
 * docs/architecture/sync.md); the fake server covers the same rules otherwise.
 */
// Read without Node types: the app's TypeScript config targets the browser.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const url = env?.KONSPECTER_E2E_URL;
const token = env?.KONSPECTER_E2E_TOKEN;

describe.skipIf(!url || !token)("sync against a real server", () => {
  const config = { serverUrl: url ?? "", token: token ?? "" };
  const noop = { set: () => null, clear: () => undefined };
  const run = Date.now().toString(36);

  async function device(name: string) {
    const store = await openNoteStore(`e2e-${run}-${name}`);
    const engine = new SyncEngine(store, { scheduler: noop, isOnline: () => true });
    await engine.connect(config);
    return { store, engine };
  }

  it("syncs creates, edits, conflicts (keeping both versions) and deletes", async () => {
    const a = await device("a");
    const id = `e2e-${run}`;
    await a.store.put(createNote("# From A", new Date(), id));
    await a.engine.syncNow();

    const b = await device("b");
    expect((await b.store.get(id))?.markdown).toContain("# From A");

    const onB = await mustGet(b.store, id);
    await b.store.put(updateNote(onB, "# Edited on B", new Date()));
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.store.get(id))?.markdown).toContain("Edited on B");

    const onA = await mustGet(a.store, id);
    const onB2 = await mustGet(b.store, id);
    await a.store.put(updateNote(onA, "# A wins the race", new Date()));
    await b.store.put(updateNote(onB2, "# B loses the race", new Date()));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    // The server's version keeps the note; B's edit survives as a conflict copy on both.
    for (const store of [a.store, b.store]) {
      expect((await store.get(id))?.markdown).toContain("A wins the race");
      const copy = (await store.list()).find((note) =>
        note.markdown.includes(`conflict_of: ${id}`),
      );
      expect(copy?.markdown).toContain("B loses the race");
    }

    await a.store.delete(id);
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
  });
});
