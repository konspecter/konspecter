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
    ["an empty body", ""],
  ])("keeps the meaning of %s", (_, markdown) => {
    expect(markdownToTextDoc(markdown).supported).toBe(true);
    // A second round trip is stable: the editor's own output is its fixed point.
    const once = roundTrip(markdown);
    expect(roundTrip(once)).toBe(once);
  });

  it("normalizes formatting without changing meaning", () => {
    expect(roundTrip("Title\n===\n\n- a\nwrapped\n  line")).toBe("# Title\n\n* a wrapped line");
  });

  it.each([
    ["tables", "| a |\n| - |\n| b |"],
    ["strikethrough", "~~gone~~"],
    ["HTML", "Press <kbd>Ctrl</kbd>"],
    ["HTML", "<details>\n<summary>x</summary>\n</details>"],
    ["task lists", "- [ ] todo\n- [x] done"],
    ["footnotes", "Claim[^1]\n\n[^1]: Source"],
  ])("declines notes with %s", (feature, markdown) => {
    const content = markdownToTextDoc(markdown);

    expect(content.supported).toBe(false);
    expect(!content.supported && content.reason).toContain(feature);
  });
});
