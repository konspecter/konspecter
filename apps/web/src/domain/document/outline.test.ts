import { describe, expect, it } from "vitest";
import { documentHeadings, outlineTree, type Heading, type OutlineNode } from "./outline";

/** The tree as indented text lines, for readable expectations. */
function lines(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap(({ heading, children }) => [
    `${"  ".repeat(depth)}${heading.text}`,
    ...lines(children, depth + 1),
  ]);
}

function headings(...levels: (1 | 2 | 3)[]): Heading[] {
  return levels.map((level, index) => ({ level, text: `h${String(index)}`, line: index, index }));
}

describe("documentHeadings", () => {
  it("reads ATX and setext headings up to h3, with their lines and places", () => {
    const body = [
      "# Java *Collections*",
      "",
      "Intro.",
      "",
      "Maps",
      "----",
      "",
      "### `HashMap` ###",
      "#### Too deep",
      "## Lists",
    ].join("\n");

    expect(documentHeadings(body)).toEqual([
      { level: 1, text: "Java Collections", line: 0, index: 0 },
      { level: 2, text: "Maps", line: 4, index: 1 },
      { level: 3, text: "HashMap", line: 7, index: 2 },
      { level: 2, text: "Lists", line: 9, index: 3 },
    ]);
  });

  it("ignores headings in code, finds them in lists and quotes, counts empty ones", () => {
    const body = [
      "```md",
      "# Not a heading",
      "```",
      "",
      "    # Indented code",
      "",
      "- ## In a list",
      "",
      "> ### In a quote",
      "",
      "##",
      "#hashtag is a tag",
    ].join("\n");

    expect(documentHeadings(body)).toEqual([
      { level: 2, text: "In a list", line: 6, index: 0 },
      { level: 3, text: "In a quote", line: 8, index: 1 },
      { level: 2, text: "", line: 10, index: 2 },
    ]);
  });

  it("is empty for a body without headings", () => {
    expect(documentHeadings("")).toEqual([]);
    expect(documentHeadings("Just text.\n\n- a list")).toEqual([]);
  });
});

describe("outlineTree", () => {
  it("nests each heading under the nearest higher one before it", () => {
    expect(lines(outlineTree(headings(1, 2, 3, 3, 2, 1, 2)))).toEqual([
      "h0",
      "  h1",
      "    h2",
      "    h3",
      "  h4",
      "h5",
      "  h6",
    ]);
  });

  it("keeps a body that starts deeper or skips a level", () => {
    expect(lines(outlineTree(headings(2, 3, 1, 3, 2)))).toEqual([
      "h0",
      "  h1",
      "h2",
      "  h3",
      "  h4",
    ]);
  });
});
