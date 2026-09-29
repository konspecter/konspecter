import { planResolution } from "./conflicts";

const edited = (updated: string | null, body: string) => ({
  id: "n1",
  markdown: `${updated === null ? "" : `---\nupdated: ${updated}\n---\n`}# Java\n\n${body}`,
});
const remote = (markdown: string, deleted = false) => ({
  id: "n1",
  markdown,
  revision: 3,
  deleted,
});

describe("planResolution", () => {
  const older = edited("2026-09-28T10:00:00Z", "older edit");
  const newer = edited("2026-09-28T10:05:00Z", "newer edit");

  it("keeps the local version when it was edited later", () => {
    expect(planResolution(newer, remote(older.markdown)).kind).toBe("keep-local");
  });

  it("takes the server version when it was edited later", () => {
    const plan = planResolution(older, remote(newer.markdown));

    expect(plan).toEqual({ kind: "take-remote", remote: remote(newer.markdown) });
  });

  it("gives ties and versions without a date to the server", () => {
    const sameTime = edited("2026-09-28T10:05:00Z", "same time, other text");
    expect(planResolution(sameTime, remote(newer.markdown)).kind).toBe("take-remote");
    expect(planResolution(edited(null, "undated"), remote(older.markdown)).kind).toBe(
      "take-remote",
    );
    expect(planResolution(newer, remote(edited(null, "undated").markdown)).kind).toBe("keep-local");
  });

  it("reads other tools' updated_at, and treats invalid frontmatter as undated", () => {
    const other = { id: "n1", markdown: "---\nupdated_at: 2026-09-28T11:00:00Z\n---\nother" };
    expect(planResolution(other, remote(newer.markdown)).kind).toBe("keep-local");
    const broken = { id: "n1", markdown: "---\nupdated: [\n---\nbroken" };
    expect(planResolution(broken, remote(older.markdown)).kind).toBe("take-remote");
  });

  it("keeps a local edit when the server deleted the note", () => {
    expect(planResolution(older, remote("", true)).kind).toBe("keep-local");
  });

  it("settles identical versions", () => {
    expect(planResolution(newer, remote(newer.markdown)).kind).toBe("take-remote");
  });

  it("brings back a note deleted locally but edited elsewhere", () => {
    expect(planResolution(null, remote(older.markdown)).kind).toBe("take-remote");
  });

  it("settles a note deleted on both sides", () => {
    expect(planResolution(null, remote("", true))).toEqual({
      kind: "take-remote",
      remote: remote("", true),
    });
  });
});
