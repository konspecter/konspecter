import { newNoteFolder, newNoteMarkdown, newNoteState, treeChain } from "./new-note";

describe("a new note's tag", () => {
  it("is the chain of the tree folder the list's tag was chosen in", () => {
    expect(newNoteState("collections", { tagChain: "java#collections" })).toEqual({
      newNoteTag: "java#collections",
    });
  });

  it("is the tag alone when it was chosen elsewhere, or in another folder", () => {
    expect(newNoteState("collections", null)).toEqual({ newNoteTag: "collections" });
    expect(newNoteState("collections", { find: "x" })).toEqual({ newNoteTag: "collections" });
    expect(newNoteState("streams", { tagChain: "java#collections" })).toEqual({
      newNoteTag: "streams",
    });
  });

  it("is none without a filter", () => {
    expect(newNoteState(null, { tagChain: "java" })).toBeUndefined();
  });

  it("reads the folder's chain only from its link's state", () => {
    expect(treeChain({ tagChain: "java" })).toBe("java");
    expect(treeChain({ tagChain: "" })).toBeNull();
    expect(treeChain({ tagChain: 1 })).toBeNull();
    expect(treeChain("java")).toBeNull();
  });
});

describe("a new note's folder", () => {
  it("is the open note's folder, with or without a tag", () => {
    expect(newNoteState(null, null, "work")).toEqual({ folder: "work" });
    expect(newNoteState("java", null, "work")).toEqual({ newNoteTag: "java", folder: "work" });
    expect(newNoteFolder({ folder: "work" })).toEqual({ folder: "work", chosen: false });
  });

  it("is said to be chosen once asked for", () => {
    expect(newNoteFolder({ folder: "home", folderChosen: true })).toEqual({
      folder: "home",
      chosen: true,
    });
  });

  it("is none otherwise", () => {
    expect(newNoteFolder(null)).toEqual({ folder: null, chosen: false });
    expect(newNoteFolder({ folder: 3 })).toEqual({ folder: null, chosen: false });
  });
});

describe("a new note's text", () => {
  it("lists the tag in the frontmatter", () => {
    expect(newNoteMarkdown({ newNoteTag: "java#collections" })).toBe(
      "---\ntags:\n  - java#collections\n---\n\n",
    );
  });

  it("is empty without one", () => {
    expect(newNoteMarkdown(null)).toBe("");
    expect(newNoteMarkdown({ newNoteTag: "" })).toBe("");
    expect(newNoteMarkdown({ tagChain: "java" })).toBe("");
  });
});
