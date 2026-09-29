import {
  frontmatterTags,
  otherMetadata,
  InvalidDocumentError,
  documentTitle,
  formatTimestamp,
  isTimestamp,
  parseDocument,
  replaceBody,
  serializeDocument,
  setFrontmatterTags,
  updateMetadata,
  type MarkdownDocument,
} from "./document";

const example = `---
title: Java Collections
created: 2026-09-28T10:15:00Z
updated: 2026-09-28T10:15:00Z
cover: null
---

# Java Collections

ArrayList — dynamic array.

#java#collections

HashMap stores key/value pairs.
`;

const noMetadata = {
  title: null,
  created: null,
  updated: null,
  author: null,
  cover: null,
  conflictOf: null,
};

describe("parseDocument", () => {
  it("reads the metadata and body of the reference document", () => {
    expect(parseDocument(example)).toEqual({
      metadata: {
        title: "Java Collections",
        created: "2026-09-28T10:15:00Z",
        updated: "2026-09-28T10:15:00Z",
        author: null,
        cover: null,
        conflictOf: null,
      },
      body: "# Java Collections\n\nArrayList — dynamic array.\n\n#java#collections\n\nHashMap stores key/value pairs.\n",
    });
  });

  it.each([
    ["plain Markdown", "# Title\n\nText", "# Title\n\nText"],
    ["an empty document", "", ""],
    ["a leading thematic break without a closing delimiter", "---\nText", "---\nText"],
    ["a delimiter that is not on the first line", "\n---\na: 1\n---\n", "\n---\na: 1\n---\n"],
    ["a byte-order mark", "﻿# Title", "# Title"],
  ])("treats %s as body only", (_, markdown, body) => {
    expect(parseDocument(markdown)).toEqual({ metadata: noMetadata, body });
  });

  it.each([
    ["empty frontmatter", "---\n---\nBody", "Body"],
    ["a '...' closing delimiter", "---\ntitle: T\n...\nBody", "Body"],
    ["CRLF line endings", "---\r\ntitle: T\r\n---\r\n\r\nBody", "Body"],
    ["frontmatter with no body", "---\ntitle: T\n---", ""],
    ["no blank line after the delimiter", "---\ntitle: T\n---\nBody", "Body"],
    ["two blank lines after the delimiter", "---\ntitle: T\n---\n\n\nBody", "\nBody"],
  ])("handles %s", (_, markdown, body) => {
    expect(parseDocument(markdown).body).toBe(body);
  });

  it("accepts partial metadata, unknown keys and explicit nulls", () => {
    const document = parseDocument("---\ntitle: null\ntags: [a, b]\nupdated: 2026-09-28\n---\n");

    expect(document.metadata).toEqual({ ...noMetadata, updated: "2026-09-28" });
  });

  it("reads the dates spelled create_at and updated_at, preferring created and updated", () => {
    expect(
      parseDocument("---\ncreate_at: 2026-09-28\nupdated_at: 2026-09-29T10:00:00Z\n---\n").metadata,
    ).toEqual({ ...noMetadata, created: "2026-09-28", updated: "2026-09-29T10:00:00Z" });
    expect(
      parseDocument("---\ncreated: 2026-01-01\ncreate_at: 2026-02-02\nupdated_at: null\n---\n")
        .metadata.created,
    ).toBe("2026-01-01");
  });

  it("reads the author, and a list of authors as one text", () => {
    expect(parseDocument("---\nauthor: Ann\n---\n").metadata.author).toBe("Ann");
    expect(parseDocument("---\nauthor: [Ann, Bob]\n---\n").metadata.author).toBe("Ann, Bob");
  });

  it("keeps quoted values that look like other types as text", () => {
    expect(parseDocument('---\ntitle: "2024"\n---\n').metadata.title).toBe("2024");
  });

  it.each([
    ["invalid YAML", "---\ntitle: Java: Collections\n---\n", /not valid YAML/],
    ["duplicate keys", "---\ntitle: A\ntitle: B\n---\n", /not valid YAML/],
    ["a list instead of a mapping", "---\n- a\n---\n", /key: value pairs/],
    ["a scalar instead of a mapping", "---\njust text\n---\n", /key: value pairs/],
    ["a non-text title", "---\ntitle: 2024\n---\n", /"title" must be text/],
    ["a non-text cover", "---\ncover: [a]\n---\n", /"cover" must be text/],
    ["a non-text author", "---\nauthor: 7\n---\n", /"author" must be text/],
    ["an invalid create_at", "---\ncreate_at: yesterday\n---\n", /"create_at" must be an ISO/],
    ["a date that is not ISO 8601", "---\ncreated: 28.09.2026\n---\n", /"created" must be an ISO/],
    ["a date-time without a time zone", "---\nupdated: 2026-09-28T10:15:00\n---\n", /"updated"/],
    ["an impossible date", "---\ncreated: 2026-13-45\n---\n", /"created"/],
  ])("rejects %s", (_, markdown, message) => {
    expect(() => parseDocument(markdown)).toThrow(InvalidDocumentError);
    expect(() => parseDocument(markdown)).toThrow(message);
  });
});

