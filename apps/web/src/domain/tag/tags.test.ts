import {
  isWithin,
  parseTagName,
  parseTags,
  tagLabel,
  tagRanges,
  tagSpellings,
  tagTree,
  tagWithAncestors,
  writtenTags,
  type Tag,
  type TagNode,
} from "./tags";

const names = (markdown: string) => parseTags(markdown).map((tag) => tag.name);

describe("parseTags", () => {
  it("reads a single tag", () => {
    expect(parseTags("#java")).toEqual([{ path: ["java"], name: "java" }]);
  });

  it("reads a hierarchical tag as one path", () => {
    expect(parseTags("#java#getting-started")).toEqual([
      { path: ["java", "getting-started"], name: "java#getting-started" },
    ]);
  });

  it("reads space-separated tags as independent tags", () => {
    expect(names("#java #getting-started")).toEqual(["java", "getting-started"]);
  });

  it("finds tags anywhere, deduplicated in order of first appearance", () => {
    const markdown = [
      "Java supports several collection implementations.",
      "",
      "#java",
      "",
      "ArrayList is commonly used, see #java#collections and (#tips).",
      "",
      "- item with #lists",
      "> quoted #quote",
      "",
      "| col |",
      "| --- |",
      "| #in-table |",
      "",
      "#java again",
    ].join("\n");

    expect(names(markdown)).toEqual([
      "java",
      "java#collections",
      "tips",
      "lists",
      "quote",
      "in-table",
    ]);
  });

  it("does not treat Markdown headings as tags", () => {
    expect(names("# Java Collections\n\n## Section\n\n###### Deep")).toEqual([]);
  });

  it("finds tags inside heading text", () => {
    expect(names("# Java #tips")).toEqual(["tips"]);
  });

  it("is case-insensitive and supports non-Latin letters", () => {
    expect(names("#Java #JAVA #заметки #日本語 #snake_case")).toEqual([
      "java",
      "заметки",
      "日本語",
      "snake_case",
    ]);
  });

  it.each([
    ["C#", "C# and F# are languages"],
    ["words joined by #", "foo#bar"],
    ["a double hash", "##java"],
    ["an all-digit tag", "issue #123 and #2024"],
    ["a lone hash", "# and #"],
    ["inline code", "`#notatag`"],
    ["fenced code", "```\n#include <stdio.h>\n```"],
    ["indented code", "    #comment"],
    ["HTML", '<span data-x="#nope">text</span>'],
    ["a URL fragment", "https://example.com/page#section"],
    ["an autolink", "<https://example.com/#anchor>"],
    ["a link destination", "[docs](https://example.com/#anchor)"],
    ["an escaped hash", "\\#notatag"],
    ["image alt text", "![#alt](a.png)"],
  ])("ignores %s", (_, markdown) => {
    expect(names(markdown)).toEqual([]);
  });

  it("keeps tags in link text", () => {
    expect(names("[#java docs](https://example.com)")).toEqual(["java"]);
  });

  it("ends a tag at punctuation and ignores a trailing hash", () => {
    expect(names("#java. #kotlin, #scala! #go# #rust:")).toEqual([
      "java",
      "kotlin",
      "scala",
      "go",
      "rust",
    ]);
  });

  it("allows digits after the first segment", () => {
    expect(names("#java#8 #web3")).toEqual(["java#8", "web3"]);
  });

  it("is deterministic", () => {
    const markdown = "#b #a #b#c #a";
    expect(parseTags(markdown)).toEqual(parseTags(markdown));
  });
});

describe("tag helpers", () => {
  const tag = (name: string) => parseTagName(name) as Tag;

  it("parses tag names typed with or without the hash", () => {
    expect(parseTagName("#Java#Collections")).toEqual({
      path: ["java", "collections"],
      name: "java#collections",
    });
    expect(parseTagName("java")).toEqual({ path: ["java"], name: "java" });
    expect(parseTagName("not a tag")).toBeNull();
    expect(parseTagName("123")).toBeNull();
    expect(parseTagName("")).toBeNull();
  });

  it("expands a tag into itself and its ancestors", () => {
    expect(tagWithAncestors(tag("java#collections#maps")).map((t) => t.name)).toEqual([
      "java",
      "java#collections",
      "java#collections#maps",
    ]);
  });

  it("checks whether a tag is within another", () => {
    expect(isWithin(tag("java#collections"), tag("java"))).toBe(true);
    expect(isWithin(tag("java"), tag("java"))).toBe(true);
    expect(isWithin(tag("java"), tag("java#collections"))).toBe(false);
    expect(isWithin(tag("javascript"), tag("java"))).toBe(false);
  });
});

