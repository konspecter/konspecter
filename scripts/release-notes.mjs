// A release's notes: its section of CHANGELOG.md, without the heading.
// `node scripts/release-notes.mjs v0.2.0 > release-notes.md`. A pre-release
// (`v0.2.0-rc.1`) takes its release's section if there is one, else the
// Unreleased sections. Fails when there is nothing, so no release goes out bare.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The `## ` sections of a changelog: each heading and the text under it.
function sections(changelog) {
  const result = [];
  for (const line of changelog.split("\n")) {
    if (line.startsWith("## ")) result.push({ heading: line.slice(3).trim(), lines: [] });
    else result.at(-1)?.lines.push(line);
  }
  return result.map(({ heading, lines }) => ({ heading, body: lines.join("\n").trim() }));
}

export function releaseNotes(changelog, tag) {
  const version = tag.replace(/^v/, "");
  const release = version.replace(/-.*$/, "");
  const all = sections(changelog);
  const own = all.find(({ heading }) => heading.split(" ")[0] === release);
  if (own?.body) return own.body;
  if (version === release) return undefined;
  // A pre-release before its version's heading is written: what is unreleased.
  // The named Unreleased sections ("Unreleased — updates package 2") keep their names.
  const unreleased = all.filter(({ heading, body }) => heading.startsWith("Unreleased") && body);
  if (unreleased.length === 0) return undefined;
  return unreleased
    .map(({ heading, body }, index) => {
      const name = heading.replace(/^Unreleased\s*(?:—\s*)?/, "");
      return index > 0 && name ? `### ${name}\n\n${body}` : body;
    })
    .join("\n\n");
}

function main() {
  const tag = process.argv[2];
  if (tag === undefined) {
    console.error("Usage: node scripts/release-notes.mjs <tag>");
    process.exit(1);
  }
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const notes = releaseNotes(changelog, tag);
  if (notes === undefined) {
    console.error(
      `CHANGELOG.md has no section for ${tag}: add "## ${tag.replace(/^v/, "")} — date"`,
    );
    process.exit(1);
  }
  console.log(notes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