describe("serializeDocument", () => {
  it("writes non-null metadata in canonical order, then a blank line and the body", () => {
    const markdown = serializeDocument({
      metadata: {
        cover: "images/cover.png",
        updated: "2026-09-29T08:00:00Z",
        created: "2026-09-28T10:15:00Z",
        title: "Java: Collections",
        author: "Ann",
        conflictOf: null,
      },
      body: "# Java\n",
    });

    expect(markdown).toBe(
      '---\ntitle: "Java: Collections"\ncreated: 2026-09-28T10:15:00Z\nupdated: 2026-09-29T08:00:00Z\nauthor: Ann\ncover: images/cover.png\n---\n\n# Java\n',
    );
  });

  it("omits null fields and writes just the body without metadata", () => {
    expect(serializeDocument({ metadata: noMetadata, body: "Text" })).toBe("Text");
    expect(serializeDocument({ metadata: { ...noMetadata, title: "T" }, body: "" })).toBe(
      "---\ntitle: T\n---\n\n",
    );
  });

  it("protects a body that would otherwise be read as frontmatter", () => {
    const body = "---\nnot: metadata\n---\n";

    expect(parseDocument(serializeDocument({ metadata: noMetadata, body })).body).toBe(body);
  });

  it.each<[string, MarkdownDocument]>([
    ["a full document", parseDocument(example)],
    ["a body only", { metadata: noMetadata, body: "# Hi\n" }],
    ["a body with leading blank lines", { metadata: { ...noMetadata, title: "T" }, body: "\n\nX" }],
    ["an empty document", { metadata: noMetadata, body: "" }],
    ["text needing quotes", { metadata: { ...noMetadata, title: "#1: yes # no" }, body: "" }],
  ])("round-trips %s", (_, document) => {
    expect(parseDocument(serializeDocument(document))).toEqual(document);
  });
});

