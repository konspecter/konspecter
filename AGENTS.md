# AGENTS.md — Konspecter

Instructions for AI coding agents (and humans) working in this repository.

Konspecter is a local-first personal knowledge base for notes of every kind.
**The Markdown document is the single source of truth. Everything else is an index.**

## Plans

- Save every new plan as a Markdown file in `.claude/plans/`. This is also the configured
  `plansDirectory` in `.claude/settings.json`.
- **Plans are temporary working files**: the folder's contents are not committed, and a plan
  may be gone tomorrow. Committed documents (`README.md`, `docs/`, ADRs, `CHANGELOG.md`, this
  file) never link to a plan, name a plan file or cite a plan's section (`plan §27`). What a
  plan decided that must last goes into `docs/` or an ADR, and documents point there.

## Current status

| Phase | Scope                                                                           | Status |
| ----- | ------------------------------------------------------------------------------- | ------ |
| 0     | Bootstrap: repo, pnpm, TS, React, Vite, Go module, CI, lint, licenses           | Done   |
| 1     | App shell: layout, navigation, catalog, note page, settings, empty states       | Done   |
| 2     | Local note storage: IndexedDB, note CRUD, loading/error states, tests           | Done   |
| 3     | Markdown document format: frontmatter, metadata, parse/serialize, validation    | Done   |
| 4     | Markdown reader: GFM rendering, code highlighting, safe HTML handling           | Done   |
| 5     | Text editor: ProseMirror, formatting, lossless Markdown generation              | Done   |
| 6     | Markdown editor: CodeMirror 6, source highlighting, mode switching              | Done   |
| 7     | Metadata: title/cover fields, title sync, dates, cover display                  | Done   |
| 8     | Tags: deterministic parser, hierarchical and independent tags                   | Done   |
| 9     | Tag index: IndexedDB multiEntry index, rebuild, transactional updates           | Done   |
| 10    | Tag navigation: Tags page tree, catalog tag filter, note tag links              | Done   |
| 11    | Full-text search: MiniSearch index, ranking, snippets, offline                  | Done   |
| 12    | Combined search: query parsing, tag filters, deterministic ranking              | Done   |
| 13    | Reading position: per-note state, save/restore, restore/ask/off modes           | Done   |
| 14    | Settings: theme, default editor, text size, reading behaviour                   | Done   |
| 15    | PWA: service worker, manifest, offline shell, persistence, update prompt        | Done   |
| 16    | Server API: Go, PostgreSQL, users, tokens, notes, revisions                     | Done   |
| 17    | Sync: change sequence, incremental pull, push queue, retry, offline             | Done   |
| 18    | Conflict resolution: deterministic, server keeps id, local kept as copy         | Done   |
| 19    | Desktop wrapper: Tauri 2 shell, packaging, native bridge                        | Done   |
| 20    | Markdown folder (File Mode): repository port, FolderStore, Rust fs, import      | Done   |
| 21    | Filesystem sync: watcher, incremental reindex, renames, live pages              | Done   |
| 22    | External editors: open/reveal, robust reload, race → conflict copy              | Done   |
| 23    | File Mode + sync: defined (ADR-009); sync is library-only, crossing is explicit | Done   |
| 24    | Mobile: Capacitor 8 Android project, shared UI, CI APK build (iOS skipped)      | Done   |
| 25    | Import/export: .md files and folders in; .md, ZIP or folder out; validation     | Done   |
| 26    | Backup/recovery: self-repairing index, rebuild, unreadable-record recovery      | Done   |
| 27    | Testing: Playwright e2e of critical flows (real browser + server), coverage     | Done   |
| 28    | Performance: measured (bench, browser, Rust); chunked search index build        | Done   |
| 29    | Security: CSP, headers, auth rate limit, revocation, keychain, audits           | Done   |
| 30    | UX/release: shortcuts, WCAG AA, responsive, onboarding, docs, release pipeline  | Done   |

All planned phases are done. New work needs a new plan in `.claude/plans/`.

