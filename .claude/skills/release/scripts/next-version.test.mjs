// node --test .claude/skills/release/scripts/next-version.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { bump, highest, levelOf } from "./next-version.mjs";

test("a commit's level follows its type", () => {
  assert.equal(levelOf("fix(web): keep the caret"), "patch");
  assert.equal(levelOf("docs: explain releases"), "patch");
  assert.equal(levelOf("feat(site): sign in by QR code"), "minor");
  assert.equal(levelOf("feat(api)!: drop markdown from notes"), "major");
  assert.equal(levelOf("fix!: rename the setting"), "major");
  assert.equal(levelOf("refactor: x\n\nBREAKING CHANGE: the API moved"), "major");
  assert.equal(levelOf("refactor: x\n\nBREAKING-CHANGE: the API moved"), "major");
  assert.equal(levelOf("reset me"), "patch");
});

test("the highest level wins", () => {
  assert.equal(highest([]), "none");
  assert.equal(highest(["patch", "minor", "patch"]), "minor");
  assert.equal(highest(["minor", "major"]), "major");
});

test("bump follows semantic versioning", () => {
  assert.equal(bump("1.2.3", "patch"), "1.2.4");
  assert.equal(bump("1.2.3", "minor"), "1.3.0");
  assert.equal(bump("1.2.3", "major"), "2.0.0");
  assert.equal(bump("1.2.3", "none"), "1.2.3");
});

test("before 1.0 a breaking change bumps the minor", () => {
  assert.equal(bump("0.1.0", "major"), "0.2.0");
  assert.equal(bump("0.1.4", "patch"), "0.1.5");
});

test("a pre-release is released as itself", () => {
  assert.equal(bump("0.2.0-rc.1", "minor"), "0.2.0");
});
