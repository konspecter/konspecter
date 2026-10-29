import type { NoteSummary } from "./note-catalog";
import { noteOpened, startSwitch, switchStep, type NoteSwitch } from "./note-switch";

const now = new Date("2026-10-29T12:00:00.000Z");

function summary(id: string, daysAgo: number): NoteSummary {
  return {
    id,
    title: id,
    updated: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    cover: null,
    tags: [],
    excerpt: "",
    headings: [],
    pin: null,
    valid: true,
  };
}

/** The notes the Tabs of one hold open, `count` presses (Shift+Tab with -1). */
function presses(state: NoteSwitch, count: number, step: 1 | -1 = 1): string[] {
  const ids: string[] = [];
  let current = state;
  for (let press = 0; press < count; press += 1) {
    const next = switchStep(current, step);
    if (next === null) break;
    ids.push(next.id);
    current = next.next;
  }
  return ids;
}

describe("noteOpened", () => {
  it("puts the note first, once", () => {
    expect(noteOpened(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(noteOpened([], "a")).toEqual(["a"]);
  });

  it("remembers the last fifty", () => {
    const opened = Array.from({ length: 50 }, (_, index) => `n${String(index)}`);
    const after = noteOpened(opened, "new");
    expect(after).toHaveLength(50);
    expect(after[0]).toBe("new");
    expect(after).not.toContain("n49");
  });
});

describe("startSwitch and switchStep", () => {
  const notes = [summary("a", 1), summary("b", 2), summary("c", 3), summary("old", 30)];

  it("toggles between the last two notes opened", () => {
    let opened = noteOpened(noteOpened([], "a"), "b");
    expect(presses(startSwitch(opened, notes, "b", now), 1)).toEqual(["a"]);
    opened = noteOpened(opened, "a");
    expect(presses(startSwitch(opened, notes, "a", now), 1)).toEqual(["b"]);
  });

  it("goes further back with each Tab, round in a loop", () => {
    const opened = ["c", "a", "b"];
    expect(presses(startSwitch(opened, notes, "c", now), 4)).toEqual(["a", "b", "c", "a"]);
  });

  it("steps back in the loop with Shift+Tab, round from the first to the last", () => {
    const held = startSwitch(["c", "a", "b"], notes, "c", now);
    const back = switchStep(held);
    expect(back?.id).toBe("a");
    expect(back && switchStep(back.next, -1)?.id).toBe("c");
    expect(presses(held, 3, -1)).toEqual(["b", "a", "c"]);
    expect(presses(startSwitch(["b", "a"], notes, null, now), 1, -1)).toEqual(["c"]);
  });

  it("goes on into Recent, newest edit first, past the notes opened", () => {
    expect(presses(startSwitch(["c"], notes, "c", now), 3)).toEqual(["a", "b", "c"]);
    // A note opened is in the order even when it is older than Recent.
    expect(presses(startSwitch(["old", "c"], notes, "old", now), 4)).toEqual([
      "c",
      "a",
      "b",
      "old",
    ]);
  });

  it("starts at the note last opened away from a note", () => {
    expect(presses(startSwitch(["b", "a"], notes, null, now), 2)).toEqual(["b", "a"]);
  });

  it("leaves out the notes that are gone", () => {
    expect(presses(startSwitch(["gone", "a"], notes, "b", now), 1)).toEqual(["a"]);
  });

  it("has nowhere to go with one note or none", () => {
    expect(switchStep(startSwitch(["a"], [summary("a", 1)], "a", now))).toBeNull();
    expect(switchStep(startSwitch(["a"], [summary("a", 1)], "a", now), -1)).toBeNull();
    expect(switchStep(startSwitch([], [], null, now))).toBeNull();
  });
});
