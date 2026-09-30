import { fileStemFor, slugFileNames, slugFor, stemFitsSlug, uniqueFileNames } from "./file-name";

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

describe("slugs", () => {
  it.each([
    ["Hello мир!", "hello-mir"],
    ["Test", "test"],
    ["Java: Collections / Maps?", "java-collections-maps"],
    ["Щука и ёжик", "shchuka-i-yozhik"],
    ["Їжак і Ґанок", "yizhak-i-ganok"],
    ["Café déjà vu", "cafe-deja-vu"],
    ["Go 1.27 — release notes", "go-1-27-release-notes"],
    ["日本語のノート", "日本語のノート"],
    ["がぎ", "がぎ"],
    ["  ", "untitled"],
    ["!!!", "untitled"],
    [`${"a".repeat(79)} b`, "a".repeat(79)],
  ])("slug of %j is %j", (title, slug) => {
    expect(slugFor(title)).toBe(slug);
  });

  it.each([
    ["hello-mir", true],
    ["hello-mir-2", true],
    ["hello-mir-12", true],
    ["hello-mir-x", false],
    ["hello-mir-", false],
    ["Hello-mir", false],
    ["test", false],
  ])("stem %j fits the slug hello-mir: %j", (stem, fits) => {
    expect(stemFitsSlug(stem, "hello-mir")).toBe(fits);
  });

  it("numbers the names to try", () => {
    const names = slugFileNames("sub/", "hello-mir");
    expect([names.next().value, names.next().value, names.next().value]).toEqual([
      "sub/hello-mir.md",
      "sub/hello-mir-2.md",
      "sub/hello-mir-3.md",
    ]);
  });
});
