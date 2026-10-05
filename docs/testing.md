# Testing

Every layer is tested where its rules live. Pure domain code gets plain unit tests, storage
runs against real engines (fake-indexeddb, PostgreSQL, temporary folders), and the critical
flows run end to end in a real browser.

## How to run

```sh
pnpm test                          # every workspace: web (~810), site (~70), crypto, i18n
pnpm --filter @konspecter/web coverage   # with coverage (text summary + HTML in apps/web/coverage)
pnpm e2e                           # Playwright, real Chromium, production build + service worker
cd apps/server && go test -race ./...   # PostgreSQL tests need KONSPECTER_TEST_DATABASE_URL
cd apps/desktop/src-tauri && cargo test
```

### Against a live server

Three end-to-end tests need the real stack; without their variables they are skipped. CI
runs all of them.

| Test                                                 | Variables                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tests/e2e/sync.spec.ts`, `real-server.e2e.test.ts`  | `KONSPECTER_E2E_URL`, `KONSPECTER_E2E_TOKEN` (`server create-user`); `KONSPECTER_E2E_PASSPHRASE` optional |
| `tests/e2e/account.spec.ts` (the whole account flow) | `KONSPECTER_E2E_SITE_URL`, `KONSPECTER_E2E_MAIL_LOG`                                                      |

The sync tests set up encryption for the token's account when it has none, with
`KONSPECTER_E2E_PASSPHRASE` (or a default); otherwise that must be its passphrase. The
account flow needs the server running with `KONSPECTER_PUBLIC_URL` set to the site,
`KONSPECTER_MAIL_TRANSPORT=log` (it reads sign-in codes from the server's log) and
`http://localhost:4174` in `KONSPECTER_ALLOWED_ORIGINS`; the site's dev server proxies `/api`
on the same origin, as Caddy does in production. Locally, as CI does:

```sh
export KONSPECTER_DATABASE_URL=postgres://… KONSPECTER_ADDR=127.0.0.1:8080 \
  KONSPECTER_ALLOWED_ORIGINS=http://localhost:4174 KONSPECTER_PUBLIC_URL=http://localhost:5174 \
  KONSPECTER_API_URL=http://127.0.0.1:8080 KONSPECTER_MAIL_TRANSPORT=log
(cd apps/server && go run ./cmd/server > /tmp/server.log 2>&1 &)
pnpm dev:site &
export KONSPECTER_E2E_URL=http://127.0.0.1:8080 \
  KONSPECTER_E2E_TOKEN=$(cd apps/server && go run ./cmd/server create-user -email e2e@example.com | awk '/^token/{print $2}') \
  KONSPECTER_E2E_SITE_URL=http://localhost:5174 KONSPECTER_E2E_MAIL_LOG=/tmp/server.log
pnpm e2e
```

## What is tested where

