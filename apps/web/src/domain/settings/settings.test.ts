import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("accepts valid settings", () => {
    const settings = {
      theme: "dark",
      defaultEditor: "markdown",
      fontScale: 1.3,
      readingPosition: "ask",
    };
    expect(parseSettings(settings)).toEqual(settings);
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
