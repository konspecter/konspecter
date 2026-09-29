import {
  InvalidReadingStateError,
  parseReadingState,
  positionToScroll,
  scrollToPosition,
} from "./reading";

describe("reading position", () => {
  it("converts between scroll offsets and positions", () => {
    expect(scrollToPosition(500, 2000, 1000)).toBe(0.5);
    expect(scrollToPosition(1200, 2000, 1000)).toBe(1);
    expect(scrollToPosition(-10, 2000, 1000)).toBe(0);
    expect(positionToScroll(0.5, 3000, 1000)).toBe(1000);
  });

  it("has no position on a page that does not scroll", () => {
    expect(scrollToPosition(0, 800, 1000)).toBeNull();
    expect(positionToScroll(0.5, 800, 1000)).toBe(0);
  });

  it("validates stored state", () => {
    const valid = { noteId: "n", position: 0.25, updatedAt: "2026-09-28T10:00:00Z" };
    expect(parseReadingState({ ...valid, extra: 1 })).toEqual(valid);

    for (const bad of [
      null,
      { ...valid, noteId: "" },
      { ...valid, position: 2 },
      { ...valid, position: Number.NaN },
      { ...valid, updatedAt: "x" },
    ]) {
      expect(() => parseReadingState(bad)).toThrow(InvalidReadingStateError);
    }
  });
});
