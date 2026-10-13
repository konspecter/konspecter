import assert from "node:assert/strict";
import { test } from "node:test";
import { datedChangelog, today } from "./release.mjs";

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