describe("updateMetadata", () => {
  it("changes only the given fields and keeps comments, unknown keys and the body", () => {
    const markdown = "---\n# my notes\ntitle: Java\ntags: [a]\n---\n\nBody  \n";

    expect(updateMetadata(markdown, { updated: "2026-09-29T08:00:00Z" })).toBe(
      "---\n# my notes\ntitle: Java\ntags: [a]\nupdated: 2026-09-29T08:00:00Z\n---\n\nBody  \n",
    );
  });

  it("replaces existing values and removes fields set to null", () => {
    const markdown = "---\ntitle: Old\ncover: a.png\n---\nBody";

    expect(updateMetadata(markdown, { title: "New", cover: null })).toBe(
      "---\ntitle: New\n---\nBody",
    );
  });

  it("adds a canonical frontmatter block to a document without one", () => {
    expect(updateMetadata("# Title\n", { created: "2026-09-28T10:15:00Z" })).toBe(
      "---\ncreated: 2026-09-28T10:15:00Z\n---\n\n# Title\n",
    );
  });

  it("fills empty frontmatter", () => {
    expect(updateMetadata("---\n---\nBody", { title: "T" })).toBe("---\ntitle: T\n---\nBody");
  });

  it("leaves an empty block when the last field is removed", () => {
    expect(updateMetadata("---\ntitle: T\n---\nBody", { title: null })).toBe("---\n---\nBody");
  });

  it("writes a date under the spelling the document uses, and removes every spelling", () => {
    const markdown = "---\ncreate_at: 2026-01-01\nupdated_at: 2026-01-02\n---\n\nBody";

    expect(updateMetadata(markdown, { updated: "2026-09-29T10:00:00Z" })).toBe(
      "---\ncreate_at: 2026-01-01\nupdated_at: 2026-09-29T10:00:00Z\n---\n\nBody",
    );
    expect(updateMetadata(markdown, { created: null, updated: null })).toBe("---\n---\n\nBody");
  });

  it("keeps both spellings of a date in step when a document has both", () => {
    expect(
      updateMetadata("---\nupdated: 2026-01-01\nupdated_at: 2026-01-01\n---\n", {
        updated: "2026-09-29",
      }),
    ).toBe("---\nupdated: 2026-09-29\nupdated_at: 2026-09-29\n---\n");
  });

  it("sets and removes the author", () => {
    expect(updateMetadata("---\ntitle: T\nauthor: [Ann, Bob]\n---\nX", { author: "Eve" })).toBe(
      "---\ntitle: T\nauthor: Eve\n---\nX",
    );
    expect(updateMetadata("---\nauthor: Ann\n---\nX", { author: null })).toBe("---\n---\nX");
  });

  it("rejects invalid documents and invalid values", () => {
    expect(() => updateMetadata("---\ntitle: [\n---\n", { title: "T" })).toThrow(
      InvalidDocumentError,
    );
    expect(() => updateMetadata("Body", { created: "yesterday" })).toThrow(InvalidDocumentError);
  });
});

describe("documentTitle", () => {
  function titleOf(markdown: string) {
    return documentTitle(parseDocument(markdown));
  }

  it("prefers the frontmatter title", () => {
    expect(titleOf("---\ntitle: '  From metadata '\n---\n# From body")).toBe("From metadata");
  });

  it.each([
    ["# Java Collections\n\nBody", "Java Collections"],
    ["---\ntitle: '   '\n---\n# Blank title falls back", "Blank title falls back"],
    ["\n\n  Plain first line  \nsecond", "Plain first line"],
    ["### Closed heading ###", "Closed heading"],
    ["# C#", "C#"],
    ["#java#collections", "#java#collections"],
    ["#\nBody", ""],
    ["", ""],
    ["---\ncreated: 2026-09-28\n---\n", ""],
  ])("derives %j as %j", (markdown, title) => {
    expect(titleOf(markdown)).toBe(title);
  });
});

describe("timestamps", () => {
  it("formats with second precision in UTC", () => {
    expect(formatTimestamp(new Date("2026-09-28T10:15:00.789Z"))).toBe("2026-09-28T10:15:00Z");
  });

  it.each([
    ["2026-09-28", true],
    ["2026-09-28T10:15Z", true],
    ["2026-09-28T10:15:00.5+02:00", true],
    ["2026-09-28T10:15:00", false],
    ["September 28", false],
    ["2026-02-30", false],
  ])("isTimestamp(%j) is %s", (value, expected) => {
    expect(isTimestamp(value)).toBe(expected);
  });
});

