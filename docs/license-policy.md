# Dependency license policy

Every dependency, including transitive ones, is checked for its license, commercial-use
permission and redistribution rights. Being open source is not enough on its own.

## Rules

**Preferred:** MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC.

**Also allowed** (permissive, recorded in `license-policy.json` with a reason): 0BSD,
MIT-0, CC0-1.0, Unlicense, BlueOak-1.0.0.

**Explicit decision required:** GPL, LGPL, AGPL, MPL, SSPL, Commons Clause, BSL, CC-BY,
source-available, commercially restrictive, unknown or missing licenses. A decision is
recorded as a package-scoped entry in `license-policy.json` under `exceptions`, with a reason.
An exception with `"scope": "dev"` is valid only while the package is not a runtime
(production) dependency.

## Enforcement

- npm: `pnpm licenses:check` (run in CI) reads `pnpm licenses list` for the whole
  workspace and fails on anything not covered by the policy. It also warns about unused
  exceptions so stale decisions get cleaned up.
- Go: CI runs `go-licenses check` on the server's dependency tree and allows only the
  preferred licenses. Current dependencies: pgx and its jackc helpers (MIT), and
  `golang.org/x/sync` and `golang.org/x/text` (BSD-3-Clause).

- Rust (desktop app): `cargo deny check licenses` in `apps/desktop/src-tauri` against
  `deny.toml`. It allows the preferred licenses plus **Unicode-3.0** (Unicode data tables
  used by ICU and `unicode-ident`) and **Zlib** (`foldhash`, `zlib-rs`), both permissive and
  OSI-approved. MPL-2.0 is allowed only for the named crates below.

## Current exceptions

| Package                                                           | License    | Scope   | Why it is acceptable                                                                                     |
| ----------------------------------------------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `lightningcss*`                                                   | MPL-2.0    | dev     | Vite's CSS minifier. Build-time only, not in the bundle                                                  |
| `caniuse-lite`                                                    | CC-BY-4.0  | dev     | Browser-support data for build tooling. Not in the bundle                                                |
| `argparse`                                                        | Python-2.0 | any     | Used only by the markdown-it CLI, not bundled. Permissive (PSF) license                                  |
| `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` (Rust) | MPL-2.0    | shipped | Servo CSS parsing inside Tauri. Unmodified, file-level copyleft: include notices, source is on crates.io |
| `option-ext` (Rust)                                               | MPL-2.0    | shipped | Used by `dirs`. Same terms                                                                               |
| `axe-core`, `@axe-core/playwright`                                | MPL-2.0    | dev     | Accessibility checks in end-to-end tests. Never shipped                                                  |
| `@fontsource-variable/inter`                                      | OFL-1.1    | shipped | The Inter font (Latin, Cyrillic). The free font license: bundling allowed; its license travels with it   |