| Package    | Scope                                                                       | Status |
| ---------- | --------------------------------------------------------------------------- | ------ |
| Updates 1  | Two-panel UI, editor-first notes with autosave, search UX, shortcuts, font  | Done   |
| Updates 2  | Owl icon, English/Russian UI, sidebar details, toolbar, tags, highlighting  | Done   |
| Markdown   | Single source of truth audit: author, frontmatter tags in UI, date aliases  | Done   |
| LWW sync   | Last write wins (no conflict copies), live open notes, server change events | Done   |
| Tag chain  | `#parent#child` is two tags and a parent link; global tag graph in the tree | Done   |
| Note find  | Search box searches the open note (`Mod+F`), marks, ↑/↓ between matches     | Done   |
| Errors     | Library errors read "Oops, something went wrong."; the real one is logged   | Done   |
| Slug file  | File Mode names files by title slug; optional rename when the title changes | Done   |
| Mode place | Switching modes keeps the caret and the text on screen where they were      | Done   |
| Mobile     | Island buttons, full-screen sidebar, details button, top toolbar, sizes     | Done   |
| Updates 4  | Code highlighting, swipes, back/forward, task lists, folders = tags, lists  | Done   |
| Sync site  | Account site, email and social sign-in, devices, end-to-end encrypted sync  | Done   |
| Feedback 1 | Green tick before going on after the sign-in code; copy not only technical  | Done   |
| Feedback 2 | Language dropdown, name in header, sign-in card, HTML emails, QR connect    | Done   |
| Paid sync  | Optional: an external service decides on sync; 402 pause, terms, cookies    | Done   |
| Ignore     | `.konspecterignore`: gitignore rules for folder import and File Mode        | Done   |
| Self-host  | Published images (amd64, arm64), deploy bundle, run-time server URL         | Done   |
| Reset      | Settings → Reset to factory settings: app data erased, the files never      | Done   |
| Folder     | Desktop is always a folder (`~/Konspecter`), synced through file links      | Done   |
| Key by QR  | The site's QR code hands the encryption key over: no passphrase on the app  | Done   |
| Panes      | Sidebar blocks fold like VS Code's: any number open, each scrolls, kept     | Done   |
| Domains    | konspecter.com canonical, `/ru` pages, hreflang, sitemap, `.ru`/`www` 301   | Done   |

Where the packages are described: UI architecture: `docs/architecture/ui.md`; languages:
`docs/architecture/i18n.md`; server and API: `docs/architecture/server.md`; sync:
`docs/architecture/sync.md`; File Mode and `.konspecterignore`:
`docs/architecture/filesystem-mode.md`; self-hosting: `docs/self-hosting.md`. Decisions are in
`docs/architecture/decisions/`: last write wins (ADR-011), change events (ADR-012), folders follow
tags (ADR-013), the account site and end-to-end encrypted sync (ADR-014 to ADR-017), connecting by
QR code (ADR-019), published images (ADR-023), desktop folder sync (ADR-024), the key handed
over by QR code (ADR-025) and the canonical domain with an address per language (ADR-026).

## Working rules

Work proceeds **one phase at a time**, only on explicit instruction.

Before a phase:

1. Inspect the repository, existing code, tests and `docs/architecture/`.
2. Identify the minimum set of changes.

During a phase:

- Implement only the current phase. No future features, no "just in case" abstractions.
- Add tests. Keep the architecture consistent.
- Do not create empty packages, folders or layers. A package appears when it has an
  independent responsibility.

After a phase, run `pnpm check` plus the Go checks, then report:

```text
Changes / Tests / Lint / Typecheck / Build / Known limitations
```

Then stop and wait for the next instruction.

Never implement anything explicitly out of scope (AI, backlinks, wiki links, collaboration,
plugins, templates, tag autocomplete, GraphQL, gRPC, Protobuf, microservices, …) without a
separate decision.

## Repository layout

