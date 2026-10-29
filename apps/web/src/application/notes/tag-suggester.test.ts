import { createNote } from "../../domain/note/note";
import { NoteCatalog } from "./note-catalog";
import type { NoteRepository } from "./note-repository";
import { tagSuggester } from "./tag-suggester";

describe("tagSuggester", () => {
  it("offers the library's tags, leaving out a note's own", async () => {
    const notes = [
      createNote("# A\n\n#Java #maps", new Date("2020-01-01"), "a"),
      createNote("# B\n\n#java #jakarta", new Date("2020-01-02"), "b"),
    ];
    const store = { list: () => Promise.resolve(notes) } as unknown as NoteRepository;
    const catalog = new NoteCatalog(store);
    const suggest = tagSuggester(catalog);
    expect(suggest("ja")).toEqual([]);

    await catalog.reload();

    expect(suggest("ja").map((tag) => [tag.spelling, tag.count])).toEqual([
      ["Java", 2],
      ["jakarta", 1],
    ]);
    expect(suggest("ja", "b").map((tag) => tag.spelling)).toEqual(["Java"]);
    expect(suggest("ma", "a")).toEqual([]);
  });
});
