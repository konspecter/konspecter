import { strFromU8, unzipSync } from "fflate";
import { createNote } from "../../domain/note/note";
import { readMarkdownFiles, zipFiles } from "../../infrastructure/files/files";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { exportFiles } from "./export-notes";
import { importMarkdown } from "./import-markdown";

let databaseCount = 0;
async function library() {
  databaseCount += 1;
  return openNoteStore(`import-export-${String(databaseCount)}`);
}
const now = new Date("2026-09-28T10:00:00Z");

function file(name: string, text: string | Uint8Array<ArrayBuffer>, relativePath = "") {
  const f = new File([text], name, { type: "text/markdown" });
  if (relativePath) Object.defineProperty(f, "webkitRelativePath", { value: relativePath });
  return f;
}

describe("importMarkdown", () => {
  it("imports files as written and reports duplicates", async () => {
    const store = await library();
    const sources = [
      { name: "a.md", text: "---\ntags: [x]\n---\n\n# A\n\nalpha" },
      { name: "b.md", text: "# B" },
    ];

    expect(await importMarkdown(sources, store, now)).toEqual({
      imported: 2,
      duplicates: 0,
      rejected: [],
    });
    expect(await importMarkdown(sources, store, now)).toEqual({
      imported: 0,
      duplicates: 2,
      rejected: [],
    });
    const imported = (await store.list()).map((note) => note.markdown).join("\n");
    expect(imported).toContain("tags: [x]");
    expect(imported).toContain("alpha");
  });

  it("keeps the text of a file with invalid frontmatter", async () => {
    const store = await library();

    const report = await importMarkdown(
      [{ name: "bad.md", text: "---\ntitle: [\n---\nkeep me" }],
      store,
      now,
    );

    expect(report.imported).toBe(1);
    expect((await store.list())[0]?.markdown).toContain("keep me");
  });

  it("reports files the library cannot store", async () => {
    const store = await library();
    const quota = new Error("Quota exceeded");
    vi.spyOn(store, "create").mockRejectedValueOnce(quota);

    const report = await importMarkdown(
      [
        { name: "a.md", text: "x" },
        { name: "b.md", text: "y" },
      ],
      store,
      now,
    );

    expect(report).toEqual({
      imported: 1,
      duplicates: 0,
      rejected: [{ name: "a.md", error: quota }],
    });
  });
});

describe("reading files to import", () => {
  it("accepts Markdown, replaces invalid UTF-8 and refuses the rest", async () => {
    const { sources, rejected } = await readMarkdownFiles([
      file("a.md", "# A"),
      file("b.markdown", new Uint8Array([0x6f, 0x6b, 0xff])),
      file("c.txt", "nope"),
      file("huge.md", "x".repeat(5 * 1024 * 1024 + 1)),
    ]);

    expect(sources).toEqual([
      { name: "a.md", text: "# A" },
      { name: "b.markdown", text: "ok�" },
    ]);
    expect(rejected).toEqual([
      { name: "c.txt", reason: "not a Markdown file" },
      { name: "huge.md", reason: "larger than 5 MB" },
    ]);
  });

  it("skips non-Markdown files silently when importing a folder", async () => {
    const { sources, rejected } = await readMarkdownFiles([
      file("note.md", "n", "Notes/note.md"),
      file("image.png", "p", "Notes/image.png"),
    ]);

    expect(sources).toEqual([{ name: "Notes/note.md", text: "n" }]);
    expect(rejected).toEqual([]);
  });
});

describe("export", () => {
  it("exports notes unchanged, named after their titles", () => {
    const notes = [
      createNote("# Maps\n\nbody", now, "1"),
      createNote("---\ntitle: Maps\n---\n\nsame title", now, "2"),
      { id: "3", markdown: "---\ntitle: [\n---\nbroken" },
    ];

    const files = exportFiles(notes);

    expect(files.map((f) => f.name)).toEqual(["Maps.md", "Maps 2.md", "Untitled.md"]);
    expect(files.map((f) => f.contents)).toEqual(notes.map((n) => n.markdown));
  });

  it("round-trips a library through a ZIP", async () => {
    const source = await library();
    await source.create("# One\n\nfirst #tag", now);
    await source.create("# Two\n\nsecond", now);

    const zip = zipFiles(exportFiles(await source.list()));
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const target = await library();
    const sources = Object.entries(entries).map(([name, data]) => ({
      name,
      text: strFromU8(data),
    }));
    await importMarkdown(sources, target, now);

    const texts = async (store: typeof source) =>
      (await store.list()).map((n) => n.markdown).sort();
    expect(await texts(target)).toEqual(await texts(source));
  });
});
