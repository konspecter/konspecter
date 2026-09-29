import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("accepts valid settings", () => {
    const settings = {
      theme: "dark",
      defaultEditor: "markdown",
      fontScale: 1.3,
      readingPosition: "ask",
      tagNames: "as-written",
      editingArea: "plain",
    };
    expect(parseSettings(settings)).toEqual(settings);
  });

  it("names tags with a capital letter and highlights the editing area by default", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ tagNames: "capitalized", editingArea: "highlighted" });
  });

  it("uses defaults for missing data", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("replaces only the invalid fields", () => {
    expect(parseSettings({ theme: "purple", defaultEditor: "markdown", fontScale: 7 })).toEqual({
      ...DEFAULT_SETTINGS,
      defaultEditor: "markdown",
    });
  });
});
