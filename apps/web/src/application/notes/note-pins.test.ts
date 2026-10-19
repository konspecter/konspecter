import { parseDocument } from "../../domain/document/document";
import { createNote } from "../../domain/note/note";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { summarize, type NoteSummary } from "./note-catalog";
import { movePinsIntoNotes, pinChanges, pinsOf, recentWithPins, setStoredPin } from "./note-pins";

let count = 0;
const newStore = () => openNoteStore(`pins-test-${String((count += 1))}`);

const note = (id: string, updated: string | null, pin: NoteSummary["pin"] = null) =>
  ({ id, updated, pin }) as unknown as NoteSummary;

describe("pinsOf", () => {
  it("gives each key the note that claims it", () => {
    expect(pinsOf([note("a", null, "1"), note("b", null, "0"), note("c", null)])).toEqual({
      1: "a",
      0: "b",
    });
  });

  it("gives a key claimed twice (pinned on two devices) to the note edited last", () => {
    const notes = [
      note("older", "2026-10-01T00:00:00Z", "3"),
      note("newer", "2026-10-02T00:00:00Z", "3"),
    ];
    expect(pinsOf(notes)).toEqual({ 3: "newer" });
  });
});

describe("pinChanges", () => {
  it("pins a note to a key, and unpins it with the same key", () => {
    expect(pinChanges([note("a", null)], "3", "a")).toEqual([{ noteId: "a", pin: "3" }]);
    expect(pinChanges([note("a", null, "3")], "3", "a")).toEqual([{ noteId: "a", pin: null }]);
  });

  it("moves a pinned note to the new key, and takes the key from every other note", () => {
    expect(pinChanges([note("a", null, "1")], "2", "a")).toEqual([{ noteId: "a", pin: "2" }]);
    const notes = [
      note("a", "2026-10-02T00:00:00Z", "1"),
      note("b", "2026-10-01T00:00:00Z", "1"),
      note("c", null),
    ];
    expect(pinChanges(notes, "1", "c")).toEqual([
      { noteId: "a", pin: null },
      { noteId: "b", pin: null },
      { noteId: "c", pin: "1" },
    ]);
    // The note that lost the key to a later edit takes it back.
    expect(pinChanges(notes, "1", "b")).toEqual([
      { noteId: "a", pin: null },
      { noteId: "b", pin: "1" },
    ]);
  });
});

describe("recentWithPins", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("lists the pins first, 1 to 9 then 0, then the week's other notes", () => {
    const notes = [
      note("today", "2026-10-15T09:00:00Z", "0"),
      note("yesterday", "2026-10-14T09:00:00Z"),
      note("old", "2026-01-01T00:00:00Z", "2"),
    ];
    const { pinned, recent } = recentWithPins(notes, now);
    expect(pinned.map(({ key, note }) => [key, note.id])).toEqual([
      ["2", "old"],
      ["0", "today"],
    ]);
    expect(recent.map(({ id }) => id)).toEqual(["yesterday"]);
  });
});

describe("setStoredPin", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  it("writes the pin into the note's frontmatter, as an edit", async () => {
    const store = await newStore();
    await store.put(createNote("# Bee\n\nB.", new Date("2026-10-01T00:00:00Z"), "bee"));

    await setStoredPin(store, "bee", "4", now);
    const pinned = parseDocument((await store.get("bee"))?.markdown ?? "").metadata;
    expect(pinned).toMatchObject({ pin: "4", updated: "2026-10-19T12:00:00Z" });

    await setStoredPin(store, "bee", null, now);
    expect(parseDocument((await store.get("bee"))?.markdown ?? "").metadata.pin).toBeNull();
  });

  it("leaves a missing note and unreadable frontmatter alone", async () => {
    const store = await newStore();
    const broken = { id: "broken", markdown: "---\ntitle: [\n---\n\nStill here." };
    await store.put(broken);
    await setStoredPin(store, "gone", "1", now);
    await setStoredPin(store, "broken", "1", now);
    expect(await store.get("broken")).toEqual(broken);
  });
});

describe("movePinsIntoNotes", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  it("moves the device's old pins into the notes, once", async () => {
    const store = await newStore();
    await store.put(createNote("# Bee\n\nB.", now, "bee"));
    await store.put(createNote("---\npin: 2\n---\n\n# Sea", now, "sea"));
    localStorage.setItem("konspecter.pins", JSON.stringify({ 2: "bee", 3: "gone", x: "sea" }));

    await movePinsIntoNotes(store, localStorage, now);
    const pins = pinsOf((await store.list()).map((note) => summarize(note)));
    // The key goes to the device's note; a pin of a note that is gone is dropped.
    expect(pins).toEqual({ 2: "bee" });
    expect(localStorage.getItem("konspecter.pins")).toBeNull();
  });

  it("does nothing without old pins, or with unreadable ones", async () => {
    const store = await newStore();
    await store.put(createNote("# Bee", now, "bee"));
    const before = await store.get("bee");
    await movePinsIntoNotes(store, null, now);
    localStorage.setItem("konspecter.pins", "{not json");
    await movePinsIntoNotes(store, localStorage, now);
    expect(await store.get("bee")).toEqual(before);
    expect(localStorage.getItem("konspecter.pins")).toBeNull();
  });
});
