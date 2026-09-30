import { importFolder } from "../../application/library/import-folder";
import { parseDocument } from "../../domain/document/document";
import { readNotes, updateNote } from "../../domain/note/note";
import { parseQuery } from "../../domain/search/query";
import { openNoteStore } from "../storage/note-store";
import { mustGet } from "../storage/test-utils";
import { FakeFolder } from "./fake-folder";
import { FolderStore } from "./folder-store";

let databaseCount = 0;
async function setup() {
  databaseCount += 1;
  const library = await openNoteStore(`folder-test-${String(databaseCount)}`);
  const folder = new FakeFolder();
  return { folder, library, store: new FolderStore(folder, library, { graceMs: 5 }) };
}

const now = new Date("2026-09-28T10:00:00Z");

describe("FolderStore", () => {
  it("discovers Markdown files as notes, identified by path", async () => {
    const { folder, store } = await setup();
    folder.edit("java.md", "# Java\n\n#java");
    folder.edit("db/postgres.md", "---\ntitle: Postgres\n---\nIndexes #db");

    expect((await store.list()).map((note) => note.id).sort()).toEqual([
      "db/postgres.md",
      "java.md",
    ]);
    expect((await store.get("java.md"))?.markdown).toBe("# Java\n\n#java");
    expect(await store.get("missing.md")).toBeUndefined();
  });

  it("orders files without an updated date by modification time", async () => {
    const { folder, store } = await setup();
    folder.edit("old.md", "old");
    folder.edit("new.md", "new");
    folder.edit("dated.md", "---\nupdated: 2000-01-01\n---\nancient");

    expect(readNotes(await store.list()).map((read) => read.note.id)).toEqual([
      "new.md",
      "old.md",
      "dated.md",
    ]);
  });

  it("creates files named after the title", async () => {
    const { folder, store } = await setup();

    const first = await store.create("# Hash maps\n\nBuckets.", now);
    const second = await store.create("# Hash maps\n\nAgain.", now);

    expect([first.id, second.id]).toEqual(["Hash maps.md", "Hash maps 2.md"]);
    expect(parseDocument(folder.files.get("Hash maps.md")?.text ?? "").body).toBe(
      "# Hash maps\n\nBuckets.",
    );
  });

  it("writes edits back to the file", async () => {
    const { folder, store } = await setup();
    folder.edit("note.md", "# Note");
    const note = await mustGet(store, "note.md");

    await store.put(updateNote(note, "# Note, edited", now));

    expect(folder.files.get("note.md")?.text).toContain("# Note, edited");
  });

  it("writes over a file another program changed: the last write wins", async () => {
    const { folder, store } = await setup();
    folder.edit("note.md", "# Mine");
    const note = await mustGet(store, "note.md");
    folder.edit("note.md", "# Changed in Vim");

    await store.put(updateNote(note, "# Overwrite", now));
    expect(folder.files.get("note.md")?.text).toContain("# Overwrite");
  });

  it("moves deleted notes to the trash", async () => {
    const { folder, store } = await setup();
    folder.edit("gone.md", "bye");

    await store.delete("gone.md");

    expect(folder.trashed).toEqual(["gone.md"]);
    expect(await store.list()).toEqual([]);
  });

  it("indexes tags and search from the files", async () => {
    const { folder, store } = await setup();
    folder.edit("a.md", "# Maps\n\nhashmap #java#collections");
    folder.edit("b.md", "# Go\n\nhashmap #go");

    expect((await store.tags()).map(({ tag: t, count }) => [t.name, count])).toEqual([
      ["collections", 1],
      ["go", 1],
      ["java", 1],
    ]);
    expect((await store.notesWithTag({ name: "java" })).map((n) => n.id)).toEqual(["a.md"]);
    expect((await store.search(parseQuery("hashmap #go"))).map((hit) => hit.id)).toEqual(["b.md"]);

    await store.create("# New\n\nhashmap #go", now);
    expect((await store.search(parseQuery("hashmap #go"))).map((hit) => hit.id).sort()).toEqual([
      "New.md",
      "b.md",
    ]);
  });

  it("keeps reading positions in the app database, not the files", async () => {
    const { folder, library, store } = await setup();
    folder.edit("note.md", "text");

    await store.saveReadingPosition("note.md", 0.4);

    expect((await store.readingState("note.md"))?.position).toBe(0.4);
    expect((await library.readingState("file:note.md"))?.position).toBe(0.4);
    expect(folder.files.get("note.md")?.text).toBe("text");
  });

  it("sees changes made outside the app after a refresh", async () => {
    const { folder, store } = await setup();
    folder.edit("note.md", "v1");
    await store.list();
    folder.edit("note.md", "v2");
    folder.edit("added.md", "new file");

    await store.refresh();

    expect((await store.get("note.md"))?.markdown).toBe("v2");
    expect(await store.get("added.md")).toBeDefined();
  });
});

