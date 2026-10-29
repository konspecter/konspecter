import { knownTags, suggestTags, typedTag } from "./tag-suggestions";

describe("typedTag", () => {
  it("finds the name typed after a #", () => {
    expect(typedTag("Read #ja", "")).toEqual({ start: 6, prefix: "ja" });
    expect(typedTag("#j", " and more")).toEqual({ start: 1, prefix: "j" });
    expect(typedTag("(#новые", ")")).toEqual({ start: 2, prefix: "новые" });
  });

  it("completes the last name of a chain", () => {
    expect(typedTag("#java#co", "")).toEqual({ start: 6, prefix: "co" });
  });

  it("needs a character after the #, and the tag rules", () => {
    expect(typedTag("Read #", "")).toBeNull();
    expect(typedTag("C#", "")).toBeNull();
    expect(typedTag("foo#bar", "")).toBeNull();
    expect(typedTag("##ja", "")).toBeNull();
    expect(typedTag("# Heading", "")).toBeNull();
  });

  it("is not inside a word", () => {
    expect(typedTag("#ja", "va")).toBeNull();
    expect(typedTag("#ja", "#x")).toBeNull();
    expect(typedTag("#ja", ".")).toEqual({ start: 1, prefix: "ja" });
  });
});

describe("knownTags", () => {
  it("counts each tag once per note, with its most used spelling", () => {
    expect(knownTags([["Java", "maps"], ["java"], ["Java", "JAVA"]])).toEqual([
      { name: "java", spelling: "Java", count: 3 },
      { name: "maps", spelling: "maps", count: 1 },
    ]);
  });
});

describe("suggestTags", () => {
  const known = [
    { name: "javascript", spelling: "JavaScript", count: 5 },
    { name: "java", spelling: "Java", count: 2 },
    { name: "jvm", spelling: "jvm", count: 9 },
    { name: "kotlin-java", spelling: "kotlin-java", count: 7 },
    { name: "jakarta", spelling: "jakarta", count: 2 },
  ];
  const names = (prefix: string) => suggestTags(known, prefix).map((tag) => tag.name);

  it("offers the tags starting with the prefix, by notes, then those containing it", () => {
    expect(names("ja")).toEqual(["javascript", "jakarta", "java", "kotlin-java"]);
    expect(names("J")).toEqual(["jvm", "javascript", "jakarta", "java", "kotlin-java"]);
  });

  it("puts the very tag typed first", () => {
    expect(names("java")).toEqual(["java", "javascript", "kotlin-java"]);
  });

  it("offers nothing for no prefix or no match, and at most eight", () => {
    expect(names("")).toEqual([]);
    expect(names("rust")).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => ({
      name: `t${String(index)}`,
      spelling: `t${String(index)}`,
      count: 1,
    }));
    expect(suggestTags(many, "t")).toHaveLength(8);
  });
});
