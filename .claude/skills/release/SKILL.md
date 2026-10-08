---
name: release
description:
  "Release Konspecter: work out the semantic-version bump (patch, minor or major) from the Conventional Commits since
  the last release tag, write the version everywhere with pnpm version:set, date the CHANGELOG, commit, tag vX.Y.Z and
  push the branch and the tag. Use when the user asks to release, cut a release, bump the version or tag a version.
  Takes an optional argument: patch, minor, major or an exact version."
---

# Release

The steps of [docs/release.md](../../../docs/release.md) up to the push; the pipelines take it from there (a draft
GitHub Release, the GitLab release jobs). This skill is Konspecter's own: unlike `commit` and `konspecter-go`, it has
no copy in `konspecter-billing`.

## 1. Check the ground

Stop and tell the user if any of these fail; do not fix them on the way.

```bash
git status --porcelain        # must print nothing
git branch --show-current     # must be main
git remote                    # there must be a remote; push to the branch's upstream (usually origin)
git fetch --tags <remote>
git status -sb                # main must not be behind its upstream
pnpm versions:check           # every file carries the same version
```

## 2. Work out the version

```bash
node .claude/skills/release/scripts/next-version.mjs [patch|minor|major|X.Y.Z]
```

It prints JSON: `current` (from `package.json`), `lastTag` (the last `v*` tag, or `null`), each commit since it with
the bump it asks for, `level` and `next`. The rules, in order:

- A breaking change (`type!:` or a `BREAKING CHANGE:` footer) is **major**, a `feat` is **minor**, anything else
  (`fix`, `perf`, `docs`, `chore`, …) is **patch**. The release takes the largest.
- **Before 1.0, a breaking change bumps the minor** (docs/release.md: a minor may break before 1.0). 1.0.0 comes only
  when asked for: the argument `major` or `1.0.0`.
- A pre-release (`0.2.0-rc.1`) is released as itself (`0.2.0`).
- With no tag yet, `current` counts as released when `CHANGELOG.md` has its heading (`## 0.1.0 — …`); otherwise it is
  the first release, unchanged.
- An argument replaces the computed bump; an exact version is used as given.

Then read the `## Unreleased` sections of `CHANGELOG.md` (there may be several, `## Unreleased — …`, above the last
version heading). The commits decide the level, but the changelog knows what users see: if it describes a breaking
change (a removed setting, a migration that drops data, an incompatible sync API) and the commits do not say so, raise
the level. If there is no Unreleased section, stop: nothing to release.

## 3. Confirm with the user

Pushing a tag starts the release builds and is public, so ask once with `AskUserQuestion` before changing anything:
the computed version first, marked "(Recommended)", then the other bumps, each with its version
(`0.2.0 (minor)`, `0.1.1 (patch)`, `1.0.0 (major)`). Show why in the descriptions: the counts of breaking, feature and
other commits, and the commits that set the level. If the user is told to "just release" or passed an argument, the
argument is the answer; still name the version before pushing.

## 4. Write the version

```bash
pnpm version:set X.Y.Z
```

It writes `package.json`, `apps/*/package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, the Android
`versionName` and `versionCode`, and `deploy/.env.example`. It refuses a minor or patch of 100 or more (the Android
`versionCode`).

In `CHANGELOG.md`, turn the Unreleased sections into one `## X.Y.Z — YYYY-MM-DD` (today's date, the same form as
`## 0.1.0 — 2026-09-28`). With several Unreleased sections, the first one's entries come first and the names of the
others (`— updates package 2`) become `###` headings over their entries. Change no entry's text. Do not add a new empty
`## Unreleased`: the next change adds it.

```bash
pnpm versions:check
pnpm exec prettier --check CHANGELOG.md
git diff --stat               # only the versioned files and CHANGELOG.md
```

## 5. Commit, tag and push

Commit with the `commit` skill's rules (no `Co-Authored-By:` trailer; its hook blocks one):

```bash
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "Konspecter X.Y.Z"
git push --atomic <remote> main vX.Y.Z
```

`--atomic` pushes the branch and the tag together or neither. Push only this tag, never `--tags`. If the push fails,
leave the commit and the tag in place and tell the user; do not force anything or delete the tag.

## 6. Report

The version and level, the tag, the commit, and what comes next: the release workflow builds a **draft** GitHub
Release (or the GitLab pipeline waits on its manual **publish** job), to be checked and published by hand.
