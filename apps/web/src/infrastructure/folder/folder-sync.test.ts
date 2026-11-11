import { createNote, updateNote } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../storage/note-store";
import { mustGet } from "../storage/test-utils";
import { FakeServer, TEST_PASSPHRASE } from "../sync/fake-server";
import { SyncEngine, type Scheduler } from "../sync/sync-engine";
import { FakeFolder } from "./fake-folder";
import { FolderLibrary } from "./folder-library";
import { FolderStore } from "./folder-store";
import { FolderSync, plainPath } from "./folder-sync";

const config = { serverUrl: "https://sync.example.com", token: "ksp_ada" };
const date = new Date("2026-09-28T10:00:00Z");
const minutesLater = (minutes: number) => new Date(date.getTime() + minutes * 60_000);
const HOME = "/Users/ada/Konspecter";

/** Timers wait for the test: cycles run when it says so. */
const scheduler: Scheduler = { set: () => null, clear: () => undefined };

let databaseCount = 0;
const uniqueName = () => `folder-sync-test-${String((databaseCount += 1))}`;

function engineFor(store: FolderSync | NoteStore, server: FakeServer) {
  return new SyncEngine(store, {
    fetch: server.fetch,
    scheduler,
    random: () => 0.5,
    isOnline: () => true,
    now: () => date,
    isVisible: () => true,
  });
}

type Desktop = {
  /** The first folder, and its store (ids are paths in it). */
  folder: FakeFolder;
  files: FolderStore;
  library: FolderLibrary;
  db: NoteStore;
  sync: FolderSync;
  engine: SyncEngine;
};

type Connected = {
  readonly id: string;
  readonly path: string;
  readonly folder: FakeFolder;
  /** False: on the list, but it cannot be opened (a disk not mounted). */
  readonly available?: boolean;
};

/**
 * The desktop app: its folders, synced. Reopening the same database and
 * folders is a restart; `more` connects further folders after the first.
 */
async function desktop(
  server: FakeServer,
  {
    folder = new FakeFolder(),
    db,
    id = "home",
    path = HOME,
    more = [],
  }: {
    folder?: FakeFolder;
    db?: NoteStore;
    id?: string;
    path?: string;
    more?: readonly Connected[];
  } = {},
): Promise<Desktop> {
  const database = db ?? (await openNoteStore(uniqueName()));
  const connected = [{ id, path, folder }, ...more].map((c: Connected) => {
    const available = c.available ?? true;
    return {
      folder: { id: c.id, path: c.path, alias: null, addedMs: 0, available },
      store: available
        ? new FolderStore(c.folder, database, { graceMs: 5, readingPrefix: `file:${c.id}/` })
        : null,
    };
  });
  const library = new FolderLibrary(connected, { setAlias: () => Promise.resolve() });
  await library.watch();
  const sync = await FolderSync.open(library, database);
  const files = connected[0]?.store;
  if (!files) throw new Error("no folder");
  return { folder, files, library, db: database, sync, engine: engineFor(sync, server) };
}

/** The web or mobile app: the app library. */
async function library(server: FakeServer) {
  const store = await openNoteStore(uniqueName());
  return { store, engine: engineFor(store, server) };
}

async function connected(engine: SyncEngine): Promise<void> {
  await engine.connect(config);
  await engine.unlock(TEST_PASSPHRASE);
}

/** What another program wrote, once the app has read it. */
async function editOutside(d: Desktop, path: string, text: string): Promise<void> {
  d.folder.edit(path, text);
  d.folder.notify({ paths: [path], rescan: false });
  await vi.waitFor(async () => {
    expect((await d.files.get(path))?.markdown).toBe(text);
  });
}

const liveNotes = (server: FakeServer) =>
  [...server.notes.values()].filter((note) => note.deletedAt === null);

