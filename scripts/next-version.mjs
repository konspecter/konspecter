// The next release's version, from the Conventional Commits since the last one:
//   node scripts/next-version.mjs [patch|minor|major|X.Y.Z]
// Prints JSON: the current version, the last release tag, the commits since it,
// the bump they ask for and the next version. An argument overrides the bump.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./versions.mjs";

const LEVELS = ["none", "patch", "minor", "major"];

// `type(scope)!: subject`; the `!` marks a breaking change.
const header = /^(\w+)(?:\([^)]*\))?(!)?: /;

// The bump one commit message asks for: a breaking change is major, a feature
// minor, anything else (fixes, docs, chores) patch.
export function levelOf(message) {
  const match = header.exec(message);
  if (match?.[2] === "!" || /^BREAKING[ -]CHANGE: /m.test(message)) return "major";
  if (match?.[1] === "feat") return "minor";
  return "patch";
}

// The largest of the levels.
export function highest(levels) {
  return levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "none");
}

// Before 1.0 a minor may break (docs/release.md): a breaking change bumps the
// minor, and 1.0.0 is only ever asked for explicitly.
export function bump(version, level) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`Not a semantic version: ${version}`);
  const { major, minor, patch } = parsed;
  // A pre-release (0.2.0-rc.1) is released as itself (0.2.0).
  if (version.includes("-")) return `${major}.${minor}.${patch}`;
  if (level === "major" && major === 0) level = "minor";
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  return version;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function lastTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  } catch {
    return undefined;
  }
}

// The release the commits since the last tag ask for, or the one `override`
// (a level or a version) names.
export function nextVersion(override) {
  const root = git("rev-parse", "--show-toplevel");
  const current = JSON.parse(readFileSync(`${root}/package.json`, "utf8")).version;
  const tag = lastTag();
  // With no tag yet, the current version counts as released when CHANGELOG.md
  // has its heading; otherwise it is the first release, as it is.
  const changelog = readFileSync(`${root}/CHANGELOG.md`, "utf8");
  const released =
    tag !== undefined ||
    new RegExp(`^## ${current.replaceAll(".", "\\.")}\\b`, "m").test(changelog);

  const log = git("log", "--format=%h %s%x00%B%x1e", ...(tag ? [`${tag}..HEAD`] : []));
  const commits = log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body] = entry.split("\x00");
      return { subject, level: levelOf(body.trim()) };
    });

  const wanted = override?.replace(/^v/, "");
  let level = released ? highest(commits.map((c) => c.level)) : "none";
  let next = bump(current, level);
  if (wanted !== undefined) {
    if (LEVELS.includes(wanted)) {
      level = wanted;
      // Asked for by name, a major leaves 0.x (0.4.2 → 1.0.0).
      next =
        wanted === "major"
          ? `${String(parseVersion(current).major + 1)}.0.0`
          : bump(current, wanted);
    } else if (parseVersion(wanted)) {
      level = "explicit";
      next = wanted;
    } else {
      throw new Error(`Not a bump or a version: ${override}`);
    }
  }
  return { current, lastTag: tag ?? null, released, commits, level, next, tag: `v${next}` };
}

function main() {
  const result = nextVersion(process.argv[2]);
  console.log(
    JSON.stringify(
      {
        ...result,
        commits: result.commits.map((c) => `${c.level.padEnd(5)} ${c.subject}`),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
