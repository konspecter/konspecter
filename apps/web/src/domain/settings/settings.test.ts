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
      language: "ru",
      fileNames: "title",
    };
    expect(parseSettings(settings)).toEqual(settings);
  });

  it("names tags with a capital letter and highlights the editing area by default", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ tagNames: "capitalized", editingArea: "highlighted" });
  });

  it("keeps file names when titles change by default", () => {
    expect(DEFAULT_SETTINGS.fileNames).toBe("kept");
    expect(parseSettings({ fileNames: "slug" }).fileNames).toBe("kept");
  });

  it("follows the system's language by default, and ignores languages it does not speak", () => {
    expect(DEFAULT_SETTINGS.language).toBe("system");
    expect(parseSettings({ language: "de" }).language).toBe("system");
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
