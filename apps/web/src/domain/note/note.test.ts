import { InvalidDocumentError } from "../document/document";
import {
  InvalidNoteError,
  byMostRecent,
  createNote,
  noteTags,
  noteTitle,
  noteUpdated,
  noteWrittenTags,
  listedOnlyTags,
  withBody,
  withSavedDates,
  withoutTag,
  parseNote,
  readNote,
  readNotes,
  updateNote,
  type Note,
} from "./note";

const monday = new Date("2026-09-28T10:15:00.500Z");
const tuesday = new Date("2026-09-29T08:00:00.000Z");

describe("createNote", () => {
  it("adds created and updated dates to the frontmatter", () => {
    expect(createNote("# Hi\n", monday, "n1")).toEqual({
      id: "n1",
      markdown: "---\ncreated: 2026-09-28T10:15:00Z\nupdated: 2026-09-28T10:15:00Z\n---\n\n# Hi\n",
    });
  });

  it("keeps metadata the author already wrote", () => {
    const note = createNote("---\ntitle: Mine\ncreated: 2020-01-01\n---\nBody", monday, "n1");

    expect(note.markdown).toBe(
      "---\ntitle: Mine\ncreated: 2020-01-01\nupdated: 2026-09-28T10:15:00Z\n---\nBody",
    );
  });

  it("rejects an invalid document", () => {
    expect(() => createNote("---\ncreated: soon\n---\n", monday)).toThrow(InvalidDocumentError);
  });

  it("generates a unique id by default", () => {
    expect(createNote("", monday).id).not.toBe(createNote("", monday).id);
  });
});

describe("updateNote", () => {
  const original = createNote("# Old", monday, "n1");

  it("replaces the Markdown and bumps only updated", () => {
    const edited = original.markdown.replace("# Old", "# New");

    expect(updateNote(original, edited, tuesday)).toEqual({
      id: "n1",
      markdown: "---\ncreated: 2026-09-28T10:15:00Z\nupdated: 2026-09-29T08:00:00Z\n---\n\n# New",
    });
  });

  it("stamps the dates under the spellings another tool wrote, without adding others", () => {
    const external = {
      id: "n2",
      markdown: "---\ncreate_at: 2020-01-01\nupdated_at: 2020-01-02\n---\n\nText",
    };

    expect(updateNote(external, `${external.markdown} more`, tuesday).markdown).toBe(
      "---\ncreate_at: 2020-01-01\nupdated_at: 2026-09-29T08:00:00Z\n---\n\nText more",
    );
  });

  it("keeps the created date when the new text drops the frontmatter", () => {
    expect(updateNote(original, "# New", tuesday).markdown).toBe(
      "---\ncreated: 2026-09-28T10:15:00Z\nupdated: 2026-09-29T08:00:00Z\n---\n\n# New",
    );
  });

  it("repairs a note whose stored frontmatter was invalid", () => {
    const broken: Note = { id: "n1", markdown: "---\ntitle: [\n---\nBody" };

    expect(updateNote(broken, "Body", tuesday).markdown).toBe(
      "---\ncreated: 2026-09-29T08:00:00Z\nupdated: 2026-09-29T08:00:00Z\n---\n\nBody",
    );
  });

  it("rejects an invalid document", () => {
    expect(() => updateNote(original, "---\ntitle: 1\n---\n", tuesday)).toThrow(
      InvalidDocumentError,
    );
  });
});

describe("parseNote", () => {
  it("accepts a valid record and drops unknown fields", () => {
    expect(parseNote({ id: "n1", markdown: "text", createdAt: "x" })).toEqual({
      id: "n1",
      markdown: "text",
    });
  });

  it.each([
    ["null", null],
    ["a string", "note"],
    ["a missing id", { markdown: "" }],
    ["an empty id", { id: "", markdown: "" }],
    ["non-string Markdown", { id: "n1", markdown: 42 }],
  ])("rejects %s", (_, value) => {
    expect(() => parseNote(value)).toThrow(InvalidNoteError);
  });
});

describe("reading notes", () => {
  it("exposes the parsed document, title and updated date", () => {
    const read = readNote(createNote("# Java", monday, "n1"));

    expect(read.valid).toBe(true);
    expect(noteTitle(read)).toBe("Java");
    expect(noteUpdated(read)).toBe("2026-09-28T10:15:00Z");
  });

  it("keeps notes with invalid frontmatter readable as errors", () => {
    const read = readNote({ id: "n1", markdown: "---\ntitle: [\n---\n" });

    expect(read.valid).toBe(false);
    expect(!read.valid && read.error).toBeInstanceOf(InvalidDocumentError);
    expect(noteTitle(read)).toBe("");
    expect(noteUpdated(read)).toBeNull();
  });

  it("orders by updated date, then undated and invalid notes, then by id", () => {
    const notes: Note[] = [
      { id: "invalid", markdown: "---\ntitle: [\n---\n" },
      { id: "undated", markdown: "No frontmatter" },
      createNote("old", monday, "old"),
      // Same instant as "new-b", written with an offset.
      { id: "new-a", markdown: "---\nupdated: 2026-09-29T10:00:00+02:00\n---\n" },
      createNote("new", tuesday, "new-b"),
    ];

    expect(readNotes(notes).map((read) => read.note.id)).toEqual([
      "new-a",
      "new-b",
      "old",
      "invalid",
      "undated",
    ]);
    expect(byMostRecent(readNote(notes[2] as Note), readNote(notes[2] as Note))).toBe(0);
  });
});

