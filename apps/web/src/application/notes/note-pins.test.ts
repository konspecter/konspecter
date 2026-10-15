import type { NoteSummary } from "./note-catalog";
import type { NoteChange, NoteRepository } from "./note-repository";
import { NotePins, parsePins, recentWithPins, renamePinned, togglePin } from "./note-pins";

describe("togglePin", () => {
  it("pins a note to a key, and unpins it with the same key", () => {
    const pinned = togglePin({}, "3", "a");
    expect(pinned).toEqual({ 3: "a" });
    expect(togglePin(pinned, "3", "a")).toEqual({});
  });

  it("gives a key one note and a note one key", () => {
    // A taken key moves to this note; a pinned note moves to the new key.
    expect(togglePin({ 1: "a" }, "1", "b")).toEqual({ 1: "b" });
    expect(togglePin({ 1: "a", 2: "b" }, "3", "a")).toEqual({ 2: "b", 3: "a" });
  });
});

describe("renamePinned", () => {
  it("keeps the key on the renamed note", () => {
    expect(renamePinned({ 1: "old.md", 2: "b.md" }, "old.md", "new.md")).toEqual({
      1: "new.md",
      2: "b.md",
    });
    const pins = { 1: "a.md" };
    expect(renamePinned(pins, "other.md", "new.md")).toBe(pins);
  });
});

describe("parsePins", () => {
  it("keeps the digit keys holding note ids, each note once", () => {
    expect(parsePins({ 1: "a", 0: "b", 2: "a", 11: "c", x: "d", 3: 4, 4: "" })).toEqual({
      1: "a",
      0: "b",
    });
    expect(parsePins(null)).toEqual({});
    expect(parsePins(["a"])).toEqual({});
  });
});

describe("recentWithPins", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const note = (id: string, updated: string | null) => ({ id, updated }) as unknown as NoteSummary;
  const notes = [
    note("today", "2026-10-15T09:00:00Z"),
    note("yesterday", "2026-10-14T09:00:00Z"),
    note("old", "2026-01-01T00:00:00Z"),
  ];

  it("lists the pins first, 1 to 9 then 0, then the week's other notes", () => {
    const { pinned, recent } = recentWithPins(notes, { 0: "today", 2: "old", 5: "gone" }, now);
    expect(pinned.map(({ key, note }) => [key, note.id])).toEqual([
      ["2", "old"],
      ["0", "today"],
    ]);
    expect(recent.map(({ id }) => id)).toEqual(["yesterday"]);
  });
});

describe("NotePins", () => {
  it("keeps the pins in the device's storage and notifies subscribers", () => {
    const pins = new NotePins(localStorage);
    const listener = vi.fn();
    pins.subscribe(listener);
    pins.toggle("1", "a");
    expect(pins.getSnapshot()).toEqual({ 1: "a" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(new NotePins(localStorage).getSnapshot()).toEqual({ 1: "a" });
  });

  it("starts empty from unreadable or missing storage", () => {
    localStorage.setItem("konspecter.pins", "{not json");
    expect(new NotePins(localStorage).getSnapshot()).toEqual({});
    const pins = new NotePins(null);
    pins.toggle("2", "a");
    expect(pins.getSnapshot()).toEqual({ 2: "a" });
  });

  it("follows renamed notes", () => {
    let emit: (change: NoteChange) => void = () => undefined;
    const store = {
      onChange: (listener: (change: NoteChange) => void) => {
        emit = listener;
        return () => undefined;
      },
    } as unknown as NoteRepository;
    const pins = new NotePins(null);
    pins.toggle("4", "old.md");
    pins.follow(store);
    emit({ noteId: "other.md", source: "remote" });
    emit({ noteId: "new.md", source: "local", previousId: "old.md" });
    expect(pins.getSnapshot()).toEqual({ 4: "new.md" });
  });
});
