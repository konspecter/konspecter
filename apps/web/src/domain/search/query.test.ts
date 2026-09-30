import { joinQuery, queryParts, takeTags, isEmptyQuery, parseQuery, withoutTag } from "./query";

const tagNames = (input: string) => parseQuery(input).tags.map((tag) => tag.name);

describe("parseQuery", () => {
  it("separates words from tag filters", () => {
    const query = parseQuery("hashmap #java  buckets");

    expect(query.words).toEqual(["hashmap", "buckets"]);
    expect(query.tags.map((tag) => tag.name)).toEqual(["java"]);
  });

  it("reads a chain as a filter per tag, with or without a leading hash", () => {
    expect(tagNames("#java#collections java#streams")).toEqual(["java", "collections", "streams"]);
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
    expect(withoutTag("hashmap #Java  #go java", { name: "java" })).toBe("hashmap #go java");
  });

  it("keeps the other tags of a chain that selects it", () => {
    expect(withoutTag("#java#collections#maps x", { name: "collections" })).toBe("#java #maps x");
  });
});

describe("query parts", () => {
  const names = (parts: { tags: readonly { name: string }[]; text: string }) => [
    parts.tags.map((tag) => tag.name),
    parts.text,
  ];

  it("splits a query into its tag filters and the other words", () => {
    expect(names(queryParts("hash #java  maps #java#collections"))).toEqual([
      ["java", "collections"],
      "hash maps",
    ]);
  });

  it("takes only the tags written in full while typing", () => {
    expect(names(takeTags("#java hash"))).toEqual([["java"], "hash"]);
    expect(names(takeTags("hash #jav"))).toEqual([[], "hash #jav"]);
    expect(names(takeTags("hash #java "))).toEqual([["java"], "hash "]);
    expect(names(takeTags("#123 x"))).toEqual([[], "#123 x"]);
  });

  it("joins tags and text back into a query", () => {
    const { tags } = queryParts("#java #go");
    expect(joinQuery(tags, "hash ")).toBe("#java #go hash ");
    expect(joinQuery([], "")).toBe("");
  });
});
