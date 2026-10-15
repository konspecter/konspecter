import { formatKeys, matchesShortcut, pinKeyOf, shortcutGroups } from "./shortcuts";

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

  it("finds ⌘/ and ⌘\\ on a Russian layout, where those keys type other characters", () => {
    // Russian (PC): the "/" key types "."; the "\\" key types "\\" (PC) or "ё" (Mac).
    expect(matchesShortcut("Mod+/", key({ key: ".", code: "Slash", metaKey: true }), true)).toBe(
      true,
    );
    expect(
      matchesShortcut("Mod+\\", key({ key: "ё", code: "Backslash", metaKey: true }), true),
    ).toBe(true);
    expect(
      matchesShortcut("Mod+\\", key({ key: "\\", code: "Backslash", ctrlKey: true }), false),
    ).toBe(true);
    // Russian (PC) types "/" with Shift: that is not ⌘/.
    expect(
      matchesShortcut(
        "Mod+/",
        key({ key: "/", code: "Backslash", ctrlKey: true, shiftKey: true }),
        false,
      ),
    ).toBe(false);
  });

  it("matches single keys only without modifiers", () => {
    expect(matchesShortcut("?", key({ key: "?", shiftKey: true }), false)).toBe(true);
    expect(matchesShortcut("n", key({ key: "n" }), false)).toBe(true);
    expect(matchesShortcut("n", key({ key: "n", ctrlKey: true }), false)).toBe(false);
    expect(matchesShortcut("Escape", key({ key: "Escape" }), true)).toBe(true);
    expect(matchesShortcut("Escape", key({ key: "Escape", metaKey: true }), true)).toBe(false);
  });
});

describe("formatKeys", () => {
  it("shows the platform's modifier", () => {
    expect(formatKeys("Mod+P", true)).toBe("⌘P");
    expect(formatKeys("Mod+,", false)).toBe("Ctrl+,");
    expect(formatKeys("?", true)).toBe("?");
    expect(formatKeys("Escape", true)).toBe("Esc");
  });
});

describe("shortcutGroups", () => {
  it("lists each action once, with every key that does it", () => {
    const groups = shortcutGroups();
    expect(groups.find((group) => group.label === "shortcut.search")?.keys).toEqual(["Mod+P", "/"]);
    expect(groups.find((group) => group.label === "shortcut.newNote")?.keys).toEqual([
      "Mod+N",
      "n",
    ]);
    expect(new Set(groups.map((group) => group.label)).size).toBe(groups.length);
  });
});

describe("arrow shortcuts", () => {
  it("match ⌘/Ctrl with an arrow, and show the arrow", () => {
    expect(matchesShortcut("Mod+ArrowLeft", key({ key: "ArrowLeft", metaKey: true }), true)).toBe(
      true,
    );
    expect(
      matchesShortcut("Mod+ArrowRight", key({ key: "ArrowRight", ctrlKey: true }), false),
    ).toBe(true);
    expect(
      matchesShortcut(
        "Mod+ArrowLeft",
        key({ key: "ArrowLeft", metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe(false);
    expect(formatKeys("Mod+ArrowLeft", true)).toBe("⌘←");
    expect(formatKeys("Mod+ArrowRight", false)).toBe("Ctrl+→");
  });

  it("tells Mod+Alt+arrows from Mod+arrows", () => {
    const left = { key: "ArrowLeft" };
    expect(
      matchesShortcut("Mod+Alt+ArrowLeft", key({ ...left, metaKey: true, altKey: true }), true),
    ).toBe(true);
    expect(
      matchesShortcut("Mod+Alt+ArrowLeft", key({ ...left, ctrlKey: true, altKey: true }), false),
    ).toBe(true);
    expect(matchesShortcut("Mod+Alt+ArrowLeft", key({ ...left, metaKey: true }), true)).toBe(false);
    expect(
      matchesShortcut("Mod+ArrowLeft", key({ ...left, metaKey: true, altKey: true }), true),
    ).toBe(false);
    expect(formatKeys("Mod+Alt+ArrowLeft", true)).toBe("⌥⌘←");
    expect(formatKeys("Mod+Alt+ArrowRight", false)).toBe("Ctrl+Alt+→");
  });
});

describe("pin shortcuts", () => {
  it("pin with Mod+Alt and a digit, open with Mod and a digit, by the physical key", () => {
    const ctrl5 = key({ key: "5", code: "Digit5", ctrlKey: true });
    const cmd5 = key({ key: "5", code: "Digit5", metaKey: true });
    // ⌥5 on macOS reports "∞": the physical key decides.
    const cmdOpt5 = key({ key: "∞", code: "Digit5", metaKey: true, altKey: true });
    const ctrlAlt5 = key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    expect(matchesShortcut("Mod+Digit", cmd5, true)).toBe(true);
    expect(matchesShortcut("Mod+Digit", ctrl5, true)).toBe(false);
    expect(matchesShortcut("Mod+Digit", ctrl5, false)).toBe(true);
    expect(matchesShortcut("Mod+Digit", cmd5, false)).toBe(false);
    expect(matchesShortcut("Mod+Digit", cmdOpt5, true)).toBe(false);
    expect(matchesShortcut("Mod+Alt+Digit", cmdOpt5, true)).toBe(true);
    expect(matchesShortcut("Mod+Alt+Digit", ctrlAlt5, false)).toBe(true);
    expect(matchesShortcut("Mod+Alt+Digit", ctrl5, false)).toBe(false);
    expect(
      matchesShortcut("Mod+Digit", key({ key: "&", code: "Digit1", ctrlKey: true }), false),
    ).toBe(true);
    expect(
      matchesShortcut("Mod+Digit", key({ key: "0", code: "Numpad0", ctrlKey: true }), false),
    ).toBe(true);
    expect(
      matchesShortcut(
        "Mod+Digit",
        key({ key: "%", code: "Digit5", ctrlKey: true, shiftKey: true }),
        false,
      ),
    ).toBe(false);
    expect(
      matchesShortcut("Mod+Digit", key({ key: "p", code: "KeyP", ctrlKey: true }), false),
    ).toBe(false);
    expect(matchesShortcut("Mod+Digit", key({ key: "1", code: "Digit1" }), false)).toBe(false);
    expect(pinKeyOf(key({ key: "0", code: "Numpad0", ctrlKey: true }))).toBe("0");
    expect(pinKeyOf(key({ key: "a", code: "KeyA", ctrlKey: true }))).toBeNull();
    expect(formatKeys("Mod+Digit", true)).toBe("⌘1…0");
    expect(formatKeys("Mod+Digit", false)).toBe("Ctrl+1…0");
    expect(formatKeys("Mod+Alt+Digit", true)).toBe("⌥⌘1…0");
    expect(formatKeys("Mod+Alt+Digit", false)).toBe("Ctrl+Alt+1…0");
  });

  it("leave AltGr with a digit to typing (`{` on a German layout)", () => {
    const altGr7 = new KeyboardEvent("keydown", {
      key: "{",
      code: "Digit7",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });
    expect(matchesShortcut("Mod+Alt+Digit", altGr7, false)).toBe(false);
  });
});
