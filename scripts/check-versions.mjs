// Every shipped artifact carries the same version. With a tag argument
// (e.g. "v0.1.0", as in the release workflow) it must match that too.
// `pnpm version:set` writes it (scripts/set-version.mjs).
import { derived, parseVersion, versioned } from "./versions.mjs";

const expected = process.argv[2]?.replace(/^v/, "") ?? versioned[0].read();
if (expected === undefined || !parseVersion(expected)) {
  console.error(`Not a semantic version: ${String(expected)}`);
  process.exit(1);
}
const wrong = versioned
  .map((entry) => ({ entry, version: entry.read(), want: expected }))
  .concat(derived.map((entry) => ({ entry, version: entry.read(), want: entry.value(expected) })))
  .filter(({ version, want }) => version !== String(want));
if (wrong.length > 0) {
  console.error(`Versions must all be ${expected}:`);
  for (const { entry, version, want } of wrong) {
    console.error(`  ${entry.label}: ${String(version)} (want ${String(want)})`);
  }
  process.exit(1);
}
console.log(`All versions are ${expected}.`);
