import { highlight, snippet, type SnippetPart } from "./snippet";

const render = (parts: readonly SnippetPart[]) =>
  parts.map((part) => (part.match ? `[${part.text}]` : part.text)).join("");

describe("snippet", () => {
  it("highlights matches by word prefix, case-insensitively", () => {
    expect(render(snippet("HashMap stores keys. A hash is fast.", ["hash"]))).toBe(
      "[HashMap] stores keys. A [hash] is fast.",
    );
  });

  it("does not match inside words", () => {
    expect(render(snippet("rehash the map", ["hash"]))).toBe("rehash the map");
  });

  it("centres on the first match in long text, cut at word boundaries", () => {
    const text = `${"lorem ipsum ".repeat(40)}needle ${"dolor sit ".repeat(40)}`;
    const result = render(snippet(text, ["needle"], 60));

    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toContain("[needle]");
    expect(result.length).toBeLessThanOrEqual(64);
  });

  it("returns the start of the text when nothing matches", () => {
    expect(render(snippet("Short note.", ["zzz"]))).toBe("Short note.");
    expect(render(snippet("Short\n\nnote.", []))).toBe("Short note.");
  });

  it("treats terms as literal text", () => {
    expect(render(snippet("a.b and axb", ["a.b"]))).toBe("[a.b] and axb");
  });
});

describe("highlight", () => {
  it("marks every match in the whole text, keeping the rest as written", () => {
    expect(render(highlight("Hash maps and  hashing", ["hash"]))).toBe(
      "[Hash] maps and  [hashing]",
    );
  });

  it("matches Cyrillic words by prefix, case-insensitively", () => {
    expect(render(highlight("Конспект о хеш-таблицах. Хеш — это", ["хеш"]))).toBe(
      "Конспект о [хеш]-таблицах. [Хеш] — это",
    );
    expect(render(highlight("Конспекты", ["конс"]))).toBe("[Конспекты]");
  });

  it("returns the text unmarked without terms", () => {
    expect(highlight("Plain", [])).toEqual([{ text: "Plain", match: false }]);
    expect(highlight("", ["x"])).toEqual([]);
  });
});
