import {
  colorStyle,
  defaultHue,
  hexToHsl,
  hslToHex,
  inkOn,
  recentColors,
  rememberColor,
} from "./note-color";

describe("note colour", () => {
  it("keeps each note's default hue", () => {
    expect(defaultHue("a")).toBe(defaultHue("a"));
    expect(defaultHue("a")).toBeGreaterThanOrEqual(0);
    expect(defaultHue("a")).toBeLessThan(360);
    expect(colorStyle("a", null)).toEqual({ "--cover-hue": defaultHue("a") });
  });

  it("paints a colour of its own with ink that reads on it", () => {
    expect(colorStyle("a", "#ffff00")).toMatchObject({
      "--cover-color": "#ffff00",
      "--cover-ink": inkOn("#ffff00"),
    });
    expect(inkOn("#ffff00")).toContain("0 0 0");
    expect(inkOn("#ffffff")).toContain("0 0 0");
    expect(inkOn("#1a237e")).toContain("255 255 255");
    expect(inkOn("#000000")).toContain("255 255 255");
  });

  it.each([
    [0, 1, 0.5, "#ff0000"],
    [120, 1, 0.5, "#00ff00"],
    [240, 1, 0.5, "#0000ff"],
    [60, 1, 0.75, "#ffff80"],
    [0, 0, 0, "#000000"],
    [0, 0, 1, "#ffffff"],
  ])("converts hsl(%i, %f, %f) to %s and back", (hue, saturation, lightness, hex) => {
    expect(hslToHex(hue, saturation, lightness)).toBe(hex);
    const back = hexToHsl(hex);
    expect(back.lightness).toBeCloseTo(lightness, 2);
    if (saturation > 0) expect(back.hue).toBeCloseTo(hue, 0);
  });

  it("keeps nine recent colours, newest first, each once", () => {
    for (let index = 1; index <= 10; index += 1) rememberColor(`#00000${String(index % 10)}`);
    rememberColor("#000005");

    expect(recentColors()).toEqual([
      "#000005",
      "#000000",
      "#000009",
      "#000008",
      "#000007",
      "#000006",
      "#000004",
      "#000003",
      "#000002",
    ]);
  });

  it("reads only valid colours from storage", () => {
    localStorage.setItem("konspecter.recentColors", JSON.stringify(["#ABC", "red", 3, "#abc"]));
    expect(recentColors()).toEqual(["#aabbcc"]);
    localStorage.setItem("konspecter.recentColors", "{not json");
    expect(recentColors()).toEqual([]);
  });
});
