import { openDB } from "idb";
import { createNote, InvalidNoteError, updateNote } from "../../domain/note/note";
import { parseQuery } from "../../domain/search/query";
import { DEFAULT_SETTINGS } from "../../domain/settings/settings";
import { migrateVersion1Record, openNoteStore } from "./note-store";
import { mustGet } from "./test-utils";

let databaseCount = 0;
function uniqueName() {
  databaseCount += 1;
  return `note-store-test-${String(databaseCount)}`;
}

const monday = new Date("2026-09-28T10:00:00.000Z");
const tuesday = new Date("2026-09-29T10:00:00.000Z");

describe("NoteStore", () => {
  it("erases the whole database for a factory reset", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    await store.put(createNote("# First #tag", monday, "n1"));
    await store.saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" });

    await store.erase();

    const fresh = await openNoteStore(name);
    expect(await fresh.list()).toEqual([]);
    expect(await fresh.tags()).toEqual([]);
    expect(await fresh.loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("starts empty", async () => {
    const store = await openNoteStore(uniqueName());

    expect(await store.list()).toEqual([]);
    expect(await store.get("missing")).toBeUndefined();
  });

  it("creates, reads, updates and deletes a note", async () => {
    const store = await openNoteStore(uniqueName());
    const note = createNote("# First", monday, "n1");

    await store.put(note);
    expect(await store.get("n1")).toEqual(note);

    const edited = updateNote(note, "# First, edited", tuesday);
    await store.put(edited);
    expect(await store.get("n1")).toEqual(edited);
    expect(await store.list()).toEqual([edited]);

    await store.delete("n1");
    expect(await store.get("n1")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("lists every note", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(createNote("a", monday, "a"));
    await store.put(createNote("b", tuesday, "b"));

    expect((await store.list()).map((note) => note.id).sort()).toEqual(["a", "b"]);
  });

  it("stores only the id and the Markdown", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    await store.put({ ...createNote("x", monday, "n1"), extra: true } as never);

    const raw = await openDB(name);
    expect(Object.keys((await raw.get("notes", "n1")) as object)).toEqual(["id", "markdown"]);
    raw.close();
  });

  it("keeps notes across connections", async () => {
    const name = uniqueName();
    const note = createNote("persisted", monday, "n1");
    await (await openNoteStore(name)).put(note);

    const reopened = await openNoteStore(name);

    expect(await reopened.get("n1")).toEqual(note);
  });

  it("deleting a missing note is a no-op", async () => {
    const store = await openNoteStore(uniqueName());

    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("keeps corrupted records out of the library but reports them for recovery", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    await store.put(createNote("fine", monday, "ok"));
    const raw = await openDB(name);
    await raw.put("notes", { id: "bad", markdown: 42 }, "bad");
    raw.close();

    await expect(store.get("bad")).rejects.toThrow(InvalidNoteError);
    expect((await store.list()).map((note) => note.id)).toEqual(["ok"]);
    expect(await store.unreadableRecords()).toEqual([
      { key: "bad", value: { id: "bad", markdown: 42 }, reason: "Note bad has no Markdown text" },
    ]);

    await store.removeUnreadable(["bad", "ok"]);
    expect(await store.unreadableRecords()).toEqual([]);
    expect((await store.list()).map((note) => note.id)).toEqual(["ok"]);
  });
});

describe("upgrading from version 1", () => {
  async function createVersion1Database(name: string, records: Record<string, unknown>[]) {
    const db = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore("notes");
      },
    });
    for (const record of records) {
      await db.put("notes", record, record.id as string);
    }
    db.close();
  }

  it("moves record dates into each document's frontmatter", async () => {
    const name = uniqueName();
    await createVersion1Database(name, [
      {
        id: "n1",
        markdown: "# Java\n",
        createdAt: "2026-09-28T10:15:00.123Z",
        updatedAt: "2026-09-29T08:00:00.000Z",
      },
    ]);

    const store = await openNoteStore(name);

    expect(await store.list()).toEqual([
      {
        id: "n1",
        markdown:
          "---\ncreated: 2026-09-28T10:15:00Z\nupdated: 2026-09-29T08:00:00Z\n---\n\n# Java\n",
      },
    ]);
  });
});

describe("schema upgrades from another tab", () => {
  it("closes this connection so a newer version can open", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);

    const newer = await openDB(name, 99);

    expect(newer.version).toBe(99);
    newer.close();
    await expect(store.list()).rejects.toThrow();
  });
});

describe("migrateVersion1Record", () => {
  const dates = { createdAt: "2026-09-28T10:15:00.000Z", updatedAt: "2026-09-29T08:00:00.000Z" };

  it("keeps dates the document already has", () => {
    const markdown = "---\ncreated: 2020-01-01\n---\nBody";

    expect(migrateVersion1Record({ id: "n1", markdown, ...dates })?.markdown).toBe(
      "---\ncreated: 2020-01-01\nupdated: 2026-09-29T08:00:00Z\n---\nBody",
    );
  });

  it("keeps the text of a document with invalid frontmatter", () => {
    const markdown = "---\ntitle: [\n---\nBody";

    expect(migrateVersion1Record({ id: "n1", markdown, ...dates })).toEqual({ id: "n1", markdown });
  });

  it("ignores invalid record dates", () => {
    expect(migrateVersion1Record({ id: "n1", markdown: "Body", createdAt: 5 })).toEqual({
      id: "n1",
      markdown: "Body",
    });
  });

  it("leaves records that are not notes alone", () => {
    expect(migrateVersion1Record(null)).toBeUndefined();
    expect(migrateVersion1Record({ id: 1, markdown: "x" })).toBeUndefined();
  });
});

