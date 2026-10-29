import type { Node } from "prosemirror-model";
import { markdownToTextDoc, textDocToMarkdown } from "./text-markdown";
import { textSchema } from "./text-schema";

const {
  doc,
  paragraph,
  bullet_list: bullets,
  ordered_list: numbers,
  list_item: item,
} = textSchema.nodes;
const text = (value: string) => paragraph.create(null, value ? textSchema.text(value) : null);
const task = (value: string, children: Node[] = []) =>
  item.create({ checked: false }, [text(value), ...children]);
const plain = (value: string) => item.create(null, text(value));
const blank = () => paragraph.create();

function roundTrip(markdown: string): string {
  const content = markdownToTextDoc(markdown);
  if (!content.supported) throw new Error(content.reason);
  return textDocToMarkdown(content.doc);
}

describe("text editor Markdown conversion", () => {
  it.each([
    ["headings and inline marks", "# Title\n\nText *em* **strong** `code`"],
    ["lists", "- a\n- b\n\n1. one\n2. two"],
    ["loose and nested lists", "- a\n\n- b\n  - c"],
    ["ordered list starts", "3. three\n4. four"],
    ["block quotes", "> quoted"],
    ["fenced code", "```java\nint x = a_b * c;\n```"],
    ["links and images", '[x](https://a.com "T") ![alt](a.png)'],
    ["thematic breaks and hard breaks", "a  \nb\n\n---\n\nc"],
    ["characters that need escaping", "a_b * c [not a link]"],
    ["bare URLs", "see https://example.com/a_b"],
    ["tags", "#java#collections"],
    ["tags with underscores in any script", "#новые_технологии #linked_list"],
    ["an empty body", ""],
    ["task lists", "- [ ] todo\n- [x] done\n- plain"],
    ["nested and numbered task lists", "1. [X] one\n   - [ ] inner\n2. [ ]"],
    ["task-like text that is no task", "- \\[ ] escaped\n- [y] other\n\n[ ] not in a list"],
  ])("keeps the meaning of %s", (_, markdown) => {
    expect(markdownToTextDoc(markdown).supported).toBe(true);
    // A second round trip is stable: the editor's own output is its fixed point.
    const once = roundTrip(markdown);
    expect(roundTrip(once)).toBe(once);
  });

  it("writes underscores inside words of any script as they are", () => {
    expect(roundTrip("#новые_технологии and a_b")).toBe("#новые_технологии and a_b");
    expect(roundTrip("_emphasis_ and snake\\_case")).toBe("*emphasis* and snake_case");
  });

  it("reads task list items and writes their markers after the bullet", () => {
    const content = markdownToTextDoc("- [ ] todo\n- [x] *done*\n- plain");
    if (!content.supported) throw new Error(content.reason);
    const items: unknown[] = [];
    content.doc.descendants((node) => {
      if (node.type.name === "list_item") items.push([node.attrs.checked, node.textContent]);
    });

    expect(items).toEqual([
      [false, "todo"],
      [true, "done"],
      [null, "plain"],
    ]);
    expect(textDocToMarkdown(content.doc)).toBe("* [ ] todo\n* [x] *done*\n* plain");
  });

  it.each([
    [
      "only blank lines between them",
      [
        bullets.create({ tight: true }, task("a")),
        blank(),
        bullets.create({ tight: true }, task("b")),
      ],
      "* [ ] a\n* [ ] b",
    ],
    [
      "nothing between them",
      [bullets.create({ tight: true }, task("z")), bullets.create({ tight: true }, task("a"))],
      "* [ ] z\n* [ ] a",
    ],
    [
      "numbers, from the first one's",
      [
        numbers.create({ order: 3, tight: true }, plain("c")),
        blank(),
        blank(),
        numbers.create({ tight: true }, plain("d")),
      ],
      "3. c\n4. d",
    ],
    [
      "a loose part, all loose",
      [bullets.create({ tight: true }, plain("a")), bullets.create({ tight: false }, plain("b"))],
      "* a\n\n* b",
    ],
    [
      "nested in an item",
      [
        bullets.create(
          { tight: true },
          item.create(null, [
            text("a"),
            bullets.create({ tight: true }, plain("b")),
            blank(),
            bullets.create({ tight: true }, plain("c")),
          ]),
        ),
      ],
      "* a\n  * b\n  * c",
    ],
  ])("writes lists of a kind with %s as one list", (_, blocks, markdown) => {
    // Markdown reads them so: two such lists, or blank lines in a list, make one loose list.
    expect(textDocToMarkdown(doc.create(null, blocks))).toBe(markdown);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps lists apart that differ in kind or have text between them", () => {
    const blocks = [
      bullets.create({ tight: true }, task("a")),
      blank(),
      numbers.create({ tight: true }, plain("b")),
      text("text"),
      numbers.create({ tight: true }, plain("c")),
    ];
    expect(textDocToMarkdown(doc.create(null, blocks))).toBe("* [ ] a\n\n1. b\n\ntext\n\n1. c");
  });

  it("normalizes formatting without changing meaning", () => {
    expect(roundTrip("Title\n===\n\n- a\nwrapped\n  line")).toBe("# Title\n\n* a wrapped line");
  });

  it.each([
    ["tables", "| a |\n| - |\n| b |"],
    ["strikethrough", "~~gone~~"],
    ["HTML", "Press <kbd>Ctrl</kbd>"],
    ["HTML", "<details>\n<summary>x</summary>\n</details>"],
    ["footnotes", "Claim[^1]\n\n[^1]: Source"],
  ])("declines notes with %s", (feature, markdown) => {
    const content = markdownToTextDoc(markdown);

    expect(content.supported).toBe(false);
    expect(!content.supported && content.reason).toContain(feature);
  });
});