describe("noteTags", () => {
  it("takes the frontmatter's tags first, then the body's, each tag of a chain once", () => {
    const read = readNote({
      id: "n",
      markdown: "---\ntags:\n  - parent_1#child\n  - Java\n---\nText #java and #go, not `#code`.",
    });
    expect(noteTags(read).map((tag) => tag.name)).toEqual(["parent_1", "child", "java", "go"]);
    expect(noteWrittenTags(read)).toEqual(["parent_1#child", "Java", "go"]);
  });

  it("skips frontmatter entries that are not tags", () => {
    const read = readNote({ id: "n", markdown: "---\ntags: [2024, ok, 'a b']\n---\n" });
    expect(noteTags(read).map((tag) => tag.name)).toEqual(["ok"]);
  });
});

describe("withSavedDates", () => {
  const saved = {
    id: "n",
    markdown: "---\ncreated: 2024-01-01T00:00:00Z\nupdated: 2024-02-02T00:00:00Z\n---\n\n# N",
  };

  it("takes over the dates a save wrote and keeps the rest of the text", () => {
    expect(withSavedDates("# N\n\ntyped since", saved)).toBe(
      "---\ncreated: 2024-01-01T00:00:00Z\nupdated: 2024-02-02T00:00:00Z\n---\n\n# N\n\ntyped since",
    );
    expect(withSavedDates("---\ntitle: T\nupdated: 2023-01-01T00:00:00Z\n---\n\n# N", saved)).toBe(
      "---\ntitle: T\nupdated: 2024-02-02T00:00:00Z\ncreated: 2024-01-01T00:00:00Z\n---\n\n# N",
    );
  });

  it("leaves the frontmatter being typed as it is, but for the dates", () => {
    // A space typed at the end of a line and blank lines stay: the next key
    // or word goes where the author put the caret.
    const typing = "---\ntitle: Hash \n\n\ntags:\n- a\nupdated: 2023-01-01T00:00:00Z\n---\n\n# N";

    expect(withSavedDates(typing, saved)).toBe(
      "---\ntitle: Hash \n\n\ntags:\n- a\nupdated: 2024-02-02T00:00:00Z\ncreated: 2024-01-01T00:00:00Z\n---\n\n# N",
    );
  });

  it("returns the text itself when the dates already match or it is invalid", () => {
    expect(withSavedDates(saved.markdown, saved)).toBe(saved.markdown);
    const invalid = "---\ntitle: [\n---\n";
    expect(withSavedDates(invalid, saved)).toBe(invalid);
  });
});

describe("removing a listed tag", () => {
  const markdown = "---\ntitle: T\ntags: [Java, go, extra]\n---\n\nT #go";

  it("offers only the tags the frontmatter lists and the body does not write", () => {
    expect(listedOnlyTags(readNote({ id: "n", markdown }))).toEqual(["java", "extra"]);
    const chained = "---\ntags: [java#collections]\n---\n\n#collections";
    expect(listedOnlyTags(readNote({ id: "n", markdown: chained }))).toEqual(["java"]);
    expect(listedOnlyTags(readNote({ id: "n", markdown: "---\ntags: [\n---\n" }))).toEqual([]);
  });

  it("drops the tag from the list by name, keeping the list's style", () => {
    expect(withoutTag(markdown, "java")).toBe("---\ntitle: T\ntags: [go, extra]\n---\n\nT #go");
    expect(withoutTag("---\ntags:\n- a\n---\n", "a")).toBe("---\n---\n");
    expect(withoutTag(markdown, "missing")).toBe(markdown);
  });

  it("splits a chain around the tag, so no new parent is made", () => {
    const listed = (tags: string) => `---\ntags: [${tags}]\n---\n`;
    expect(withoutTag(listed("Java#Collections"), "collections")).toBe(listed("Java"));
    expect(withoutTag(listed("Java#Collections"), "java")).toBe(listed("Collections"));
    expect(withoutTag(listed("a#b#c, c"), "b")).toBe(listed("a, c"));
    expect(withoutTag(listed("java#8"), "java")).toBe("---\n---\n");
  });
});

describe("withBody", () => {
  it("writes the body's title and tags into the frontmatter", () => {
    expect(withBody("", "# Java\n\nLists #java#collections and #go")).toBe(
      "---\ntitle: Java\ntags:\n  - java#collections\n  - go\n---\n\n# Java\n\nLists #java#collections and #go",
    );
  });

  it("keeps the title following the first line, and an author's own title", () => {
    const synced = "---\ntitle: Old\nx: 1\n---\n\n# Old\n";
    expect(withBody(synced, "# New\n")).toBe("---\ntitle: New\nx: 1\n---\n\n# New\n");
    expect(withBody(synced, "")).toBe("---\nx: 1\n---\n\n");

    const own = "---\ntitle: Mine\n---\n\n# Old\n";
    expect(withBody(own, "# New\n")).toBe("---\ntitle: Mine\n---\n\n# New\n");
  });

  it("drops tags removed from the body, keeping tags only listed in the frontmatter", () => {
    const markdown = "---\ntitle: T\ntags: [java, extra, Go]\n---\n\nT #java #go";

    expect(withBody(markdown, "T #go #rust")).toBe(
      "---\ntitle: T\ntags: [extra, Go, rust]\n---\n\nT #go #rust",
    );
  });

  it("changes nothing in the frontmatter when the body says the same", () => {
    const markdown = "---\n# mine\ntitle: T\ntags: java\n---\n\nT #java";

    expect(withBody(markdown, "T #java, more")).toBe(
      "---\n# mine\ntitle: T\ntags: java\n---\n\nT #java, more",
    );
  });

  it("only replaces the body of a document with invalid frontmatter", () => {
    expect(withBody("---\ntitle: [\n---\n\nOld", "# New #tag")).toBe(
      "---\ntitle: [\n---\n\n# New #tag",
    );
  });
});