describe("tagTree", () => {
  const count = (name: string, n: number) => ({ tag: parseTagName(name) as Tag, count: n });

  it("nests tags under their parents, sorted by name", () => {
    const tree = tagTree([
      count("java#streams", 1),
      count("go", 2),
      count("java", 3),
      count("java#collections", 2),
      count("java#collections#maps", 1),
    ]);

    const shape = (nodes: readonly TagNode[]): unknown[] =>
      nodes.map((node) => [node.label, node.count, shape(node.children)]);
    expect(shape(tree)).toEqual([
      ["go", 2, []],
      [
        "java",
        3,
        [
          ["collections", 2, [["maps", 1, []]]],
          ["streams", 1, []],
        ],
      ],
    ]);
  });

  it("labels each tag with its spelling's last segment", () => {
    const tree = tagTree([
      { ...count("java", 2), spelling: "Java" },
      { ...count("java#linked_list", 1), spelling: "Java#Linked_List" },
      count("go", 1),
    ]);
    expect(tree.map((node) => node.label)).toEqual(["go", "Java"]);
    expect(tree[1]?.children.map((node) => node.label)).toEqual(["Linked List"]);
  });

  it("capitalizes every label on request", () => {
    const tree = tagTree([count("java", 1), count("java#streams", 1)], { capitalize: true });
    expect(tree.map((node) => node.label)).toEqual(["Java"]);
    expect(tree[0]?.children.map((node) => node.label)).toEqual(["Streams"]);
  });

  it("makes a tag without a known parent a root", () => {
    expect(tagTree([count("a#b", 1)]).map((node) => node.tag.name)).toEqual(["a#b"]);
  });

  it("is empty for no tags", () => {
    expect(tagTree([])).toEqual([]);
  });
});

describe("writtenTags", () => {
  it("keeps the case of each tag's first spelling, in the order of parseTags", () => {
    expect(writtenTags("#Java#Linked_List and #java#linked_list, #GO")).toEqual([
      "Java#Linked_List",
      "GO",
    ]);
    expect(names("#Java#Linked_List and #java#linked_list, #GO")).toEqual([
      "java#linked_list",
      "go",
    ]);
  });
});

describe("tagLabel", () => {
  it("shows the last segment, case kept, with underscores as spaces", () => {
    expect(tagLabel("Java#Linked_List")).toBe("Linked List");
    expect(tagLabel("getting-started")).toBe("getting-started");
    expect(tagLabel("новые_технологии", true)).toBe("Новые технологии");
    expect(tagLabel("Java#iOS", true)).toBe("IOS");
  });
});

describe("tagSpellings", () => {
  it("spells each tag and its ancestors as the notes write them", () => {
    const spellings = tagSpellings([["Java#Streams"], ["Go"]]);
    expect(Object.fromEntries(spellings)).toEqual({
      java: "Java",
      "java#streams": "Java#Streams",
      go: "Go",
    });
  });

  it("takes the spelling most notes use, and capitals on a tie", () => {
    expect(tagSpellings([["java"], ["java"], ["Java"]]).get("java")).toBe("java");
    expect(tagSpellings([["java"], ["Java"]]).get("java")).toBe("Java");
    expect(tagSpellings([["Java#x", "java"], ["java"]]).get("java")).toBe("java");
  });
});

describe("tagRanges", () => {
  it("finds tags in plain text with the same rules as parseTags", () => {
    const text = "See #java#streams, C#, #123 and (#новые_технологии).";
    expect(tagRanges(text).map(({ from, to }) => text.slice(from, to))).toEqual([
      "#java#streams",
      "#новые_технологии",
    ]);
  });
});
