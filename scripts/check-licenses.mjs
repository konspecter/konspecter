// Checks every installed npm dependency (direct and transitive) against
// license-policy.json. Exits non-zero when a license needs a decision.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const policy = JSON.parse(readFileSync(new URL("../license-policy.json", import.meta.url), "utf8"));
const allowed = new Set([...policy.preferred, ...policy.alsoAllowed.map((entry) => entry.license)]);

function listPackages(extraArgs) {
  const output = execFileSync("pnpm", ["licenses", "list", "--json", "-r", ...extraArgs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = JSON.parse(output);
  return Object.entries(byLicense).flatMap(([license, packages]) =>
    packages.flatMap((pkg) =>
      pkg.versions.map((version) => ({ name: pkg.name, version, license })),
    ),
  );
}

// Supports the SPDX forms seen in practice: "A", "(A OR B)", "A AND B".
function isAllowedExpression(expression) {
  const normalized = expression.replace(/[()]/g, " ").trim();
  return normalized
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => allowed.has(id.trim())));
}

function matchesPackage(pattern, name) {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

const all = listPackages([]);
const prodNames = new Set(listPackages(["--prod"]).map((pkg) => pkg.name));
const usedExceptions = new Set();
const violations = [];

for (const pkg of all) {
  if (isAllowedExpression(pkg.license)) continue;

  const exception = policy.exceptions.find(
    (entry) => entry.license === pkg.license && matchesPackage(entry.package, pkg.name),
  );
  if (!exception) {
    violations.push(`${pkg.name}@${pkg.version}: ${pkg.license} is not covered by the policy`);
    continue;
  }
  usedExceptions.add(exception);
  if (exception.scope === "dev" && prodNames.has(pkg.name)) {
    violations.push(
      `${pkg.name}@${pkg.version}: ${pkg.license} is allowed only as a dev dependency, but it is a runtime dependency`,
    );
  }
}

for (const exception of policy.exceptions) {
  if (!usedExceptions.has(exception)) {
    console.warn(`warning: unused exception ${exception.package} (${exception.license})`);
  }
}

if (violations.length > 0) {
  console.error("License policy violations:\n" + violations.map((v) => `  - ${v}`).join("\n"));
  console.error("\nRecord an explicit decision in license-policy.json or remove the dependency.");
  process.exit(1);
}

console.log(
  `License check passed: ${all.length} packages, ${usedExceptions.size} exceptions used.`,
);
