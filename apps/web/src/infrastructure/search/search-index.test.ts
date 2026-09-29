import { createNote, type Note } from "../../domain/note/note";
import { parseQuery } from "../../domain/search/query";
import { SearchIndex } from "./search-index";

const date = (day: number) => new Date(Date.UTC(2026, 8, day));
const note = (id: string, markdown: string, day = 1): Note => createNote(markdown, date(day), id);
const ids = (index: SearchIndex, query: string) =>
  index.search(parseQuery(query)).map((hit) => hit.id);

describe("SearchIndex", () => {
  const notes = [
    note("maps", "# Hash maps\n\nBuckets and collisions.", 1),
    note("sets", "# Sets\n\nA HashSet is backed by a hash map.", 2),
    note("code", "# Snippets\n\n```java\nvar cache = new ConcurrentHashMap<>();\n```", 3),
    note("other", "# Networking\n\nTCP and UDP.", 4),
  ];

  it("ranks title matches above body matches", () => {
    expect(ids(new SearchIndex(notes), "hash")).toEqual(["maps", "sets"]);
  });

  it("matches word prefixes and code", () => {
    const index = new SearchIndex(notes);
    expect(ids(index, "collis")).toEqual(["maps"]);
    expect(ids(index, "concurrenthashmap")).toEqual(["code"]);
  });

  it("requires every word to match", () => {
    expect(ids(new SearchIndex(notes), "hash buckets")).toEqual(["maps"]);
  });

  it("tolerates a typo in longer words", () => {
    expect(ids(new SearchIndex(notes), "netwroking")).toEqual(["other"]);
  });

  it("returns stored text and matched terms for snippets", () => {
    const [hit] = new SearchIndex(notes).search(parseQuery("tcp"));

    expect(hit).toMatchObject({ id: "other", title: "Networking", terms: ["tcp"] });
    expect(hit?.text).toContain("TCP and UDP.");
  });

  it("updates and removes notes", () => {
    const index = new SearchIndex(notes);
    index.upsert(note("other", "# Routing\n\nBGP."));
    expect(ids(index, "tcp")).toEqual([]);
    expect(ids(index, "bgp")).toEqual(["other"]);

    index.remove("other");
    expect(ids(index, "bgp")).toEqual([]);
  });

  it("finds notes with invalid frontmatter by their raw text", () => {
    const index = new SearchIndex([{ id: "bad", markdown: "---\ntitle: [\n---\nrecoverable" }]);
    expect(ids(index, "recoverable")).toEqual(["bad"]);
  });

  it("returns nothing for an empty query", () => {
    expect(new SearchIndex(notes).search(parseQuery("  "))).toEqual([]);
  });
});

describe("SearchIndex combined search", () => {
  const notes = [
    note("java-maps", "# HashMap internals\n\nBuckets. #java#collections", 1),
    note("go-maps", "# Go maps\n\nA hashmap in Go. #go", 2),
    note("java-io", "# Files\n\nReading files. #java", 3),
    note("mentions", "# Languages\n\nJava and Go compared.", 4),
  ];
  const index = new SearchIndex(notes);

  it("combines text with a tag filter", () => {
    expect(ids(index, "hashmap #java")).toEqual(["java-maps"]);
  });

  it("includes child tags in a filter", () => {
    expect(ids(index, "#java")).toEqual(["java-io", "java-maps"]);
    expect(ids(index, "#java#collections")).toEqual(["java-maps"]);
  });

  it("lists every note within the tags when there are no words, newest first", () => {
    expect(ids(index, "#java")).toEqual(["java-io", "java-maps"]);
  });

  it("requires every tag filter", () => {
    expect(ids(index, "#java #go")).toEqual([]);
  });

  it("matches plain words against tag names as well as text", () => {
    expect(ids(index, "collections")).toEqual(["java-maps"]);
    expect(ids(index, "java").sort()).toEqual(["java-io", "java-maps", "mentions"]);
  });

  it("returns nothing for an unknown tag", () => {
    expect(ids(index, "hashmap #rust")).toEqual([]);
  });

  it("is deterministic", () => {
    expect(ids(index, "maps")).toEqual(ids(new SearchIndex([...notes].reverse()), "maps"));
  });
});
