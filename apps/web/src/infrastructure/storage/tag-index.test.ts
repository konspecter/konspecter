import { openDB } from "idb";
import { createNote, updateNote, type Note } from "../../domain/note/note";
import { parseTagName, type Tag } from "../../domain/tag/tags";
import { openNoteStore } from "./note-store";
import { TAG_INDEX_VERSION } from "./tag-index";

let databaseCount = 0;
function uniqueName() {
  databaseCount += 1;
  return `tag-index-test-${String(databaseCount)}`;
}

const now = new Date("2026-09-28T10:00:00Z");
const tag = (name: string) => parseTagName(name) as Tag;
const note = (id: string, markdown: string): Note => createNote(markdown, now, id);
const ids = (notes: readonly Note[]) => notes.map((n) => n.id).sort();

describe("tag index", () => {
  it("indexes tags when a note is saved", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(note("a", "Intro #java#collections and #tips"));
    await store.put(note("b", "#java"));

    expect(ids(await store.notesWithTag(tag("java")))).toEqual(["a", "b"]);
    expect(ids(await store.notesWithTag(tag("java#collections")))).toEqual(["a"]);
    expect(ids(await store.notesWithTag(tag("tips")))).toEqual(["a"]);
    expect(await store.notesWithTag(tag("missing"))).toEqual([]);
  });

  it("counts notes per tag, including notes in child tags", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put(note("a", "#java#collections #java#streams"));
    await store.put(note("b", "#java #go"));

    expect((await store.tags()).map(({ tag, count }) => [tag.name, count])).toEqual([
      ["go", 1],
      ["java", 2],
      ["java#collections", 1],
      ["java#streams", 1],
    ]);
  });

  it("updates entries when a note changes and removes them when it is deleted", async () => {
    const store = await openNoteStore(uniqueName());
    const original = note("a", "#old");
    await store.put(original);

    await store.put(updateNote(original, "#new", now));
    expect(await store.notesWithTag(tag("old"))).toEqual([]);
    expect(ids(await store.notesWithTag(tag("new")))).toEqual(["a"]);

    await store.delete("a");
    expect(await store.tags()).toEqual([]);
  });

  it("indexes nothing for a note with invalid frontmatter", async () => {
    const store = await openNoteStore(uniqueName());
    await store.put({ id: "bad", markdown: "---\ntitle: [\n---\n#java" });

    expect(await store.tags()).toEqual([]);
  });

  it("rebuilds from the notes after the index is lost", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    await store.put(note("a", "#java"));
    const raw = await openDB(name);
    await raw.clear("tags");
    raw.close();
    expect(await store.tags()).toEqual([]);

    await store.rebuildIndexes();

    expect(ids(await store.notesWithTag(tag("java")))).toEqual(["a"]);
  });

  it("rebuilds on open when the index was built by another version", async () => {
    const name = uniqueName();
    await (await openNoteStore(name)).put(note("a", "#java"));
    const raw = await openDB(name);
    await raw.clear("tags");
    await raw.put("meta", TAG_INDEX_VERSION - 1, "tagIndexVersion");
    raw.close();

    const reopened = await openNoteStore(name);

    expect(ids(await reopened.notesWithTag(tag("java")))).toEqual(["a"]);
  });

  it("builds the index for existing notes when upgrading from version 2", async () => {
    const name = uniqueName();
    const v2 = await openDB(name, 2, {
      upgrade(database) {
        database.createObjectStore("notes");
      },
    });
    await v2.put("notes", { id: "a", markdown: "#java#collections" }, "a");
    await v2.put("notes", { id: 42 }, "junk");
    v2.close();

    const store = await openNoteStore(name);

    expect(ids(await store.notesWithTag(tag("java")))).toEqual(["a"]);
  });
});

describe("tag index recovery", () => {
  it("repairs a damaged index when the database is opened", async () => {
    const name = uniqueName();
    const store = await openNoteStore(name);
    await store.put(note("a", "#java"));
    await store.put(note("b", "#go"));
    const raw = await openDB(name);
    await raw.delete("tags", "a"); // An entry lost…
    await raw.put("tags", { noteId: "ghost", tags: ["x"], memberOf: ["x"] }); // …and one without a note.
    raw.close();

    const reopened = await openNoteStore(name);

    expect((await reopened.tags()).map(({ tag }) => tag.name)).toEqual(["go", "java"]);
  });

  it("repairs a malformed entry", async () => {
    const name = uniqueName();
    await (await openNoteStore(name)).put(note("a", "#java"));
    const raw = await openDB(name);
    await raw.put("tags", { noteId: "a", tags: "not a list" });
    raw.close();

    const reopened = await openNoteStore(name);

    expect(ids(await reopened.notesWithTag(tag("java")))).toEqual(["a"]);
  });
});
