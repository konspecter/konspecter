import { documentStats } from "./stats";

describe("documentStats", () => {
  it("counts words and characters of the readable text, not the markup", () => {
    expect(
      documentStats("# Hash maps\n\n**Buckets** and [links](https://x.y), don't — Новые слова"),
    ).toEqual({
      words: 8,
      characters: 47,
      readingMinutes: 1,
    });
  });

  it("is zero for an empty body", () => {
    expect(documentStats("")).toEqual({ words: 0, characters: 0, readingMinutes: 0 });
  });

  it("estimates reading time at 200 words a minute", () => {
    expect(documentStats("word ".repeat(1000)).readingMinutes).toBe(5);
  });
});