describe("NoteStore search", () => {
  it("stays in step with saves and deletes after the index is built", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(createNote("# Alpha", monday, "a"));
    expect((await store.search(parseQuery("alpha"))).map((hit) => hit.id)).toEqual(["a"]);

    await store.put(createNote("# Beta", monday, "b"));
    await store.put(updateNote(createNote("# Alpha", monday, "a"), "# Gamma", tuesday));
    await store.delete("b");

    expect(await store.search(parseQuery("alpha"))).toEqual([]);
    expect(await store.search(parseQuery("beta"))).toEqual([]);
    expect((await store.search(parseQuery("gamma"))).map((hit) => hit.id)).toEqual(["a"]);
  });
});

describe("NoteStore reading positions", () => {
  it("stores positions per note and deletes them with the note", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(createNote("a", monday, "a"));
    await store.saveReadingPosition("a", 0.25, monday);
    await store.saveReadingPosition("b", 0.75, monday);

    expect(await store.readingState("a")).toEqual({
      noteId: "a",
      position: 0.25,
      updatedAt: monday.toISOString(),
    });
    expect(await store.readingState("missing")).toBeNull();

    await store.delete("a");
    expect(await store.readingState("a")).toBeNull();
    expect((await store.readingState("b"))?.position).toBe(0.75);
  });

  it("ignores a corrupted position", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    const raw = await openDB(name);
    await raw.put("reading", { noteId: "a", position: "half" }, "a");
    raw.close();

    expect(await store.readingState("a")).toBeNull();
  });

  it("rejects an out-of-range position", async () => {
    const store = await openNoteStore(uniqueName());

    await expect(store.saveReadingPosition("a", 1.5)).rejects.toThrow();
  });
});

describe("NoteStore settings", () => {
  it("saves settings and loads defaults when none are stored", async () => {
    const store = await openNoteStore(uniqueName());
    expect(await store.loadSettings()).toEqual(DEFAULT_SETTINGS);

    const settings = { ...DEFAULT_SETTINGS, theme: "dark", fontScale: 1.15 } as const;
    await store.saveSettings(settings);
    expect(await store.loadSettings()).toEqual(settings);
  });
});

describe("NoteStore sync bookkeeping", () => {
  const remote = (markdown: string, revision: number, deleted = false) => ({
    id: "n1",
    markdown,
    revision,
    deleted,
  });

  it("queues local writes and deletions", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(createNote("a", monday, "n1"));
    expect(await store.syncEntry("n1")).toEqual({
      noteId: "n1",
      baseRevision: null,
      dirty: true,
      deleted: false,
      blocked: null,
    });

    await store.markPushed("n1", { revision: 1, markdown: (await mustGet(store, "n1")).markdown });
    expect(await store.pendingSync()).toEqual([]);

    await store.delete("n1");
    expect(await store.syncEntry("n1")).toMatchObject({
      baseRevision: 1,
      dirty: true,
      deleted: true,
    });
  });

  it("applies server changes to notes without local changes", async () => {
    const store = await openNoteStore(uniqueName());
    const changes: string[] = [];
    store.onChange((change) => changes.push(`${change.source}:${change.noteId}`));

    expect(await store.applyRemote(remote("# From server", 3))).toBe("applied");
    expect((await store.get("n1"))?.markdown).toBe("# From server");
    expect(await store.syncEntry("n1")).toMatchObject({ baseRevision: 3, dirty: false });
    expect(await store.applyRemote(remote("# From server", 3))).toBe("unchanged");

    expect(await store.applyRemote(remote("", 4, true))).toBe("applied");
    expect(await store.get("n1")).toBeUndefined();
    expect(changes).toEqual(["remote:n1", "remote:n1"]);
  });

  it("never overwrites local changes: a newer server version is kept aside", async () => {
    const store = await openNoteStore(uniqueName());
    await store.applyRemote(remote("base", 1));
    const local = updateNote(await mustGet(store, "n1"), "local edit", monday);
    await store.put(local);

    expect(await store.applyRemote(remote("server edit", 2))).toBe("conflict");

    expect((await store.get("n1"))?.markdown).toBe(local.markdown);
    expect((await store.syncEntry("n1"))?.blocked).toEqual({
      reason: "conflict",
      remote: remote("server edit", 2),
    });
  });

  it("settles a note deleted on both sides", async () => {
    const store = await openNoteStore(uniqueName());
    await store.applyRemote(remote("base", 1));
    await store.delete("n1");

    expect(await store.applyRemote(remote("", 2, true))).toBe("applied");
    expect(await store.syncEntry("n1")).toBeNull();
  });

  it("resets sync for a new account", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(createNote("a", monday, "a"));
    await store.markPushed("a", { revision: 5, markdown: (await mustGet(store, "a")).markdown });
    await store.setSyncCursor(42);

    await store.resetSync();

    expect(await store.syncEntry("a")).toMatchObject({ baseRevision: null, dirty: true });
    expect(await store.syncCursor()).toBe(0);
  });
});
