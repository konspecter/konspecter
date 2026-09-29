import { formatKeys, matchesShortcut } from "./shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("matchesShortcut", () => {
  it("uses ⌘ on macOS and Ctrl elsewhere", () => {
    expect(matchesShortcut("Mod+P", key({ key: "p", metaKey: true }), true)).toBe(true);
    expect(matchesShortcut("Mod+P", key({ key: "p", ctrlKey: true }), true)).toBe(false);
    expect(matchesShortcut("Mod+P", key({ key: "p", ctrlKey: true }), false)).toBe(true);
    expect(matchesShortcut("Mod+P", key({ key: "p", metaKey: true }), false)).toBe(false);
  });

  it("needs exactly the modifier", () => {
    expect(matchesShortcut("Mod+N", key({ key: "N", ctrlKey: true, shiftKey: true }), false)).toBe(
      false,
    );
    expect(matchesShortcut("Mod+N", key({ key: "n", ctrlKey: true, altKey: true }), false)).toBe(
      false,
    );
    expect(matchesShortcut("Mod+,", key({ key: ",", ctrlKey: true }), false)).toBe(true);
  });

  it("recognizes the physical key on other keyboard layouts", () => {
    expect(matchesShortcut("Mod+P", key({ key: "з", code: "KeyP", metaKey: true }), true)).toBe(
      true,
    );
    expect(matchesShortcut("Mod+,", key({ key: "б", code: "Comma", ctrlKey: true }), false)).toBe(
      true,
    );
  });

  it("matches single keys only without modifiers", () => {
    expect(matchesShortcut("?", key({ key: "?", shiftKey: true }), false)).toBe(true);
    expect(matchesShortcut("n", key({ key: "n" }), false)).toBe(true);
    expect(matchesShortcut("n", key({ key: "n", ctrlKey: true }), false)).toBe(false);
  });
});

describe("formatKeys", () => {
  it("shows the platform's modifier", () => {
    expect(formatKeys("Mod+P", true)).toBe("⌘P");
    expect(formatKeys("Mod+,", false)).toBe("Ctrl+,");
    expect(formatKeys("?", true)).toBe("?");
  });
});