describe("FolderSync", () => {
  it("uploads the folder's files and writes notes from elsewhere as files", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    const web = await library(server);
    await web.store.put(createNote("# Postgres", date, "n1"));
    await connected(web.engine);

    await d.files.refresh();
    await connected(d.engine);

    expect(
      liveNotes(server)
        .map((note) => note.markdown)
        .sort(),
    ).toEqual(["# Java", (await mustGet(web.store, "n1")).markdown]);
    expect(d.folder.files.get("postgres.md")?.text).toBe((await mustGet(web.store, "n1")).markdown);
    expect(d.engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
  });

  it("pushes edits made in the app and in other programs", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    const note = await d.files.create("# Java", date);
    await connected(d.engine);
    const [synced] = liveNotes(server);

    await d.files.put(updateNote(note, "# Java\n\nEdited in the app", minutesLater(1)));
    await d.engine.syncNow();
    expect(server.notes.get(synced?.id ?? "")?.markdown).toContain("Edited in the app");

    await editOutside(d, note.id, "# Java\n\nEdited in Vim");
    await d.engine.syncNow();
    expect(server.notes.get(synced?.id ?? "")?.markdown).toBe("# Java\n\nEdited in Vim");
    expect(liveNotes(server)).toHaveLength(1);
  });

  it("keeps a renamed file's note, renamed in the app, outside it or while closed", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    const [synced] = liveNotes(server);

    d.folder.move("java.md", "jvm.md");
    d.folder.notify({ paths: ["java.md", "jvm.md"], rescan: false });
    await vi.waitFor(async () => {
      expect(await d.files.get("jvm.md")).toBeDefined();
    });
    await d.engine.syncNow();

    d.folder.move("jvm.md", "kotlin.md");
    const restarted = await desktop(server, { folder: d.folder, db: d.db });
    await restarted.engine.start();

    expect(liveNotes(server)).toEqual([expect.objectContaining({ id: synced?.id, revision: 1 })]);
    expect(await restarted.sync.get(synced?.id ?? "")).toMatchObject({ markdown: "# Java" });
  });

  it("keeps an untitled file's note when the file takes its title's name", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    const note = await d.files.create("- ", date);
    expect(note.id).toBe("untitled.md");
    await connected(d.engine);
    const [synced] = liveNotes(server);

    // Titled in the app: renamed at once.
    await d.files.put(updateNote(note, "# Java", minutesLater(1)));
    await d.engine.syncNow();
    // Titled in another program: renamed when the folder next opens.
    d.folder.move("java.md", "untitled.md");
    d.folder.notify({ paths: ["java.md", "untitled.md"], rescan: false });
    await vi.waitFor(async () => {
      expect(await d.files.get("untitled.md")).toBeDefined();
    });
    await d.engine.syncNow();
    const restarted = await desktop(server, { folder: d.folder, db: d.db });
    await restarted.engine.start();

    expect([...d.folder.files.keys()]).toEqual(["java.md"]);
    expect(liveNotes(server)).toEqual([expect.objectContaining({ id: synced?.id })]);
    expect(await restarted.sync.get(synced?.id ?? "")).toMatchObject({
      markdown: expect.stringContaining("# Java") as unknown,
    });
  });

  it("deletes a trashed file's note, and trashes a file deleted elsewhere", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    const web = await library(server);
    await web.store.put(createNote("# Kept", date, "kept"));
    await web.store.put(createNote("# Gone", date, "gone"));
    await connected(web.engine);
    await connected(d.engine);
    expect(d.folder.files.has("gone.md")).toBe(true);

    await web.store.delete("gone");
    await web.engine.syncNow();
    await d.engine.syncNow();
    expect(d.folder.trashed).toEqual(["gone.md"]);

    await d.files.delete("kept.md");
    await d.engine.syncNow();
    await web.engine.syncNow();
    expect(liveNotes(server)).toEqual([]);
    expect(await web.store.list()).toEqual([]);
  });

  it("lets the later edit win against another device", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    const web = await library(server);
    await web.store.put(createNote("# Shared", date, "n1"));
    await connected(web.engine);
    await connected(d.engine);
    const path = "shared.md";

    await d.files.put(
      updateNote(await mustGet(d.files, path), "# Shared\n\nDesktop", minutesLater(1)),
    );
    await web.store.put(
      updateNote(await mustGet(web.store, "n1"), "# Shared\n\nWeb", minutesLater(2)),
    );
    await d.engine.syncNow();
    await web.engine.syncNow();
    await d.engine.syncNow();

    expect(d.folder.files.get(path)?.text).toContain("Web");
    expect(server.notes.get("n1")?.markdown).toContain("Web");
    expect(d.engine.getStatus()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it("moves the app library into the folder, with its ids, uploading nothing again", async () => {
    const server = new FakeServer();
    const db = await openNoteStore(uniqueName());
    await db.put(createNote("# Synced", date, "synced"));
    const before = engineFor(db, server);
    await connected(before);
    before.stop();
    await db.put(createNote("# Written offline", date, "offline"));
    await db.saveReadingPosition("synced", 0.4);
    const requests = server.requests.length;

    const d = await desktop(server, { db });
    expect(await d.sync.moveLibrary()).toBe(2);
    await d.engine.start();

    expect(await db.list()).toEqual([]);
    expect([...d.folder.files.keys()].sort()).toEqual(["synced.md", "written-offline.md"]);
    expect(server.requests.slice(requests).filter((request) => request.startsWith("P"))).toEqual([
      "POST /api/notes", // Only the note that was not on the server yet.
    ]);
    expect(
      liveNotes(server)
        .map((note) => note.id)
        .sort(),
    ).toEqual(["offline", "synced"]);
    expect(await d.files.readingState("synced.md")).toMatchObject({ position: 0.4 });
    d.engine.stop();
  });

  it("adopts a copy of the folder without making a second copy of anything", async () => {
    const server = new FakeServer();
    const first = await desktop(server);
    first.folder.edit("java.md", "# Java");
    first.folder.edit("db/postgres.md", "# Postgres #db");
    await first.files.refresh();
    await connected(first.engine);
    const synced = liveNotes(server)
      .map((note) => note.id)
      .sort();

    const copy = new FakeFolder();
    for (const [path, file] of first.folder.files) copy.edit(path, file.text);
    copy.edit("new.md", "# Only here");
    const second = await desktop(server, { folder: copy, path: "/Volumes/Backup/Konspecter" });
    await connected(second.engine);

    expect(liveNotes(server)).toHaveLength(3);
    expect(liveNotes(server).map((note) => note.id)).toEqual(expect.arrayContaining(synced));
    expect([...copy.files.keys()].sort()).toEqual(["db/postgres.md", "java.md", "new.md"]);
  });

  it("deletes nothing when the folder has none of its files, and fills it again", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    d.folder.edit("go.md", "# Go");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();

    d.folder.files.clear();
    const restarted = await desktop(server, { folder: d.folder, db: d.db });
    await restarted.engine.start();

    expect(liveNotes(server)).toHaveLength(2);
    expect([...d.folder.files.keys()].sort()).toEqual(["go.md", "java.md"]);
    restarted.engine.stop();
  });

  it("deletes for good every file sync covers when wiped, and nothing else", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    d.folder.edit("tags/go.md", "# Go");
    d.folder.ignoreFile = "drafts/\n";
    d.folder.edit("drafts/secret.md", "# Not synced");
    await d.files.refresh();
    await connected(d.engine);

    expect(await d.sync.wipeFiles()).toBe(2);

    expect([...d.folder.erased].sort()).toEqual(["java.md", "tags/go.md"]);
    expect(d.folder.trashed).toEqual([]);
    expect([...d.folder.files.keys()]).toEqual(["drafts/secret.md"]);
    expect(await d.sync.syncEntries()).toEqual([]);
    expect(await d.db.folderLinks()).toEqual([]);
  });

  it("moves the links of one folder to its id, uploading nothing again", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    await d.files.saveReadingPosition("java.md", 0.3);
    d.engine.stop();
    // What a version with one folder kept: paths without an id, and the folder's path.
    const links = (await d.db.folderLinks()) as { noteId: string; path: string }[];
    await d.db.saveFolderLinks(links.map((link) => ({ ...link, path: link.path.slice(5) })));
    await d.db.saveMeta("folderSync", { folder: HOME, adopting: false });
    await d.db.renameReadingKeys("file:home/", "file:");
    const requests = server.requests.length;

    const upgraded = await desktop(server, { folder: d.folder, db: d.db });
    await upgraded.engine.start();

    expect(upgraded.sync.upgradedTo).toBe("home");
    expect(await d.db.folderLinks()).toEqual([expect.objectContaining({ path: "home/java.md" })]);
    expect(await d.db.loadMeta("folderSync")).toEqual({ folders: ["home"], adopting: false });
    expect(await upgraded.files.readingState("java.md")).toMatchObject({ position: 0.3 });
    expect(server.requests.slice(requests).filter((r) => r.startsWith("P"))).toEqual([]);
    expect(liveNotes(server)).toHaveLength(1);
    upgraded.engine.stop();
  });

  it("finishes an upgrade cut short without doing it twice", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    await d.files.saveReadingPosition("java.md", 0.3);
    d.engine.stop();
    // Links and positions moved already, the state not yet: the start stopped there.
    await d.db.saveMeta("folderSync", { folder: HOME, adopting: false });
    const requests = server.requests.length;

    const again = await desktop(server, { folder: d.folder, db: d.db });
    await again.engine.start();

    expect(await d.db.folderLinks()).toEqual([expect.objectContaining({ path: "home/java.md" })]);
    expect(await again.files.readingState("java.md")).toMatchObject({ position: 0.3 });
    expect(server.requests.slice(requests).filter((r) => r.startsWith("P"))).toEqual([]);
    expect(liveNotes(server)).toHaveLength(1);
    again.engine.stop();
  });

  it("keeps the one folder of an earlier version that cannot be opened now", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();
    const links = (await d.db.folderLinks()) as { noteId: string; path: string }[];
    await d.db.saveFolderLinks(links.map((link) => ({ ...link, path: link.path.slice(5) })));
    await d.db.saveMeta("folderSync", { folder: HOME, adopting: false });
    const requests = server.requests.length;

    // The disk is not mounted: the old folder is listed, not found, after another one.
    const other = new FakeFolder();
    const unmounted = await desktop(server, {
      folder: other,
      db: d.db,
      id: "notes",
      path: "/Users/ada/Notes",
      more: [{ id: "home", path: HOME, folder: d.folder, available: false }],
    });
    await unmounted.engine.start();

    expect(unmounted.sync.upgradedTo).toBe("home");
    expect(await d.db.folderLinks()).toEqual([expect.objectContaining({ path: "home/java.md" })]);
    expect(other.files.size).toBe(0);
    expect(server.requests.slice(requests).filter((r) => r.startsWith("P"))).toEqual([]);
    unmounted.engine.stop();

    // Mounted again, it syncs as before: nothing is uploaded twice.
    const mounted = await desktop(server, { folder: d.folder, db: d.db });
    await mounted.engine.start();
    expect(liveNotes(server)).toHaveLength(1);
    expect([...d.folder.files.keys()]).toEqual(["java.md"]);
    mounted.engine.stop();
  });

  it("deletes nothing of a folder whose files cannot be read at the start", async () => {
    const server = new FakeServer();
    const work = new FakeFolder();
    work.edit("go.md", "# Go");
    const workFolder = { id: "work", path: "/Users/ada/Work", folder: work };
    const d = await desktop(server, { more: [workFolder] });
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();

    const failing = vi.spyOn(work, "list").mockRejectedValue(new Error("share gone"));
    const restarted = await desktop(server, { folder: d.folder, db: d.db, more: [workFolder] });
    await restarted.engine.start();

    expect(liveNotes(server)).toHaveLength(2);
    expect(work.files.has("go.md")).toBe(true);
    expect(await d.db.folderLinks()).toContainEqual(
      expect.objectContaining({ path: "work/go.md" }),
    );
    restarted.engine.stop();
    failing.mockRestore();
  });

  it("starts over when the one folder of an earlier version is not connected", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();
    const links = (await d.db.folderLinks()) as { noteId: string; path: string }[];
    await d.db.saveFolderLinks(links.map((link) => ({ ...link, path: link.path.slice(5) })));
    await d.db.saveMeta("folderSync", { folder: "/Users/ada/Elsewhere", adopting: false });

    const other = new FakeFolder();
    const moved = await desktop(server, { folder: other, db: d.db, id: "notes" });
    await moved.engine.start();

    expect(moved.sync.upgradedTo).toBeNull();
    expect(liveNotes(server)).toHaveLength(1);
    expect([...other.files.values()].map((file) => file.text)).toEqual(["# Java"]);
    moved.engine.stop();
  });

  it("syncs a folder connected next to another, duplicating nothing", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();
    const requests = server.requests.length;

    const work = new FakeFolder();
    work.edit("go.md", "# Go");
    work.edit("java-copy.md", "# Java"); // The same text as a synced note: a new note all the same.
    const both = await desktop(server, {
      folder: d.folder,
      db: d.db,
      more: [{ id: "work", path: "/Users/ada/Work", folder: work }],
    });
    await both.engine.start();

    expect(
      liveNotes(server)
        .map((note) => note.markdown)
        .sort(),
    ).toEqual(["# Go", "# Java", "# Java"]);
    expect(server.requests.slice(requests).filter((r) => r.startsWith("P"))).toHaveLength(2);
    expect([...d.folder.files.keys()]).toEqual(["java.md"]);
    expect(await d.db.loadMeta("folderSync")).toEqual({
      folders: ["home", "work"],
      adopting: false,
    });
    both.engine.stop();
  });

  it("writes notes new to this device in the first folder", async () => {
    const server = new FakeServer();
    const work = new FakeFolder();
    const d = await desktop(server, {
      more: [{ id: "work", path: "/Users/ada/Work", folder: work }],
    });
    const web = await library(server);
    await web.store.put(createNote("# Postgres", date, "n1"));
    await connected(web.engine);

    await connected(d.engine);

    expect([...d.folder.files.keys()]).toEqual(["postgres.md"]);
    expect(work.files.size).toBe(0);
  });

  it("leaves a disconnected folder's notes as they are, here and on the server", async () => {
    const server = new FakeServer();
    const work = new FakeFolder();
    work.edit("go.md", "# Go");
    const workFolder = { id: "work", path: "/Users/ada/Work", folder: work };
    const d = await desktop(server, { more: [workFolder] });
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();
    const go = liveNotes(server).find((note) => note.markdown === "# Go");

    // Work is disconnected; meanwhile its note is edited on another device.
    const alone = await desktop(server, { folder: d.folder, db: d.db });
    await alone.engine.start();
    const web = await library(server);
    await connected(web.engine);
    const pulled = await mustGet(web.store, go?.id ?? "");
    await web.store.put(updateNote(pulled, "# Go\n\nEdited elsewhere", minutesLater(1)));
    await web.engine.syncNow();
    await alone.engine.syncNow();

    expect(liveNotes(server)).toHaveLength(2);
    expect([...d.folder.files.keys()]).toEqual(["java.md"]);
    expect(work.files.get("go.md")?.text).toBe("# Go");
    expect(work.trashed).toEqual([]);
    alone.engine.stop();

    // Connected again, the folder takes the edit in and uploads nothing new.
    const again = await desktop(server, { folder: d.folder, db: d.db, more: [workFolder] });
    await again.engine.start();

    expect(liveNotes(server)).toHaveLength(2);
    expect(work.files.get("go.md")?.text).toContain("Edited elsewhere");
    expect([...d.folder.files.keys()]).toEqual(["java.md"]);
    again.engine.stop();
  });

  it("wipes the connected folders only", async () => {
    const server = new FakeServer();
    const work = new FakeFolder();
    work.edit("go.md", "# Go");
    const d = await desktop(server, {
      more: [{ id: "work", path: "/Users/ada/Work", folder: work }],
    });
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();

    const alone = await desktop(server, { folder: d.folder, db: d.db });
    expect(await alone.sync.wipeFiles()).toBe(1);

    expect(d.folder.erased).toEqual(["java.md"]);
    expect(work.files.has("go.md")).toBe(true);
  });
});

describe("plainPath", () => {
  it("drops the Windows verbatim prefix", () => {
    expect(plainPath("\\\\?\\C:\\Users\\ada\\Konspecter")).toBe("C:\\Users\\ada\\Konspecter");
    expect(plainPath("\\\\?\\UNC\\server\\share\\Notes")).toBe("\\\\server\\share\\Notes");
    expect(plainPath("C:\\Users\\ada\\Konspecter")).toBe("C:\\Users\\ada\\Konspecter");
    expect(plainPath(HOME)).toBe(HOME);
  });
});