```text
apps/web/                 React + Vite web app (the shared UI for all clients)
  src/main.tsx            entry point (opens storage, picks the library, root render)
  src/application/        NoteRepository port, note catalog, autosave (notes/), import and export (library/)
  src/domain/             pure domain rules (document/, note/, reading/, search/, settings/, sync/, tag/)
  src/infrastructure/     IndexedDB storage (storage/), search index (search/), API client
                          (http/, the one place notes are encrypted), sync engine and device sign-in
                          (sync/), desktop bridge (desktop/), File Mode (folder/),
                          mobile detection (mobile/),
                          browser files, ZIP, downloads (files/)
  src/presentation/       UI: app/ (routes, styles), components/, editors/, hooks/, i18n/ (en, ru),
                          markdown/, pages/
apps/site/                Account site: React Router (framework mode) with server rendering in
                          Node: landing, Markdown cheatsheet, sign-in, settings (subscription, devices,
                          encryption), /activate, terms and privacy, cookie notice; calls the Go API
  app/routes/             one module per page (loader, action, component)
apps/mobile/              Capacitor 8 Android app around apps/web (android/: generated Gradle project)
apps/desktop/             Tauri 2 desktop shell around apps/web
  src-tauri/src/          Rust: lib.rs (commands), folder.rs (File Mode file access)
apps/server/              Go HTTP server (module konspecter/server)
  cmd/server/             entry point (serve, migrate, create-user, create-token, revoke-tokens)
  internal/               config (env + .env), notes, keys, auth, accounts, devices, oauth, mail,
                          entitlements (paid sync: whether an account may sync),
                          httpapi, storage/postgres
  migrations/             embedded SQL migrations
packages/ui/              shared look of the app and the site: tokens, fonts, base, controls, icons
packages/i18n/            shared message engine: translators, plurals, locale detection, rich text
packages/crypto/          end-to-end encryption on WebCrypto: content key, wrapping, recovery key, envelopes
deploy/                   docker compose: PostgreSQL, the API, the site, the web app and Caddy in front
                          (the site and API on one origin, the web app on its own), from the
                          release's images (compose.build.yaml builds them here instead)
docs/architecture/        architecture overview, UI (ui.md), server (server.md), sync (sync.md) and ADRs
docs/release.md           releasing, and upgrading to end-to-end encryption
docs/self-hosting.md      running your own server from the published images
docs/testing.md           test strategy and map
docs/performance.md       measurements and optimizations
docs/security.md          threat model and measures
tests/e2e/                Playwright end-to-end tests
.claude/skills/           commit, konspecter-go (shared with konspecter-billing), release
logo/                     master logo artwork (SVG: black, white, colour, app tile, light and dark tiles;
                          both tiles as 1024 px PNGs for the GitHub avatar)
docs/license-policy.md    dependency license policy
license-policy.json       machine-readable license policy used by CI
scripts/check-licenses.mjs
scripts/render-icons.mjs  the app icon (bookmark) for every platform: `pnpm icons`
.github/workflows/        GitHub Actions: ci.yml (checks), release.yml (tagged releases)
.gitlab-ci.yml            GitLab CI/CD: the same checks and release builds
```

Every application (web, site, mobile, desktop, server) lives in `apps/`. Libraries shared between
applications go in `packages/`, introduced only when there is real shared code to put there.

## Commands

Run from the repository root (Node ≥ 22.22, pnpm 10, Go 1.27):

```sh
pnpm install
pnpm dev              # web app dev server
pnpm dev:site         # account site dev server (proxies /api to KONSPECTER_API_URL)
pnpm test             # Vitest
pnpm lint             # ESLint
pnpm typecheck        # tsc -b
pnpm build            # production build
pnpm format           # Prettier (write); format:check to verify
pnpm licenses:check   # npm dependency license policy
pnpm check            # all of the above, as CI runs them
pnpm e2e              # Playwright end-to-end tests in Chromium (see docs/testing.md; the account
                      # and sync flows need a live server: KONSPECTER_E2E_* variables)
pnpm icons            # re-render every app icon from scripts/render-icons.mjs (needs e2e deps
                      # and Xcode 26 for the macOS Icon Composer icon)
pnpm version:set 0.2.0 # write a release's version everywhere (docs/release.md);
                      # versions:check verifies it
pnpm --filter @konspecter/web coverage   # unit tests with coverage
pnpm --filter @konspecter/web bench      # performance measurements (docs/performance.md)

cd apps/desktop/src-tauri   # Rust: rustup (Homebrew: /opt/homebrew/opt/rustup/bin)
cargo fmt --check && cargo clippy --all-targets && cargo test && cargo deny check licenses
pnpm --filter @konspecter/desktop dev      # desktop window on the web dev server
pnpm --filter @konspecter/desktop bundle   # release .app and .dmg
pnpm --filter @konspecter/mobile android:debug   # debug APK (JDK 21 + Android SDK)

cd apps/server
gofmt -l .            # must print nothing
go vet ./...
go test -race ./...   # PostgreSQL tests need KONSPECTER_TEST_DATABASE_URL (see docs/architecture/server.md)
KONSPECTER_DATABASE_URL=postgres://… go run ./cmd/server   # migrate + serve on KONSPECTER_ADDR (default :8080)
```

## TypeScript / React

- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any`.
  At external boundaries (storage, network, files) use `unknown` plus validation.
- Components render UI. Business rules live outside React (future `domain/` and
  `application/` folders), not in components or hooks.
- Hooks are for reusable UI behavior, not for hiding the architecture.
- No side effects during render; never mutate props or state.
- Page titles use React 19 `<title>` elements rendered by the page.
- Tests live next to the code (`*.test.ts(x)`), use Testing Library and query by role.

## Go

The `konspecter-go` skill holds the full style. In short:

- Idiomatic Go with domain-oriented packages (`notes`, `tags`, `search`, `sync`,
  `reading`). No `utils`, `common`, `helpers`, `types`, `interfaces` packages.
- Interfaces are defined by the consumer, only at meaningful boundaries.
- No `ServiceImpl`, `RepositoryImpl`, `Mapper`, `Factory`, DI containers or service locators.
- Explicit errors, wrapped with `%w` when context helps.
- `context.Context` at I/O and cancellation boundaries.
- Goroutines only with a clear owner, lifecycle, cancellation and error path.
- HTTP/JSON only.

## Dependencies

Every new dependency needs a license check covering its transitive tree. See
[`docs/license-policy.md`](docs/license-policy.md). Preferred licenses are MIT, BSD-2-Clause,
BSD-3-Clause, Apache-2.0 and ISC. Anything else needs an explicit, recorded decision in
`license-policy.json`. `pnpm licenses:check` enforces this in CI.

Konspecter's own code: the apps and `packages/` are MIT, the server is AGPL-3.0-only. Each
carries a `LICENSE` file and the SPDX id in its manifest (`package.json`, `Cargo.toml`); a new
app or package does the same.

## Billing

Sync can be paid for through a private service, `konspecter-billing`, next to this one.
**Its documentation lives only there**: the contract, the ADRs, the plans and the
`billing-contract` skill. Do not add billing docs, plans, ADRs or skills here, and keep
what this repository says to `KONSPECTER_BILLING_URL`, the `402 subscription_required` pause
and `sync` in `/api/me`. Changes to the paid sync code (`internal/entitlements`,
`internal/httpapi/billing.go`, `internal/mail/subscription.go`, the site's subscription
section) are made from that repository. Without the service, sync is free, and nothing here
may come to depend on it.

## Domains and search

Konspecter's own service ([ADR-026](docs/architecture/decisions/ADR-026-canonical-domain.md)):

| Name                                 | What                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `konspecter.com`                     | canonical: the site and the API (`KONSPECTER_PUBLIC_URL`)        |
| `app.konspecter.com`                 | the web app (`KONSPECTER_APP_ADDRESS`), `noindex`                |
| `www.konspecter.com`                 | 301 to the same path on `konspecter.com`                         |
| `konspecter.ru`, `www.konspecter.ru` | 301 to the same path under `konspecter.com/ru` (`/ru…` as it is) |

- Name the service `https://konspecter.com` and the web app `https://app.konspecter.com`, never
  `konspecter.ru` or a `www.` name. `deploy/.env.example` is filled in with these names;
  self-hosting docs and tests keep `example.com` ones.
- **Public pages** (indexed) are listed in `apps/site/app/pages.ts` and routed twice in
  `routes.ts`: English at the path, Russian under `ru/`. That gives them `<html lang>`, a
  canonical link, `hreflang` en/ru/x-default and a place in `/sitemap.xml`. Every other site
  page has one address, speaks the visitor's language and is `noindex`.
- Link to a public page with `useLocalePath()` and send a visitor home with
  `homePath(request)`, never a bare `"/terms"` or `"/"`.
- Canonical, `hreflang`, `robots.txt` and sitemap URLs come from `KONSPECTER_PUBLIC_URL`, not
  the request's host. A public page redirects (302) to the visitor's language: the one chosen
  with the switch (the `lang` cookie), else, from an English (x-default) address only, the
  browser's (`Accept-Language`). Never move a `/ru/…` address by the browser's language, and
  never redirect by user agent.

## Commit messages

Use the `commit` skill: Conventional Commits, a subject of at most 72 characters, and a
Markdown body when it helps. **No `Co-Authored-By:` trailer, ever.** The skill's
`PreToolUse` hook, registered in `.claude/settings.json`, blocks such commits.

## Skills

| Skill           | Use it for                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| `commit`        | every commit                                                                 |
| `konspecter-go` | writing or reviewing Go: the style this server and the billing service share |
| `release`       | a release: the semver bump from the commits, version, changelog, tag, push   |

`commit` and `konspecter-go` are **the same in `konspecter-billing`**; `release` is this
repository's own. Change the shared two in both repositories together. From there,
`diff -r -x billing-contract -x release .claude/skills ../konspecter/.claude/skills`
must print nothing.

## Definition of done

Implementation complete, tests added, formatting/lint/typecheck/build/tests all pass, no
unnecessary abstractions, and docs (an ADR if applicable) updated when an architectural
decision is involved.
