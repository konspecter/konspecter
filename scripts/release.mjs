// Releases Konspecter from a terminal, the steps the `release` skill takes:
//   pnpm release [patch|minor|major|X.Y.Z] [--dry-run]
// Checks the ground, works out the version from the commits since the last
// tag, asks, writes the version everywhere, dates CHANGELOG.md, commits, tags
// vX.Y.Z and pushes the branch and the tag together (docs/release.md).
// --dry-run stops after showing the version and the release notes.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { nextVersion } from "./next-version.mjs";
import { releaseNotes } from "./release-notes.mjs";

const unreleased = /^## Unreleased(?:\s*—\s*(.*))?$/;

// The changelog with its Unreleased sections made one `## X.Y.Z — date`: the
// first one's entries first, the names of the others ("— updates package 2")
// as `###` headings over theirs. Undefined when nothing is unreleased.
export function datedChangelog(changelog, version, date) {
  const lines = changelog.split("\n");
  const result = [];
  let found = false;
  let released = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = released ? null : unreleased.exec(line);
    if (line.startsWith("## ") && !match) released = true;
    if (!match) {
      result.push(line);
    } else if (!found) {
      found = true;
      result.push(`## ${version} — ${date}`);
    } else if (match[1]) {
      result.push(`### ${match[1].charAt(0).toUpperCase()}${match[1].slice(1)}`);
    } else if (lines[i + 1] === "") {
      i++; // an unnamed one's entries simply follow the others
    }
  }
  return found ? result.join("\n") : undefined;
}

// Today as YYYY-MM-DD, in the local time zone.
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Runs a command in the terminal, its output shown as it goes.
function run(command, ...args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function checkGround() {
  if (git("status", "--porcelain") !== "")
    fail("The working tree is not clean: commit or stash first.");
  const branch = git("branch", "--show-current");
  if (branch !== "main") fail(`Releases are made from main, not ${branch || "a detached HEAD"}.`);
  let remote;
  try {
    remote = git("config", "branch.main.remote");
  } catch {
    fail("main has no upstream to push to (git branch -u origin/main).");
  }
  run("git", "fetch", "--tags", remote);
  if (git("rev-list", "--count", "main..main@{upstream}") !== "0") {
    fail(`main is behind ${remote}: pull first.`);
  }
  run("node", "scripts/check-versions.mjs");
  return remote;
}

function summary(release, remote) {
  const count = (level) => release.commits.filter((c) => c.level === level).length;
  const since = release.lastTag ?? (release.released ? release.current : "the start");
  console.log(`\nLast release: ${since}`);
  console.log(
    `Commits since: ${String(release.commits.length)} (${String(count("major"))} breaking, ` +
      `${String(count("minor"))} feat, ${String(count("patch"))} other)`,
  );
  const deciding = release.commits.filter((c) => c.level === release.level).slice(0, 5);
  for (const c of deciding) console.log(`  ${c.level.padEnd(5)} ${c.subject}`);
  console.log(
    `\nRelease: ${release.current} → ${release.next} (${release.level}), ` +
      `tag ${release.tag}, pushed to ${remote}`,
  );
  console.log(
    "A breaking change in CHANGELOG.md that no commit marks needs a higher level: " +
      "pnpm release minor (or major).",
  );
}

async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const override = args.find((arg) => !arg.startsWith("--"));
  process.chdir(git("rev-parse", "--show-toplevel"));

  const remote = checkGround();
  const release = nextVersion(override);
  if (release.released && release.commits.length === 0 && override === undefined) {
    fail(`Nothing to release: no commits since ${release.lastTag ?? release.current}.`);
  }
  if (git("tag", "--list", release.tag) !== "") fail(`The tag ${release.tag} already exists.`);
  const changelog = datedChangelog(readFileSync("CHANGELOG.md", "utf8"), release.next, today());
  if (changelog === undefined) fail("CHANGELOG.md has no Unreleased section: nothing to release.");

  summary(release, remote);
  if (dryRun) {
    console.log(`\nRelease notes:\n\n${releaseNotes(changelog, release.tag) ?? ""}`);
    return;
  }
  if (!(await confirm(`\nRelease ${release.tag} and push it to ${remote}? [y/N] `))) {
    fail("Nothing changed.");
  }

  run("node", "scripts/set-version.mjs", release.next);
  writeFileSync("CHANGELOG.md", changelog);
  try {
    run("node", "scripts/check-versions.mjs");
    run("pnpm", "exec", "prettier", "--check", "CHANGELOG.md");
    run("node", "scripts/release-notes.mjs", release.tag);
  } catch {
    fail("A check failed after the version was written: see git diff, fix or git checkout .");
  }
  run("git", "--no-pager", "diff", "--stat");

  run("git", "add", "-A");
  run("git", "commit", "-q", "-m", `chore(release): ${release.tag}`);
  run("git", "tag", "-a", release.tag, "-m", `Konspecter ${release.next}`);
  try {
    run("git", "push", "--atomic", remote, "main", release.tag);
  } catch {
    fail(
      `The push failed. The commit and the tag ${release.tag} are in place: ` +
        `git push --atomic ${remote} main ${release.tag}`,
    );
  }

  console.log(
    `\n✓ Released ${release.next} (${release.level}): commit ${git("rev-parse", "--short", "HEAD")}, ` +
      `tag ${release.tag}.\n` +
      "The release workflow builds a draft GitHub Release and publishes it once every build has\n" +
      "passed, then runs the deploy hook if the repository sets one; on GitLab, run the manual\n" +
      "publish job. Its notes are the new section of CHANGELOG.md.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
