// Every shipped artifact carries the same version. With a tag argument
// (e.g. "v0.1.0", as in the release workflow) it must match that too.
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "apps/web/package.json": JSON.parse(read("apps/web/package.json")).version,
  "apps/site/package.json": JSON.parse(read("apps/site/package.json")).version,
  "apps/desktop/package.json": JSON.parse(read("apps/desktop/package.json")).version,
  "apps/mobile/package.json": JSON.parse(read("apps/mobile/package.json")).version,
  "apps/desktop/src-tauri/tauri.conf.json": JSON.parse(
    read("apps/desktop/src-tauri/tauri.conf.json"),
  ).version,
  "apps/desktop/src-tauri/Cargo.toml": /^version = "([^"]+)"/m.exec(
    read("apps/desktop/src-tauri/Cargo.toml"),
  )?.[1],
};
const expected = process.argv[2]?.replace(/^v/, "") ?? versions["package.json"];
const wrong = Object.entries(versions).filter(([, version]) => version !== expected);
if (wrong.length > 0) {
  console.error(`Versions must all be ${expected}:`);
  for (const [file, version] of wrong) console.error(`  ${file}: ${String(version)}`);
  process.exit(1);
}
console.log(`All versions are ${expected}.`);
