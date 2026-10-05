import { frontmatterTags } from "../document/document";
import {
  chainFolder,
  folderTagName,
  foldersOf,
  inChainFolder,
  pathChain,
  sameChain,
  withFolderChain,
  withFolderTags,
} from "./folders";
import { readNote } from "./note";

describe("folders as tag chains", () => {
  it.each([
    ["java", "java"],
    ["My Notes", "My_Notes"],
    ["node.js", "node_js"],
    ["Конспекты", "Конспекты"],
    ["C++", "C"],
    ["+++", null],
  ])("names the folder %s as the tag %s", (folder, tag) => {
    expect(folderTagName(folder)).toBe(tag);
  });

  it.each([
    ["maps.md", ""],
    ["java/maps.md", "java"],
    ["Java/Collections/maps.md", "Java#Collections"],
    ["My Notes/x.md", "My_Notes"],
    ["java/2024/x.md", "java#2024"],
    ["2024/x.md", null],
    ["+++/x.md", null],
  ])("reads the folders of %s as the chain %s", (path, chain) => {
    expect(pathChain(path)).toBe(chain);
  });

  it("compares chains by their tags, in order, ignoring case", () => {
    expect(sameChain("Java#Collections", "java#collections")).toBe(true);
    expect(sameChain("java#collections", "collections#java")).toBe(false);
    expect(sameChain("", "")).toBe(true);
    expect(sameChain("", "java")).toBe(false);
  });

  it("knows whether a file is in its first chain's folder", () => {
    const note = (id: string, markdown: string) => readNote({ id, markdown });
    expect(inChainFolder("java/x.md", note("java/x.md", "#Java#util"))).toBe(false);
    expect(inChainFolder("java/util/x.md", note("java/util/x.md", "#Java#util #go"))).toBe(true);
    expect(inChainFolder("x.md", note("x.md", "no tags"))).toBe(true);
    expect(inChainFolder("x.md", note("x.md", "#go"))).toBe(false);
    expect(inChainFolder("My Notes/x.md", note("My Notes/x.md", "#my_notes"))).toBe(true);
  });

  it("lists every folder level of the files", () => {
    expect([...foldersOf(["a/b/c.md", "a/d.md", "e.md"])].sort()).toEqual(["a", "a/b"]);
  });

  it("finds the folder for a chain, reusing folders whose names give its tags", () => {
    const folders = ["Java", "Java/Collections", "My Notes", "go"];
    expect(chainFolder("java#collections", folders)).toBe("Java/Collections/");
    expect(chainFolder("java#Streams", folders)).toBe("Java/Streams/");
    expect(chainFolder("my_notes", folders)).toBe("My Notes/");
    expect(chainFolder("folder1#folder2", folders)).toBe("folder1/folder2/");
    expect(chainFolder("collections", folders)).toBe("collections/");
    expect(chainFolder("", folders)).toBe("");
  });
});

describe("withFolderChain", () => {
  it("puts the chain first in the frontmatter's tags", () => {
    expect(withFolderChain("# Maps", "java#collections")).toBe(
      "---\ntags:\n  - java#collections\n---\n\n# Maps",
    );
    expect(frontmatterTags(withFolderChain("---\ntags: [go]\n---\nx", "java"))).toEqual([
      "java",
      "go",
    ]);
  });

  it("replaces the chain it moved from, and keeps one already listed", () => {
    const markdown = "---\ntags:\n  - go\n  - old#place\n---\nx";
    expect(frontmatterTags(withFolderChain(markdown, "new", "old#place"))).toEqual(["new", "go"]);
    expect(frontmatterTags(withFolderChain(markdown, "", "old#place"))).toEqual(["go"]);
    expect(withFolderChain("---\ntags: [go]\n---\nx", "go")).toBe("---\ntags: [go]\n---\nx");
  });
});

describe("withFolderTags", () => {
  it("gives a file without tags in folders its folders' chain", () => {
    expect(frontmatterTags(withFolderTags("java/collections/maps.md", "# Maps") ?? "")).toEqual([
      "java#collections",
    ]);
  });

  it("leaves files with tags, at the top level, or in folders that make no tag", () => {
    expect(withFolderTags("notes/x.md", "# X #go")).toBeNull();
    expect(withFolderTags("x.md", "# X")).toBeNull();
    expect(withFolderTags("2024/x.md", "# X")).toBeNull();
    expect(withFolderTags("java/x.md", "---\ntitle: [\n---\nbroken")).toBeNull();
  });

  it("follows a file moved out of its chain's folder", () => {
    const placed = "---\ntags:\n  - java\n  - jvm\n---\n\n# X";
    expect(frontmatterTags(withFolderTags("go/web/x.md", placed, "java/x.md") ?? "")).toEqual([
      "go#web",
      "jvm",
    ]);
    expect(frontmatterTags(withFolderTags("x.md", placed, "java/x.md") ?? "")).toEqual(["jvm"]);
  });

  it("leaves a moved file that was not in its chain's folder", () => {
    expect(withFolderTags("go/x.md", "# X #java", "notes/x.md")).toBeNull();
    expect(withFolderTags("java/x.md", "# X #java", "x.md")).toBeNull();
  });
});
