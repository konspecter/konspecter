import { parseDocument } from "../document/document";
import { createNote } from "../note/note";
import { conflictCopyMarkdown, planResolution } from "./conflicts";

const now = new Date("2026-09-28T10:15:42Z");
const remote = (markdown: string, deleted = false) => ({
  id: "n1",
  markdown,
  revision: 3,
  deleted,
});

describe("planResolution", () => {
  const local = createNote("# Java\n\nlocal edit", now, "n1");

  it("keeps the server version and copies a different local edit", () => {
    const plan = planResolution(local, remote("server edit"), now);

    expect(plan.kind).toBe("copy-local");
    expect(plan.remote.markdown).toBe("server edit");
  });

  it("copies a local edit when the server deleted the note", () => {
    expect(planResolution(local, remote("", true), now).kind).toBe("copy-local");
  });

  it("settles identical versions without a copy", () => {
    expect(planResolution(local, remote(local.markdown), now)).toEqual({
      kind: "take-remote",
      remote: remote(local.markdown),
    });
  });

  it("brings back a note deleted locally but edited elsewhere", () => {
    expect(planResolution(null, remote("edited elsewhere"), now).kind).toBe("take-remote");
  });

  it("settles a note deleted on both sides", () => {
    expect(planResolution(null, remote("", true), now)).toEqual({
      kind: "take-remote",
      remote: remote("", true),
    });
  });
});

describe("conflictCopyMarkdown", () => {
  it("labels the copy, links the original and keeps the content", () => {
    const local = createNote("---\ntags: [a]\n---\n\n# Java\n\nlocal edit", now, "n1");

    const copy = parseDocument(conflictCopyMarkdown(local, now));

    expect(copy.metadata.title).toBe("Java (conflict copy 2026-09-28 10:15 UTC)");
    expect(copy.metadata.conflictOf).toBe("n1");
    expect(copy.body).toBe("# Java\n\nlocal edit");
    expect(conflictCopyMarkdown(local, now)).toContain("tags: [a]");
  });

  it("names an untitled copy", () => {
    const copy = conflictCopyMarkdown(createNote("", now, "n1"), now);
    expect(parseDocument(copy).metadata.title).toBe(
      "Untitled (conflict copy 2026-09-28 10:15 UTC)",
    );
  });

  it("copies a document with invalid frontmatter unchanged", () => {
    const broken = { id: "n1", markdown: "---\ntitle: [\n---\ntext" };
    expect(conflictCopyMarkdown(broken, now)).toBe(broken.markdown);
  });
});
