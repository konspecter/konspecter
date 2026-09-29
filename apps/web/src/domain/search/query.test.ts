import { isEmptyQuery, parseQuery, withoutTag } from "./query";
import { parseTagName, type Tag } from "../tag/tags";

const tagNames = (input: string) => parseQuery(input).tags.map((tag) => tag.name);

describe("parseQuery", () => {
  it("separates words from tag filters", () => {
    const query = parseQuery("hashmap #java  buckets");

    expect(query.words).toEqual(["hashmap", "buckets"]);
    expect(query.tags.map((tag) => tag.name)).toEqual(["java"]);
  });

  it("reads hierarchical tags with or without a leading hash", () => {
    expect(tagNames("#java#collections java#streams")).toEqual([
      "java#collections",
      "java#streams",
    ]);
  });

  it("treats a plain word as a word, even if a tag has that name", () => {
    expect(parseQuery("java").words).toEqual(["java"]);
    expect(parseQuery("java").tags).toEqual([]);
  });

  it("searches invalid tags as text", () => {
    expect(parseQuery("# #123 C#")).toEqual({ words: ["123", "C#"], tags: [] });
  });

  it("normalizes and deduplicates tags", () => {
    expect(tagNames("#Java #java")).toEqual(["java"]);
  });

  it("recognizes an empty query", () => {
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("#go"))).toBe(false);
  });
});

describe("withoutTag", () => {
  it("removes the tokens that select a tag and keeps the rest", () => {
    const java = parseTagName("java") as Tag;
    expect(withoutTag("hashmap #Java  #go java", java)).toBe("hashmap #go java");
  });
});