describe("replaceBody", () => {
  it("keeps the frontmatter block byte for byte", () => {
    const markdown = "---\n# comment\ntitle: T\n...\n\nOld body\n";

    expect(replaceBody(markdown, "New body")).toBe("---\n# comment\ntitle: T\n...\n\nNew body");
  });

  it("keeps a missing blank line missing", () => {
    expect(replaceBody("---\ntitle: T\n---\nOld", "New")).toBe("---\ntitle: T\n---\nNew");
  });

  it("returns just the body when there is no frontmatter", () => {
    expect(replaceBody("Old", "New")).toBe("New");
  });

  it("protects a new body that would read as frontmatter", () => {
    const body = "---\na: 1\n---\n";

    expect(parseDocument(replaceBody("Old", body)).body).toBe(body);
  });
});

describe("conflict_of", () => {
  it("reads, writes and removes the conflict_of key", () => {
    const markdown = updateMetadata("Body", { conflictOf: "n1" });

    expect(markdown).toBe("---\nconflict_of: n1\n---\n\nBody");
    expect(parseDocument(markdown).metadata.conflictOf).toBe("n1");
    expect(updateMetadata(markdown, { conflictOf: null })).toBe("---\n---\n\nBody");
  });
});

describe("otherMetadata", () => {
  it("lists the fields Konspecter does not manage, as text", () => {
    const markdown =
      "---\ntitle: T\nauthor: Ann\ntags: [a, b]\nupdated_at: 2026-01-01\ndraft: true\nempty: null\n---\nBody";
    // Tags are the note's tags, not another field.
    expect(otherMetadata(markdown)).toEqual([{ key: "draft", value: "true" }]);
  });

  it("is empty without valid frontmatter", () => {
    expect(otherMetadata("Body")).toEqual([]);
    expect(otherMetadata("---\ntitle: [\n---\nBody")).toEqual([]);
  });
});

describe("frontmatterTags", () => {
  it("reads a list of tags, with or without a leading #", () => {
    expect(
      frontmatterTags('---\ntags:\n  - parent_1#child\n  - parent_2\n  - "#Java"\n---\nBody'),
    ).toEqual(["parent_1#child", "parent_2", "Java"]);
  });

  it("reads one string of tags separated by spaces or commas", () => {
    expect(frontmatterTags("---\ntags: java, go rust\n---\n")).toEqual(["java", "go", "rust"]);
  });

  it("is empty without the field or valid frontmatter", () => {
    expect(frontmatterTags("---\ntitle: T\n---\n#body")).toEqual([]);
    expect(frontmatterTags("#body")).toEqual([]);
    expect(frontmatterTags("---\ntags: [\n---\n")).toEqual([]);
  });
});

describe("setFrontmatterTags", () => {
  it("writes the tags as a list and keeps everything else as written", () => {
    expect(
      setFrontmatterTags("---\n# mine\ntitle: T\ntags: java, go\nx: 1\n---\n\n# Body #inline\n", [
        "java",
        "parent#child",
      ]),
    ).toBe(
      "---\n# mine\ntitle: T\ntags:\n  - java\n  - parent#child\nx: 1\n---\n\n# Body #inline\n",
    );
  });

  it("keeps a flow-style list in flow style", () => {
    expect(setFrontmatterTags("---\ntags: [a, b]\n---\nBody", ["a"])).toBe(
      "---\ntags: [a]\n---\nBody",
    );
  });

  it("adds frontmatter to a document without one, and removes the field when empty", () => {
    expect(setFrontmatterTags("# Body", ["java"])).toBe("---\ntags:\n  - java\n---\n\n# Body");
    expect(setFrontmatterTags("---\ntitle: T\ntags: [a]\n---\nBody", [])).toBe(
      "---\ntitle: T\n---\nBody",
    );
    expect(setFrontmatterTags("# Body", [])).toBe("# Body");
  });

  it("round-trips through frontmatterTags", () => {
    const tags = ["Java#Collections", "go", "c-sharp"];
    expect(frontmatterTags(setFrontmatterTags("Body", tags))).toEqual(tags);
  });

  it("rejects an invalid document", () => {
    expect(() => setFrontmatterTags("---\ntitle: [\n---\n", ["a"])).toThrow(InvalidDocumentError);
  });
});
