import { createNote } from "../../domain/note/note";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { NoteCatalog, notesInTag, summarize, type NoteSummary } from "./note-catalog";

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
  it("keeps the title, date and the start of the readable text", () => {
    const note = createNote("# Hash maps\n\nBuckets **and** collisions.", new Date("2024-01-02"));

    expect(summarize(note)).toEqual({
      id: note.id,
      title: "Hash maps",
      updated: "2024-01-02T00:00:00Z",
      excerpt: "Buckets and collisions.",
      valid: true,
    });
  });

  it("summarizes a note with invalid frontmatter from its raw text", () => {
    expect(summarize({ id: "x", markdown: "---\ntitle: [\n---\nText" })).toMatchObject({
      title: "",
      valid: false,
      updated: null,
    });
  });
});

describe("notesInTag", () => {
  const tag = (name: string) => ({ name });

  it("lists the notes with a chain ending in the tag, by title", async () => {
    const store = await newStore();
    const now = new Date("2024-01-01");
    await store.put(createNote("# streams\n\n#java", now, "a"));
    await store.put(createNote("# Collections\n\n#java#collections", now, "b"));
    await store.put(createNote("# Arrays\n\n#java #java#collections", now, "c"));
    await store.put(createNote("#\n\n#java", now, "d"));
    await store.put(createNote("# Other\n\n#go", now, "e"));
    await store.put(createNote("# Python\n\n#python#collections", now, "f"));

    const java = await notesInTag(store, tag("java"));
    expect(java.map((note) => note.id)).toEqual(["c", "a", "d"]);
    const collections = await notesInTag(store, tag("collections"));
    expect(collections.map((note) => note.id)).toEqual(["c", "b", "f"]);
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
