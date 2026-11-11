import { parseQuery } from "../../domain/search/query";
import { openNoteStore } from "../storage/note-store";
import { FakeFolder } from "./fake-folder";
import { FolderLibrary } from "./folder-library";
import { FolderStore } from "./folder-store";

const date = new Date("2026-11-11T10:00:00Z");
let count = 0;

async function twoFolders({ available = true } = {}) {
  const db = await openNoteStore(`folder-library-test-${String((count += 1))}`);
  const home = new FakeFolder();
  const work = new FakeFolder();
  home.edit("java.md", "# Java #lang");
  work.edit("go.md", "# Go #lang");
  work.edit("ops/deploy.md", "# Deploy");
  const aliases: [string, string | null][] = [];
  const store = (folder: FakeFolder, id: string) =>
    new FolderStore(folder, db, { graceMs: 5, readingPrefix: `file:${id}/` });
  const library = new FolderLibrary(
    [
      {
        folder: {
          id: "a",
          path: "/Users/ada/Konspecter",
          alias: null,
          addedMs: 1,
          available: true,
        },
        store: store(home, "a"),
      },
      {
        folder: { id: "b", path: "/Users/ada/Work", alias: null, addedMs: 2, available },
        store: available ? store(work, "b") : null,
      },
    ],
    {
      setAlias(folder, alias) {
        aliases.push([folder, alias]);
        return Promise.resolve();
      },
    },
  );
  return { db, home, work, library, aliases };
}

