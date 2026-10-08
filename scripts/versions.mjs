// Every file that carries the release's version, and how to read and write it.
// Writes replace the version in place, so the rest of the file is kept as it is.
import { readFileSync, writeFileSync } from "node:fs";

const path = (file) => new URL(`../${file}`, import.meta.url);

// MAJOR.MINOR.PATCH with an optional pre-release (`0.2.0-rc.1`).
const semver = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function parseVersion(version) {
  const match = semver.exec(version);
  if (!match) return undefined;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  return { major, minor, patch };
}

// Android only installs an update with a higher versionCode. Minor and patch
// get two digits each; a pre-release shares its release's code.
export function androidVersionCode(version) {
  const parsed = parseVersion(version);
  if (!parsed || parsed.minor > 99 || parsed.patch > 99) return undefined;
  return parsed.major * 10000 + parsed.minor * 100 + parsed.patch;
}

// One field in a file: a pattern whose first group is the value.
function field(file, pattern, value = (version) => version, label = file) {
  return {
    file,
    label,
    value,
    read: () => pattern.exec(readFileSync(path(file), "utf8"))?.[1],
    write: (version) => {
      const text = readFileSync(path(file), "utf8");
      if (!pattern.test(text)) throw new Error(`${file}: no version found`);
      // Every pattern ends at its value, so the value is the last place it occurs.
      const replace = (whole, old) => {
        const at = whole.lastIndexOf(old);
        return whole.slice(0, at) + String(value(version)) + whole.slice(at + old.length);
      };
      writeFileSync(path(file), text.replace(pattern, replace));
    },
  };
}

// The top-level "version" of a JSON file (two-space indent).
const json = (file) => field(file, /^ {2}"version": "([^"]*)"/m);

export const versioned = [
  json("package.json"),
  json("apps/web/package.json"),
  json("apps/site/package.json"),
  json("apps/desktop/package.json"),
  json("apps/mobile/package.json"),
  json("apps/desktop/src-tauri/tauri.conf.json"),
  field("apps/desktop/src-tauri/Cargo.toml", /^version = "([^"]+)"/m),
  field("apps/mobile/android/app/build.gradle", /^\s*versionName "([^"]*)"/m),
  // The images deploy/compose.yaml runs.
  field("deploy/.env.example", /^KONSPECTER_VERSION=(.*)$/m),
];

// Derived from the version: checked against it and written with it.
export const derived = [
  field(
    "apps/mobile/android/app/build.gradle",
    /^\s*versionCode (\d+)$/m,
    androidVersionCode,
    "apps/mobile/android/app/build.gradle versionCode",
  ),
];

// Follows Cargo.toml; written so the next build leaves the tree clean.
export const lockfile = field(
  "apps/desktop/src-tauri/Cargo.lock",
  /^name = "konspecter-desktop"\nversion = "([^"]+)"/m,
);
