import assert from "node:assert/strict";
import { test } from "node:test";
import { datedChangelog, draftEntries, entryOf, today, withEntries } from "./release.mjs";

test("the Unreleased sections become one dated version", () => {
  const changelog = `# Changelog

## Unreleased

- **Panes fold**

## Unreleased — updates package 2

- **Owl icon**

## 0.1.0 — 2026-09-28

- First release
`;
  assert.equal(
    datedChangelog(changelog, "0.2.0", "2026-10-13"),
    `# Changelog

## 0.2.0 — 2026-10-13

- **Panes fold**

### Updates package 2

- **Owl icon**

## 0.1.0 — 2026-09-28

- First release
`,
  );
});

test("an unnamed second Unreleased section joins the first", () => {
  assert.equal(
    datedChangelog("## Unreleased\n\n- a\n\n## Unreleased\n\n- b\n", "1.0.0", "2026-10-13"),
    "## 1.0.0 — 2026-10-13\n\n- a\n\n- b\n",
  );
});

test("an Unreleased heading below a release is left alone", () => {
  const changelog = "## 0.2.0 — 2026-10-13\n\n- a\n\n## Unreleased\n\n- old\n";
  assert.equal(datedChangelog(changelog, "0.3.0", "2026-10-14"), undefined);
});

test("nothing unreleased is nothing to release", () => {
  assert.equal(datedChangelog("## 0.1.0 — 2026-09-28\n", "0.1.1", "2026-10-13"), undefined);
});

test("today is the local date", () => {
  assert.equal(today(new Date(2026, 0, 5)), "2026-01-05");
});

test("an entry is the subject and the body's first paragraph, wrapped at 100", () => {
  assert.equal(
    entryOf(
      "fix(web): swipe through history.\n\nA swipe to the right goes back and one to the left " +
        "forward, both past Settings as `Esc` does, and so on.\n\nMore detail.",
    ),
    "- **Swipe through history:** A swipe to the right goes back and one to the left forward, both past\n" +
      "  Settings as `Esc` does, and so on.",
  );
});

test("an entry leaves out a body that is a list or a trailer", () => {
  assert.equal(
    entryOf("feat(server): start the trial\n\n- `POST /trial`"),
    "- **Start the trial**",
  );
  assert.equal(entryOf("fix!: rename it\n\nBREAKING CHANGE: it moved"), "- **Rename it**");
  assert.equal(entryOf("perf: start faster"), "- **Start faster**");
});

test("a wrapped line never starts with a list or heading marker", () => {
  const entry = entryOf(`feat: tags\n\n${"word ".repeat(17)}tags #parent#child are two`);
  assert.ok(
    entry
      .split("\n")
      .slice(1)
      .every((line) => !/^ +[#-]/.test(line)),
  );
});

test("drafts cover the unlogged commits, breaking first, then features, oldest first", () => {
  const commits = [
    { message: "fix: newer fix", level: "patch", unlogged: true },
    { message: "feat: a feature", level: "minor", unlogged: true },
    { message: "fix: logged fix", level: "patch", unlogged: false },
    { message: "fix: older fix", level: "patch", unlogged: true },
    { message: "refactor!: broke it", level: "major", unlogged: true },
  ];
  assert.deepEqual(draftEntries(commits), [
    "- **Broke it**",
    "- **A feature**",
    "- **Older fix**",
    "- **Newer fix**",
  ]);
});

test("entries go at the end of the first Unreleased section", () => {
  assert.equal(
    withEntries("# Changelog\n\n## Unreleased\n\n- a\n\n## 0.1.0 — x\n", ["- b", "- c"]),
    "# Changelog\n\n## Unreleased\n\n- a\n- b\n- c\n\n## 0.1.0 — x\n",
  );
  assert.equal(
    withEntries("## Unreleased\n\n## 0.1.0 — x\n", ["- b"]),
    "## Unreleased\n\n- b\n\n## 0.1.0 — x\n",
  );
});

test("entries open an Unreleased section above the last release", () => {
  assert.equal(
    withEntries("# Changelog\n\n## 0.1.0 — x\n\n- a\n", ["- b"]),
    "# Changelog\n\n## Unreleased\n\n- b\n\n## 0.1.0 — x\n\n- a\n",
  );
  assert.equal(withEntries("# Changelog\n", ["- b"]), "# Changelog\n\n## Unreleased\n\n- b\n");
  assert.equal(withEntries("# Changelog\n", []), "# Changelog\n");
});
