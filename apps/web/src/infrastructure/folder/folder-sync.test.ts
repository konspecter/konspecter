import { createNote, updateNote } from "../../domain/note/note";
import { openNoteStore, type NoteStore } from "../storage/note-store";
import { mustGet } from "../storage/test-utils";
import { FakeServer, TEST_PASSPHRASE } from "../sync/fake-server";
import { SyncEngine, type Scheduler } from "../sync/sync-engine";
import { FakeFolder } from "./fake-folder";
import { FolderStore } from "./folder-store";
import { FolderSync } from "./folder-sync";

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
  folder: FakeFolder;
  db: NoteStore;
  files: FolderStore;
  sync: FolderSync;
  engine: SyncEngine;
};

/** The desktop app: a folder, synced. Reopening the same database and folder is a restart. */
async function desktop(
  server: FakeServer,
  {
    folder = new FakeFolder(),
    db,
    path = HOME,
  }: { folder?: FakeFolder; db?: NoteStore; path?: string } = {},
): Promise<Desktop> {
  const database = db ?? (await openNoteStore(uniqueName()));
  const files = new FolderStore(folder, database, { graceMs: 5 });
  await files.watch();
  const sync = await FolderSync.open(files, database, path);
  return { folder, db: database, files, sync, engine: engineFor(sync, server) };
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

  it("starts over with another folder", async () => {
    const server = new FakeServer();
    const d = await desktop(server);
    d.folder.edit("java.md", "# Java");
    await d.files.refresh();
    await connected(d.engine);
    d.engine.stop();

    const other = new FakeFolder();
    const moved = await desktop(server, { folder: other, db: d.db, path: "/Users/ada/Notes" });
    await moved.engine.start();

    expect(liveNotes(server)).toHaveLength(1);
    expect([...other.files.values()].map((file) => file.text)).toEqual(["# Java"]);
    moved.engine.stop();
  });
});
