import { describe, expect, it } from "vitest";
import { DEFAULT_IGNORE, ignoreRules } from "./ignore";

describe("ignoreRules", () => {
  const defaults = ignoreRules(DEFAULT_IGNORE);

  it("skips hidden files and folders by default", () => {
    expect(defaults.ignores(".hidden.md")).toBe(true);
    expect(defaults.ignores(".git/notes.md")).toBe(true);
    expect(defaults.ignores("a/.obsidian/b.md")).toBe(true);
    expect(defaults.ignoresFolder(".trash")).toBe(true);
  });

  it("skips dependency and build folders by default, at any depth", () => {
    for (const path of [
      "node_modules/pkg/README.md",
      "vendors/x.md",
      "dist/notes.md",
      "bin/notes.md",
      "project/node_modules/pkg/README.md",
    ]) {
      expect(defaults.ignores(path)).toBe(true);
    }
    expect(defaults.ignoresFolder("dist/")).toBe(true);
  });

  it("keeps everything else", () => {
    for (const path of ["notes.md", "bin.md", "binary/notes.md", "work/dist.md", "a/b/c.md"]) {
      expect(defaults.ignores(path)).toBe(false);
    }
    expect(defaults.ignoresFolder("")).toBe(false);
    expect(defaults.ignoresFolder("work")).toBe(false);
  });

  it("follows gitignore: anchors, folder-only patterns, globs, negation and comments", () => {
    const rules = ignoreRules(
      ["# drafts", "/top.md", "drafts/", "*.tmp.md", "archive/**", "!keep.tmp.md"].join("\n"),
    );
    expect(rules.ignores("top.md")).toBe(true);
    expect(rules.ignores("a/top.md")).toBe(false);
    expect(rules.ignores("drafts/x.md")).toBe(true);
    expect(rules.ignores("drafts.md")).toBe(false);
    expect(rules.ignores("a/b.tmp.md")).toBe(true);
    expect(rules.ignores("a/keep.tmp.md")).toBe(false);
    expect(rules.ignores("archive/2020/x.md")).toBe(true);
    expect(rules.ignores("# drafts")).toBe(false);
  });

  it("reads hidden files once the rule for them is gone", () => {
    const rules = ignoreRules("node_modules\n");
    expect(rules.ignores(".notes/a.md")).toBe(false);
  });

  it("matches nothing without rules, and never throws on odd paths", () => {
    const none = ignoreRules("");
    expect(none.ignores("a.md")).toBe(false);
    expect(defaults.ignores("/absolute.md")).toBe(false);
    expect(defaults.ignores("")).toBe(false);
  });
});
