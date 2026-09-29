import { fileStemFor, uniqueFileNames } from "./file-name";

describe("file names", () => {
  it.each([
    ["Hash maps", "Hash maps"],
    ["Java: Collections / Maps?", "Java Collections Maps"],
    ["Заметки о Go", "Заметки о Go"],
    ["  ", "Untitled"],
    ["a".repeat(100), "a".repeat(80)],
  ])("stem of %j is %j", (title, stem) => {
    expect(fileStemFor(title)).toBe(stem);
  });

  it("makes names unique, ignoring case", () => {
    expect(uniqueFileNames(["Maps", "maps", "Maps", "Other"])).toEqual([
      "Maps.md",
      "maps 2.md",
      "Maps 3.md",
      "Other.md",
    ]);
  });
});
