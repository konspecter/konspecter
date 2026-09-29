# Testing

Every layer is tested where its rules live. Pure domain code gets plain unit tests, storage
runs against real engines (fake-indexeddb, PostgreSQL, temporary folders), and the critical
flows run end to end in a real browser.

## How to run

```sh
pnpm test                          # web: Vitest (jsdom), ~370 tests
pnpm --filter @konspecter/web coverage   # with coverage (text summary + HTML in apps/web/coverage)
pnpm e2e                           # Playwright, real Chromium, production build + service worker
cd server && go test -race ./...   # PostgreSQL tests need KONSPECTER_TEST_DATABASE_URL
cd apps/desktop/src-tauri && cargo test
```

The sync end-to-end tests (`tests/e2e/sync.spec.ts`, `apps/web/src/infrastructure/sync/real-server.e2e.test.ts`)
run against a real server when `KONSPECTER_E2E_URL` and `KONSPECTER_E2E_TOKEN` are set; the
server must allow `http://localhost:4174` (`KONSPECTER_ALLOWED_ORIGINS`). CI runs all of it.

## What is tested where

| Area                                                                | Tests                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Document format (frontmatter, metadata, round-trips, validation)    | `domain/document/document.test.ts`                                                        |
| Markdown → plain text                                               | `domain/document/plain-text.test.ts`                                                      |
| Tags (parser, hierarchy, exclusions)                                | `domain/tag/tags.test.ts`                                                                 |
| Notes, ordering, stamping                                           | `domain/note/note.test.ts`, `file-name.test.ts`                                           |
| Search query parsing, snippets                                      | `domain/search/*.test.ts`                                                                 |
| Conflict strategy                                                   | `domain/sync/conflicts.test.ts`                                                           |
| Reading position, settings                                          | `domain/reading`, `domain/settings`                                                       |
| Storage, migrations v1→v5, tag index, self-repair, recovery         | `infrastructure/storage/*.test.ts`                                                        |
| Search index (ranking, prefix, fuzzy, combined)                     | `infrastructure/search/search-index.test.ts`                                              |
| Sync engine (2–3 devices, offline queue, backoff, conflicts)        | `infrastructure/sync/sync-engine.test.ts` (fake server)                                   |
| Sync against the real server                                        | `infrastructure/sync/real-server.e2e.test.ts`, `tests/e2e/sync.spec.ts`                   |
| File Mode (discovery, write-back, watcher changes, renames, races)  | `infrastructure/folder/folder-store.test.ts`, Rust `folder.rs`/`lib.rs` tests             |
| Import / export (validation, dedupe, ZIP round-trip)                | `application/library/import-export.test.ts`                                               |
| Markdown rendering and HTML safety (XSS vectors)                    | `presentation/markdown/MarkdownView.test.tsx`, e2e "HTML in a note cannot run script"     |
| Editors (lossless text mode, source mode, metadata fields, toolbar) | `presentation/editors/*.test.ts(x)`                                                       |
| Autosave (coalescing, first save, conflicts, failures), note list   | `application/notes/autosave.test.ts`, `note-catalog.test.ts`                              |
| Note page (no remount on create, caret kept, remote changes)        | `presentation/pages/NotePage.test.tsx`, `NotePage.reading.test.tsx`                       |
| Shortcuts, highlighting, activity                                   | `presentation/app/shortcuts.test.ts`, `activity.test.ts`, `domain/search/snippet.test.ts` |
| App flows (layout, sidebar, every page, state and setting)          | `presentation/app/App.test.tsx`                                                           |
| Server API, auth, storage, concurrency                              | `server/**/*_test.go`                                                                     |

## Critical flows (plan §27)

| Flow                                    | Unit / integration                                     | End to end                                                |
| --------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Markdown → index → search               | search index, store search                             | `critical-flows.spec.ts`                                  |
| Markdown → tags → navigation            | tag parser, tag index, App tags                        | `critical-flows.spec.ts`                                  |
| global shortcuts from the editor        | shortcut matching, App shortcuts                       | `critical-flows.spec.ts`                                  |
| layout at any window size, phones       | —                                                      | `accessibility.spec.ts`                                   |
| local edit → sync → server              | sync engine vs fake server, vitest real-server test    | `sync.spec.ts` (two browser contexts)                     |
| external file edit → watcher → document | FolderStore watcher tests, Rust real-watcher test      | — (needs the desktop app)                                 |
| conflict → recovery                     | conflict strategy, engine conflicts, App conflict copy | `critical-flows.spec.ts` (two tabs)                       |
| offline                                 | fake network in engine tests                           | `critical-flows.spec.ts` (service worker, offline reload) |

## Conventions

- Tests sit next to the code (`*.test.ts(x)`); Testing Library queries by role.
- Fakes mirror the real rules and live beside the code they stand in for
  (`fake-server.ts`, `fake-folder.ts`); each is checked against the real thing
  (real-server tests, Rust tests).
- jsdom has no layout: `test-setup.ts` stubs geometry for ProseMirror; CodeMirror is driven
  through `EditorView.findFromDOM` (`editors/test-helpers.ts`).
- Mutation checks were used for tricky tests (blocking handler, title de-duplication):
  remove the code under test and make sure the test fails.
