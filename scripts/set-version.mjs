// Writes a release's version into every file that carries it:
// `pnpm version:set 0.2.0` (or `v0.2.0`, or `0.2.0-rc.1`).
import { androidVersionCode, derived, lockfile, versioned } from "./versions.mjs";

const version = process.argv[2]?.replace(/^v/, "");
if (version === undefined) {
  console.error("Usage: pnpm version:set <major.minor.patch[-pre-release]>");
  process.exit(1);
}
if (androidVersionCode(version) === undefined) {
  console.error(
    `Not a semantic version with minor and patch below 100 (the Android versionCode): ${version}`,
  );
  process.exit(1);
}
for (const entry of [...versioned, ...derived, lockfile]) {
  const before = entry.read();
  entry.write(version);
  console.log(`${entry.label}: ${String(before)} → ${String(entry.value(version))}`);
}
