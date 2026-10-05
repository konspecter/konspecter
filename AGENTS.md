# AGENTS.md — Konspecter

Instructions for AI coding agents (and humans) working in this repository.

Konspecter is a local-first personal knowledge base for technical notes.
**The Markdown document is the single source of truth. Everything else is an index.**

## Plans

- The master plan is [`.claude/plans/konspecter-implementation-plan.md`](.claude/plans/konspecter-implementation-plan.md).
  Read the relevant sections before starting any phase.
- Save every new plan as a Markdown file in `.claude/plans/`. This is also the configured
  `plansDirectory` in `.claude/settings.json`.

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

Specs and notes: `.claude/plans/updates-1.md` (+ `updates-1-implementation.md`), `updates-2.md`
(+ `updates-2-implementation.md`), `markdown-single-source.md`, `last-write-wins.md`, `tag-chains.md` (item 1 of `updates-3.md`), `note-find.md` (item 3), `friendly-errors.md` (item 5), `slug-file-names.md` (item 8), `mode-switch-place.md` (item 14), `mobile-view.md` (mobile view updates), `updates-4.md` (+ `updates-4-implementation.md`). UI architecture: `docs/architecture/ui.md`; languages:
`docs/architecture/i18n.md`.

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

Never implement anything from the plan's "Explicitly out of scope" list (section 30:
AI, backlinks, wiki links, collaboration, plugins, templates, tag autocomplete, GraphQL,
gRPC, Protobuf, microservices, …) without a separate decision.

## Repository layout

```text
apps/web/                 React + Vite web app (the shared UI for all clients)
  src/main.tsx            entry point (opens storage, picks the library, root render)
  src/application/        NoteRepository port, note catalog, autosave (notes/), import and export (library/)
  src/domain/             pure domain rules (document/, note/, reading/, search/, settings/, sync/, tag/)
  src/infrastructure/     IndexedDB storage (storage/), search index (search/), API client
                          (http/), sync engine (sync/), desktop bridge (desktop/), File Mode (folder/),
                          mobile detection (mobile/),
                          browser files, ZIP, downloads (files/)
  src/presentation/       UI: app/ (routes, styles), components/, editors/, hooks/, i18n/ (en, ru),
                          markdown/, pages/
apps/mobile/              Capacitor 8 Android app around apps/web (android/: generated Gradle project)
apps/desktop/             Tauri 2 desktop shell around apps/web
  src-tauri/src/          Rust: lib.rs (commands), folder.rs (File Mode file access)
apps/server/              Go HTTP server (module konspecter/server)
  cmd/server/             entry point (serve, migrate, create-user, create-token, revoke-tokens)
  internal/               notes, auth, httpapi, storage/postgres
  migrations/             embedded SQL migrations
docs/architecture/        architecture overview, UI (ui.md) and ADRs
docs/testing.md           test strategy and map
docs/performance.md       measurements and optimizations
docs/security.md          threat model and measures
tests/e2e/                Playwright end-to-end tests
docs/license-policy.md    dependency license policy
license-policy.json       machine-readable license policy used by CI
scripts/check-licenses.mjs
scripts/render-icons.mjs  the app icon (owl) for every platform: `pnpm icons`
.github/workflows/        GitHub Actions: ci.yml (checks), release.yml (tagged releases)
.gitlab-ci.yml            GitLab CI/CD: the same checks and release builds
```

Every application (web, mobile, desktop, server) lives in `apps/`. Libraries shared between
applications go in `packages/`, introduced only when there is real shared code to put there.

## Commands

Run from the repository root (Node ≥ 22.22, pnpm 10, Go 1.27):

```sh
pnpm install
pnpm dev              # web app dev server
pnpm test             # Vitest
pnpm lint             # ESLint
pnpm typecheck        # tsc -b
pnpm build            # production build
pnpm format           # Prettier (write); format:check to verify
pnpm licenses:check   # npm dependency license policy
pnpm check            # all of the above, as CI runs them
pnpm e2e              # Playwright end-to-end tests in Chromium (see docs/testing.md)
pnpm icons            # re-render every app icon from scripts/render-icons.mjs (needs e2e deps)
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

## Definition of done

Implementation complete, tests added, formatting/lint/typecheck/build/tests all pass, no
unnecessary abstractions, and docs (an ADR if applicable) updated when an architectural
decision is involved.