describe("importFolder", () => {
  it("copies files into the library once, keeping their content", async () => {
    const { folder, library } = await setup();
    folder.edit("a.md", "# A\n\nalpha");
    folder.edit("b.md", "---\ntitle: B\ntags: [x]\n---\n\nbeta");
    folder.edit("broken.md", "---\ntitle: [\n---\nstill text");

    expect(await importFolder(folder, library, now)).toMatchObject({ imported: 3, duplicates: 0 });
    expect(await importFolder(folder, library, now)).toMatchObject({ imported: 0, duplicates: 3 });

    const bodies = (await library.list()).map((note) => note.markdown);
    expect(bodies.some((md) => md.includes("alpha"))).toBe(true);
    expect(bodies.some((md) => md.includes("tags: [x]") && md.includes("beta"))).toBe(true);
    expect(bodies.some((md) => md.includes("still text"))).toBe(true);
    expect(folder.files.get("a.md")?.text).toBe("# A\n\nalpha");
  });
});

describe("FolderStore following external changes", () => {
  async function watched() {
    const context = await setup();
    const changes: string[] = [];
    context.store.onChange((change) =>
      changes.push(
        change.previousId
          ? `${change.previousId}→${change.noteId}`
          : `${change.source}:${change.noteId}`,
      ),
    );
    await context.store.watch();
    return { ...context, changes };
  }

  /** Lets the store finish applying a watcher event. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

  it("updates a file edited in another program", async () => {
    const { folder, store, changes } = await watched();
    folder.edit("note.md", "# v1 #old");
    await store.list();

    folder.edit("note.md", "# v2 #new");
    folder.notify({ paths: ["note.md"], rescan: false });
    await settle();

    expect((await store.get("note.md"))?.markdown).toBe("# v2 #new");
    expect((await store.tags()).map(({ tag }) => tag.name)).toEqual(["new"]);
    expect(changes).toEqual(["remote:note.md"]);
  });

  it("adds new files and removes deleted ones", async () => {
    const { folder, store, changes } = await watched();
    folder.edit("keep.md", "keep");
    folder.edit("gone.md", "gone");
    await store.list();

    folder.edit("new.md", "fresh words");
    folder.files.delete("gone.md");
    folder.notify({ paths: ["new.md", "gone.md"], rescan: false });
    await settle();

    expect((await store.list()).map((note) => note.id).sort()).toEqual(["keep.md", "new.md"]);
    expect((await store.search(parseQuery("fresh"))).map((hit) => hit.id)).toEqual(["new.md"]);
    expect(changes.sort()).toEqual(["remote:gone.md", "remote:new.md"]);
  });

  it("recognizes a rename and moves the reading position", async () => {
    const { folder, store, changes } = await watched();
    folder.edit("draft.md", "# Same content");
    await store.list();
    await store.saveReadingPosition("draft.md", 0.6);

    folder.move("draft.md", "final/Published.md");
    folder.notify({ paths: ["draft.md", "final/Published.md"], rescan: false });
    await settle();
    await settle();

    expect(changes).toEqual(["draft.md→final/Published.md"]);
    expect((await store.readingState("final/Published.md"))?.position).toBe(0.6);
  });

  it("ignores its own writes coming back from the watcher", async () => {
    const { folder, store, changes } = await watched();
    folder.edit("note.md", "# v1");
    const note = await mustGet(store, "note.md");
    await store.put(updateNote(note, "# v2", now));
    changes.length = 0;

    folder.notify({ paths: ["note.md"], rescan: false });
    await settle();

    expect(changes).toEqual([]);
    // The recorded modification time follows the file, so the next save is not refused.
    await store.put(updateNote(await mustGet(store, "note.md"), "# v3", now));
    expect(folder.files.get("note.md")?.text).toContain("# v3");
  });

  it("reads everything again when asked to rescan", async () => {
    const { folder, store, changes } = await watched();
    folder.edit("a/one.md", "one");
    await store.list();

    folder.move("a/one.md", "b/one.md");
    folder.edit("b/two.md", "two");
    folder.notify({ paths: [], rescan: true });
    await settle();
    await settle();

    expect((await store.list()).map((note) => note.id).sort()).toEqual(["b/one.md", "b/two.md"]);
    expect(changes.sort()).toEqual(["a/one.md→b/one.md", "remote:b/two.md"]);
  });
});

describe("FolderStore robust reload", () => {
  it("waits for a file that vanishes briefly while another program saves it", async () => {
    const { folder, store } = await setup();
    const changes: string[] = [];
    store.onChange((change) => changes.push(change.noteId));
    folder.edit("note.md", "v1");
    await store.list();
    await store.watch();

    // Delete-and-recreate save: gone when the watcher fires, back a moment later.
    folder.files.delete("note.md");
    folder.notify({ paths: ["note.md"], rescan: false });
    folder.edit("note.md", "v2 from the editor");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect((await store.get("note.md"))?.markdown).toBe("v2 from the editor");
    expect(changes).toEqual(["note.md"]);
  });

  it("opens files in the external editor and reveals them", async () => {
    const { folder, store } = await setup();
    folder.edit("note.md", "x");

    await store.openExternally("note.md");
    await store.reveal("note.md");

    expect(folder.opened).toEqual(["note.md"]);
    expect(folder.revealed).toEqual(["note.md"]);
  });
});
