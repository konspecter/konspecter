import {
  chainLinks,
  parseTagChain,
  parseTags,
  tagLabel,
  tagRanges,
  tagSpellings,
  tagTree,
  tagTreeContains,
  writtenTagList,
  writtenTags,
  type TagChain,
  type TagNode,
} from "./tags";

const names = (markdown: string) => parseTags(markdown).map((tag) => tag.name);

describe("parseTags", () => {
  it("reads a single tag", () => {
    expect(parseTags("#java")).toEqual([{ name: "java" }]);
  });

  it("reads a chain as its separate tags", () => {
    expect(parseTags("#java#getting-started")).toEqual([
      { name: "java" },
      { name: "getting-started" },
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

    expect(names(markdown)).toEqual(["java", "collections", "tips", "lists", "quote", "in-table"]);
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
    expect(names("#java#8 #web3")).toEqual(["java", "8", "web3"]);
  });

  it("is deterministic", () => {
    const markdown = "#b #a #b#c #a";
    expect(parseTags(markdown)).toEqual(parseTags(markdown));
  });
});

describe("tag chains", () => {
  const chain = (written: string) => parseTagChain(written) as TagChain;

  it("parses chains typed with or without the hash", () => {
    expect(parseTagChain("#Java#Collections")).toEqual({
      tags: [{ name: "java" }, { name: "collections" }],
      name: "java#collections",
    });
    expect(parseTagChain("java")).toEqual({ tags: [{ name: "java" }], name: "java" });
    expect(parseTagChain("not a tag")).toBeNull();
    expect(parseTagChain("123")).toBeNull();
    expect(parseTagChain("")).toBeNull();
  });

  it("links each tag of a chain to the next, never to itself", () => {
    expect(chainLinks(chain("java#collections#maps"))).toEqual([
      ["java", "collections"],
      ["collections", "maps"],
    ]);
    expect(chainLinks(chain("java"))).toEqual([]);
    expect(chainLinks(chain("a#a#b"))).toEqual([["a", "b"]]);
  });

  it("lists the tags of chains once, with their first spelling", () => {
    expect(writtenTagList(["Java#Collections", "java#Streams", "go", "2024"])).toEqual([
      { tag: { name: "java" }, written: "Java" },
      { tag: { name: "collections" }, written: "Collections" },
      { tag: { name: "streams" }, written: "Streams" },
      { tag: { name: "go" }, written: "go" },
    ]);
  });
});

describe("tagTree", () => {
  const count = (name: string, n: number, parents: string[] = []) => ({
    tag: { name },
    count: n,
    parents,
  });
  const shape = (nodes: readonly TagNode[]): unknown[] =>
    nodes.map((node) => [node.label, node.count, shape(node.children)]);

  it("nests tags under their parents, sorted by name", () => {
    const tree = tagTree([
      count("streams", 1, ["java"]),
      count("go", 2),
      count("java", 3),
      count("collections", 2, ["java"]),
      count("maps", 1, ["collections"]),
    ]);

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

  it("shows a tag under each of its parents, never as a root", () => {
    const tree = tagTree([
      count("java", 2),
      count("python", 1),
      count("collections", 3, ["java", "python"]),
    ]);
    expect(shape(tree)).toEqual([
      ["java", 2, [["collections", 3, []]]],
      ["python", 1, [["collections", 3, []]]],
    ]);
  });

  it("gives a cycle one root, the first by name, and stops before repeating a tag", () => {
    const tree = tagTree([count("b", 1, ["a"]), count("a", 1, ["b"]), count("c", 1, ["c"])]);
    expect(shape(tree)).toEqual([
      ["a", 1, [["b", 1, []]]],
      ["c", 1, []],
    ]);
  });

  it("ignores parents that are not tags", () => {
    expect(shape(tagTree([count("b", 1, ["a"])]))).toEqual([["b", 1, []]]);
  });

  it("labels each tag with its spelling", () => {
    const tree = tagTree([
      { ...count("java", 2), spelling: "Java" },
      { ...count("linked_list", 1, ["java"]), spelling: "Linked_List" },
      count("go", 1),
    ]);
    expect(tree.map((node) => node.label)).toEqual(["go", "Java"]);
    expect(tree[1]?.children.map((node) => node.label)).toEqual(["Linked List"]);
  });

  it("capitalizes every label on request", () => {
    const tree = tagTree([count("java", 1), count("streams", 1, ["java"])], {
      capitalize: true,
    });
    expect(tree.map((node) => node.label)).toEqual(["Java"]);
    expect(tree[0]?.children.map((node) => node.label)).toEqual(["Streams"]);
  });

  it("finds a tag anywhere below a node", () => {
    const [java] = tagTree([
      count("java", 1),
      count("collections", 1, ["java"]),
      count("maps", 1, ["collections"]),
    ]);
    expect(java && tagTreeContains(java, "maps")).toBe(true);
    expect(java && tagTreeContains(java, "java")).toBe(false);
  });

  it("is empty for no tags", () => {
    expect(tagTree([])).toEqual([]);
  });
});

describe("writtenTags", () => {
  it("keeps the case of each chain's first spelling, each chain once", () => {
    expect(writtenTags("#Java#Linked_List and #java#linked_list, #GO")).toEqual([
      "Java#Linked_List",
      "GO",
    ]);
    expect(names("#Java#Linked_List and #java#linked_list, #GO")).toEqual([
      "java",
      "linked_list",
      "go",
    ]);
  });
});

describe("tagLabel", () => {
  it("keeps the case, with underscores as spaces", () => {
    expect(tagLabel("Linked_List")).toBe("Linked List");
    expect(tagLabel("getting-started")).toBe("getting-started");
    expect(tagLabel("новые_технологии", true)).toBe("Новые технологии");
    expect(tagLabel("iOS", true)).toBe("IOS");
  });
});

describe("tagSpellings", () => {
  it("spells each tag of a chain as the notes write it", () => {
    const spellings = tagSpellings([["Java#Streams"], ["Go"]]);
    expect(Object.fromEntries(spellings)).toEqual({
      java: "Java",
      streams: "Streams",
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
