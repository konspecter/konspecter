import { createNote } from "../../domain/note/note";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import {
  NoteCatalog,
  notesInFolder,
  recentNotes,
  summarize,
  untaggedNotes,
  type NoteSummary,
} from "./note-catalog";

let count = 0;
const newStore = () => openNoteStore(`catalog-test-${String((count += 1))}`);

async function ready(
  catalog: NoteCatalog,
  check: (notes: readonly NoteSummary[]) => boolean = () => true,
) {
  await vi.waitFor(() => {
    const state = catalog.getSnapshot();
    if (state.status !== "ready" || !check(state.notes)) throw new Error("not yet");
  });
  const state = catalog.getSnapshot();
  if (state.status !== "ready") throw new Error("not ready");
  return state.notes;
}

describe("summarize", () => {
  it("keeps the title, date, cover, tags, pin and the start of the readable text", () => {
    const note = createNote(
      "---\ncover: https://example.com/maps.png\ntags: [Java#Collections]\npin: 5\n---\n# Hash maps\n\nBuckets #java #algorithms.",
      new Date("2024-01-02"),
    );

    expect(summarize(note)).toEqual({
      id: note.id,
      title: "Hash maps",
      updated: "2024-01-02T00:00:00Z",
      cover: "https://example.com/maps.png",
      tags: ["Java", "Collections", "algorithms"],
      excerpt: "Buckets #java #algorithms.",
      pin: "5",
      valid: true,
    });
  });

  it("summarizes a note with invalid frontmatter from its raw text", () => {
    expect(summarize({ id: "x", markdown: "---\ntitle: [\n---\nText" })).toMatchObject({
      title: "",
      valid: false,
      updated: null,
      cover: null,
      tags: [],
      pin: null,
    });
  });
});

describe("recentNotes", () => {
  it("keeps the notes created or edited in the last 7 days, in their order", () => {
    const note = (id: string, updated: string | null) =>
      ({ id, updated }) as unknown as NoteSummary;
    const now = new Date("2026-10-15T12:00:00Z");
    expect(
      recentNotes(
        [
          note("today", "2026-10-15T09:00:00Z"),
          note("week", "2026-10-08T12:00:00Z"),
          note("older", "2026-10-08T11:59:59Z"),
          note("undated", null),
        ],
        now,
      ).map(({ id }) => id),
    ).toEqual(["today", "week"]);
  });
});

describe("untaggedNotes", () => {
  it("keeps the notes without a tag, by title, untitled last", () => {
    const note = (id: string, title: string, tags: string[] = []) =>
      ({ id, title, tags }) as unknown as NoteSummary;
    expect(
      untaggedNotes([
        note("1", "b"),
        note("2", "Tagged", ["java"]),
        note("3", ""),
        note("4", "A"),
        note("5", "item 10"),
        note("6", "item 9"),
      ]).map(({ id }) => id),
    ).toEqual(["4", "1", "6", "5", "3"]);
  });
});

describe("notesInFolder", () => {
  it("lists the notes with the ids, by title, skipping ids without a note", async () => {
    const store = await newStore();
    const now = new Date("2024-01-01");
    await store.put(createNote("# streams\n\n#java", now, "a"));
    await store.put(createNote("# Arrays\n\n#java", now, "c"));
    await store.put(createNote("#\n\n#java", now, "d"));
    await store.put(createNote("# Other\n\n#go", now, "e"));

    const notes = await notesInFolder(store, ["d", "a", "gone", "c"]);
    expect(notes.map((note) => note.id)).toEqual(["c", "a", "d"]);
  });
});

describe("NoteCatalog", () => {
  it("lists notes most recently edited first", async () => {
    const store = await newStore();
    await store.put(createNote("# Old", new Date("2020-01-01"), "old"));
    await store.put(createNote("# New", new Date("2024-01-01"), "new"));
    const catalog = new NoteCatalog(store);
    const stop = catalog.start();

    expect((await ready(catalog)).map((note) => note.id)).toEqual(["new", "old"]);
    stop();
  });

  it("follows edits one note at a time and reorders at once", async () => {
    const store = await newStore();
    await store.put(createNote("# A", new Date("2020-01-01"), "a"));
    await store.put(createNote("# B", new Date("2021-01-01"), "b"));
    const catalog = new NoteCatalog(store);
    const stop = catalog.start();
    await ready(catalog);
    const list = vi.spyOn(store, "list");

    await store.put(createNote("# A edited", new Date("2022-01-01"), "a"));
    const notes = await ready(catalog, (notes) => notes[0]?.id === "a");

    expect(notes.map((note) => note.title)).toEqual(["A edited", "B"]);
    await store.delete("b");
    expect((await ready(catalog, (notes) => notes.length === 1))[0]?.id).toBe("a");
    expect(list).not.toHaveBeenCalled();
    stop();
  });

  it("publishes a burst of changes a few times, not once per note", async () => {
    const store = await newStore();
    const catalog = new NoteCatalog(store);
    const stop = catalog.start();
    await ready(catalog);
    const listener = vi.fn();
    catalog.subscribe(listener);

    // The publish interval runs on the clock, not on how fast this machine
    // writes: the burst takes no time, and waiting moves the clock on.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      for (let i = 0; i < 50; i += 1) await store.put(createNote(`# N${String(i)}`, new Date()));
      await ready(catalog, (notes) => notes.length === 50);
    } finally {
      vi.useRealTimers();
    }

    expect(listener.mock.calls.length).toBeLessThan(10);
    stop();
  });

  it("reports a failed load and recovers on reload", async () => {
    const store = await newStore();
    await store.put(createNote("# A", new Date("2020-01-01"), "a"));
    vi.spyOn(store, "list").mockRejectedValueOnce(new Error("Disk on fire"));
    const catalog = new NoteCatalog(store);
    const stop = catalog.start();

    await vi.waitFor(() => {
      expect(catalog.getSnapshot().status).toBe("error");
    });
    await catalog.reload();
    expect((await ready(catalog)).map((note) => note.id)).toEqual(["a"]);
    stop();
  });

  it("notifies subscribers and stops following changes", async () => {
    const store = await newStore();
    const catalog = new NoteCatalog(store);
    const stop = catalog.start();
    await ready(catalog);
    const listener = vi.fn();
    catalog.subscribe(listener);

    await store.put(createNote("# A", new Date(), "a"));
    await ready(catalog, (notes) => notes.length === 1);
    expect(listener).toHaveBeenCalled();

    stop();
    listener.mockClear();
    await store.put(createNote("# B", new Date(), "b"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listener).not.toHaveBeenCalled();
  });
});
