import { markdownToTextDoc, textDocToMarkdown } from "./text-markdown";

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
