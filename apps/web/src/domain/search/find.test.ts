import { describe, expect, it } from "vitest";
import { findMatches } from "./find";

const found = (text: string, query: string) =>
  findMatches(text, query).map(({ from, to }) => text.slice(from, to));

describe("findMatches", () => {
  it("finds the query anywhere in a word, ignoring case", () => {
    expect(found("HashMap maps a map", "map")).toEqual(["Map", "map", "map"]);
    expect(findMatches("HashMap maps", "MAP")).toEqual([
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it("matches the whole query as one phrase", () => {
    expect(found("hash map, map hash, hash  map", "hash map")).toEqual(["hash map"]);
  });

  it("works in Cyrillic", () => {
    expect(found("Хеш-таблица и хеш-функция", "ХЕШ")).toEqual(["Хеш", "хеш"]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("reports offsets in the original text when lower-casing changes its length", () => {
    // "İ" lower-cases to two units ("i" and a combining dot).
    const text = "İstanbul, Paris";
    expect(found(text, "paris")).toEqual(["Paris"]);
    expect(found(text, "i̇stanbul")).toEqual(["İstanbul"]);
  });

  it("matches characters outside the basic plane", () => {
    expect(found("a 🦉 owl, 🦉 again", "🦉 a")).toEqual(["🦉 a"]);
  });

  it("finds nothing for a blank query", () => {
    expect(findMatches("some text", "")).toEqual([]);
    expect(findMatches("some  text", "  ")).toEqual([]);
  });
});