describe("FolderLibrary", () => {
  it("lists every folder's notes under ids that start with the folder's", async () => {
    const { library } = await twoFolders();

    expect((await library.list()).map((note) => note.id).sort()).toEqual([
      "a/java.md",
      "b/go.md",
      "b/ops/deploy.md",
    ]);
    expect(await library.get("b/go.md")).toMatchObject({ id: "b/go.md" });
    expect(await library.get("a/go.md")).toBeUndefined();
    expect(await library.get("c/go.md")).toBeUndefined();
    expect(library.folderOf("b/ops/deploy.md")).toBe("b");
  });

  it("writes, renames and deletes in the note's own folder", async () => {
    const { library, work } = await twoFolders();
    const changes: unknown[] = [];
    library.onChange((change) => changes.push(change));
    const go = await library.get("b/go.md");
    if (!go) throw new Error("missing");

    const saved = await library.put({ ...go, markdown: "# Go #ops" });
    expect(saved.id).toBe("b/ops/go.md");
    expect(work.files.has("ops/go.md")).toBe(true);
    expect(changes).toContainEqual({
      noteId: "b/ops/go.md",
      source: "local",
      previousId: "b/go.md",
    });

    await library.delete("b/ops/go.md");
    expect(work.trashed).toEqual(["ops/go.md"]);
  });

  it("makes a new note in the folder asked for, else in the first", async () => {
    const { library, home, work } = await twoFolders();

    expect((await library.create("# Rust", date, { folder: "b" })).id).toBe("b/rust.md");
    expect((await library.create("# Kotlin", date)).id).toBe("a/kotlin.md");
    expect((await library.create("# Zig", date, { folder: "gone" })).id).toBe("a/zig.md");
    expect((await library.receive(null, "# Synced")).id).toBe("a/synced.md");
    expect(work.files.has("rust.md")).toBe(true);
    expect(home.files.has("kotlin.md")).toBe(true);
  });

  it("refuses a new note when no folder is open", async () => {
    const library = new FolderLibrary([], { setAlias: () => Promise.resolve() });

    await expect(library.create("# Lost", date)).rejects.toMatchObject({ code: "no_folder" });
    expect(await library.list()).toEqual([]);
  });

  it("counts tags across folders, and for each folder", async () => {
    const { library } = await twoFolders();

    expect(await library.tags()).toEqual([
      expect.objectContaining({ tag: { name: "lang" }, count: 2 }),
      expect.objectContaining({ tag: { name: "ops" }, count: 1 }), // Its folder (ADR-013).
    ]);
    expect(await library.folderTags("a")).toEqual([
      expect.objectContaining({ tag: { name: "lang" }, count: 1 }),
    ]);
    const work = await library.folderTags("b");
    expect(work.map((count) => count.tag.name)).toEqual(["lang", "ops"]);
    expect(work[0]?.chains).toEqual([{ noteId: "b/go.md", tags: ["lang"] }]);
    expect((await library.notesWithTag({ name: "lang" })).map((n) => n.id).sort()).toEqual([
      "a/java.md",
      "b/go.md",
    ]);
  });

  it("searches every folder and follows changes made outside the app", async () => {
    const { library, work } = await twoFolders();
    await library.watch();
    expect((await library.search(parseQuery("lang"))).map((hit) => hit.id).sort()).toEqual([
      "a/java.md",
      "b/go.md",
    ]);

    work.edit("rust.md", "# Rust #lang");
    work.notify({ paths: ["rust.md"], rescan: false });

    await vi.waitFor(async () => {
      expect((await library.search(parseQuery("rust"))).map((hit) => hit.id)).toEqual([
        "b/rust.md",
      ]);
    });
  });

  it("keeps reading positions per folder", async () => {
    const { library, db } = await twoFolders();

    await library.saveReadingPosition("b/go.md", 0.5);

    expect(await library.readingState("b/go.md")).toMatchObject({ position: 0.5 });
    expect(await db.readingState("file:b/go.md")).toMatchObject({ position: 0.5 });
    expect(await library.readingState("a/go.md")).toBeNull();
  });

  it("names files after their folder when there are several", async () => {
    const { library, aliases } = await twoFolders();
    let told = 0;
    library.subscribeFolders(() => (told += 1));

    expect(library.fileOf("b/ops/deploy.md")).toBe("Work/ops/deploy.md");
    await library.setAlias("b", "  Job  ");

    expect(aliases).toEqual([["b", "Job"]]);
    expect(told).toBe(1);
    expect(library.folders()[1]?.alias).toBe("Job");
    expect(library.fileOf("b/ops/deploy.md")).toBe("Job/ops/deploy.md");
  });

  it("lists a folder that cannot be opened, without notes", async () => {
    const { library } = await twoFolders({ available: false });

    expect(library.folders().map((folder) => folder.available)).toEqual([true, false]);
    expect(library.openFolders()).toEqual(["a"]);
    expect((await library.list()).map((note) => note.id)).toEqual(["a/java.md"]);
    expect(await library.folderTags("b")).toEqual([]);
  });

  it("works on when one folder's files cannot be read, and takes it back after", async () => {
    const { library, work } = await twoFolders();
    let told = 0;
    library.subscribeFolders(() => (told += 1));
    const failing = vi.spyOn(work, "list").mockRejectedValue(new Error("share gone"));

    expect((await library.list()).map((note) => note.id)).toEqual(["a/java.md"]);
    expect(await library.tags()).toEqual([
      expect.objectContaining({ tag: { name: "lang" }, count: 1 }),
    ]);
    expect(library.folders().map((folder) => folder.available)).toEqual([true, false]);
    expect(library.openFolders()).toEqual(["a"]);
    expect((await library.create("# New", date)).id).toBe("a/new.md");
    expect(told).toBe(1);

    failing.mockRestore();
    expect((await library.list()).map((note) => note.id)).toContain("b/go.md");
    expect(library.folders().map((folder) => folder.available)).toEqual([true, true]);
    expect(told).toBe(2);
  });

  it("keeps a change made while the search index is being built", async () => {
    const { library, work } = await twoFolders();
    await library.watch();

    const first = library.search(parseQuery("lang"));
    work.edit("go.md", "# Go #lang\n\nGoroutines");
    work.notify({ paths: ["go.md"], rescan: false });
    await first;

    await vi.waitFor(async () => {
      expect((await library.search(parseQuery("goroutines"))).map((hit) => hit.id)).toEqual([
        "b/go.md",
      ]);
    });
  });
});
