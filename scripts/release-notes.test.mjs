import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseNotes } from "./release-notes.mjs";

const changelog = `# Changelog

## Unreleased

- **Panes fold**

## Unreleased — updates package 2

- **Owl icon**

## 0.2.0 — 2026-10-08

- **Settings in groups**

### Updates package 1

- **Two panels**

## 0.1.0 — 2026-09-28

- First release
`;

test("a release's notes are its section, without the heading", () => {
  assert.equal(
    releaseNotes(changelog, "v0.2.0"),
    "- **Settings in groups**\n\n### Updates package 1\n\n- **Two panels**",
  );
  assert.equal(releaseNotes(changelog, "0.1.0"), "- First release");
});

test("a version without a section has no notes", () => {
  assert.equal(releaseNotes(changelog, "v0.3.0"), undefined);
  assert.equal(releaseNotes(changelog, "v0.1"), undefined);
});

test("a pre-release takes its release's section", () => {
  assert.equal(releaseNotes(changelog, "v0.1.0-rc.1"), "- First release");
});

test("a pre-release before its section takes the Unreleased ones", () => {
  assert.equal(
    releaseNotes(changelog, "v0.3.0-rc.1"),
    "- **Panes fold**\n\n### updates package 2\n\n- **Owl icon**",
  );
  assert.equal(releaseNotes("# Changelog\n\n## Unreleased\n", "v0.3.0-rc.1"), undefined);
});