| Area                                                                  | Tests                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Document format (frontmatter, metadata, round-trips, validation)      | `domain/document/document.test.ts`                                                            |
| Markdown → plain text                                                 | `domain/document/plain-text.test.ts`                                                          |
| Tags (parser, hierarchy, exclusions)                                  | `domain/tag/tags.test.ts`                                                                     |
| Notes, ordering, stamping                                             | `domain/note/note.test.ts`, `file-name.test.ts`                                               |
| Search query parsing, snippets                                        | `domain/search/*.test.ts`                                                                     |
| Conflict strategy (the later edit wins)                               | `domain/sync/conflicts.test.ts`                                                               |
| Reading position, caret, last location, settings                      | `domain/reading`, `domain/settings`, `NotePage.reading.test.tsx`, `app/last-location.test.ts` |
| Storage, migrations v1→v5, tag index, self-repair, recovery           | `infrastructure/storage/*.test.ts`                                                            |
| Search index (ranking, prefix, fuzzy, combined)                       | `infrastructure/search/search-index.test.ts`                                                  |
| Sync engine (2–3 devices, offline queue, backoff, conflicts, stream)  | `infrastructure/sync/sync-engine.test.ts` (fake server), `change-stream.test.ts`              |
| Encryption in sync (ciphertext only, lock, unlock, new key, reset)    | `sync-engine.test.ts` ("end-to-end encryption"), `SyncSettings.test.tsx`                      |
| Sign in with browser, disconnected devices                            | `device-login.test.ts`, `sync-engine.test.ts`, `SyncSettings.test.tsx`                        |
| Sync against the real server                                          | `infrastructure/sync/real-server.e2e.test.ts`, `tests/e2e/sync.spec.ts`                       |
| Crypto (round trip, wrong passphrase, AAD swap, recovery, re-wrap)    | `packages/crypto/src/crypto.test.ts`                                                          |
| Account site (loaders, actions, pages, devices, activate, encryption) | `apps/site/app/**/*.test.ts(x)` (fetch stubbed as the API)                                    |
| The whole account flow, live                                          | `tests/e2e/account.spec.ts`                                                                   |
| File Mode (discovery, write-back, watcher changes, renames, races)    | `infrastructure/folder/folder-store.test.ts`, Rust `folder.rs`/`lib.rs` tests                 |
| Import / export (validation, dedupe, ZIP round-trip)                  | `application/library/import-export.test.ts`                                                   |
| Markdown rendering and HTML safety (XSS vectors)                      | `presentation/markdown/MarkdownView.test.tsx`, e2e "HTML in a note cannot run script"         |
| Editors (lossless text mode, source mode, metadata fields, toolbar)   | `presentation/editors/*.test.ts(x)`                                                           |
| Autosave (coalescing, first save, overwrites, failures), note list    | `application/notes/autosave.test.ts`, `note-catalog.test.ts`                                  |
| Note page (no remount on create, caret kept, remote changes)          | `presentation/pages/NotePage.test.tsx`, `NotePage.reading.test.tsx`                           |
| Shortcuts, highlighting, activity                                     | `presentation/app/shortcuts.test.ts`, `activity.test.ts`, `domain/search/snippet.test.ts`     |
| App flows (layout, sidebar, every page, state and setting)            | `presentation/app/App.test.tsx`                                                               |
| Server API, auth, storage, concurrency, change events                 | `apps/server/**/*_test.go`                                                                    |
| Accounts, sessions, codes, resets, OAuth (fake provider), rate limits | `apps/server/internal/{accounts,oauth,httpapi}/*_test.go`                                     |
| Devices (codes, flow states, revoke closing streams), keys, envelopes | `internal/devices`, `internal/keys`, `internal/notes`, `httpapi/{devices,keys}_test.go`       |
| Cascades on deletion, key reset racing writes (PostgreSQL)            | `internal/storage/postgres/{devices,keys}_test.go`                                            |

## Critical flows (plan §27)

| Flow                                               | Unit / integration                                     | End to end                                                |
| -------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Markdown → index → search                          | search index, store search                             | `critical-flows.spec.ts`                                  |
| Markdown → tags → navigation                       | tag parser, tag index, App tags                        | `critical-flows.spec.ts`                                  |
| global shortcuts from the editor                   | shortcut matching, App shortcuts                       | `critical-flows.spec.ts`                                  |
| layout at any window size, phones                  | —                                                      | `accessibility.spec.ts`                                   |
| local edit → sync → server                         | sync engine vs fake server, vitest real-server test    | `sync.spec.ts` (two browser contexts)                     |
| register → encrypt → connect → disconnect → delete | site and engine tests, Go handler tests                | `account.spec.ts` (live server, site and app)             |
| external file edit → watcher → document            | FolderStore watcher tests, Rust real-watcher test      | — (needs the desktop app)                                 |
| conflict → the later edit wins                     | conflict strategy, engine conflicts, App and File Mode | `critical-flows.spec.ts` (two tabs)                       |
| offline                                            | fake network in engine tests                           | `critical-flows.spec.ts` (service worker, offline reload) |

## Conventions

- Tests sit next to the code (`*.test.ts(x)`); Testing Library queries by role.
- Fakes mirror the real rules and live beside the code they stand in for
  (`fake-server.ts`, `fake-folder.ts`); each is checked against the real thing
  (real-server tests, Rust tests).
- jsdom has no layout: `test-setup.ts` stubs geometry for ProseMirror; CodeMirror is driven
  through `EditorView.findFromDOM` (`editors/test-helpers.ts`).
- Mutation checks were used for tricky tests (blocking handler, title de-duplication):
  remove the code under test and make sure the test fails.
