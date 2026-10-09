# Performance

Measured, then optimized only where the numbers called for it. Machine: Apple
Silicon laptop (2026). Synthetic notes: 4 KB each with headings, lists, code and tags, and
a 200 KB note for the large case.

## How to measure

```sh
pnpm --filter @konspecter/web bench                            # core logic (tinybench, apps/web/src/performance/)
pnpm e2e performance                                           # real Chromium, 2,000-note library
cd apps/desktop/src-tauri && cargo test --release -- --ignored # File Mode file access
```

## Results

### Real browser (Chromium, production build, `tests/e2e/performance.spec.ts`)

| Scenario (2,001 notes)                 | Time   | Budget |
| -------------------------------------- | ------ | ------ |
| cold start to the full note list       | 0.29 s | 5 s    |
| first search right after start-up      | 0.53 s | 10 s   |
| next search                            | 30 ms  |        |
| switch to another note (editor ready)  | 260 ms | 1 s    |
| open a 200 KB note in the editor       | 220 ms | 5 s    |
| type 22 characters in the 200 KB note  | 97 ms  |        |
| open the app on a note (load → editor) | 245 ms | 2 s    |
| import 2,001 files through the UI      | 17 s   |        |

Medians of eight runs on the machine above, after the account site package. Earlier figures
(a 1.4 s cold start, 0.85 s for the first search) timed Playwright as much as the app: a trace
snapshots the page after every action, and an `expect` whose first check fails snapshots it
too. Playwright measures every element for a snapshot, and with 2,001 rows that are
`content-visibility: auto` each measurement forces a layout, so one snapshot blocked the page
for seconds: the cold start read 2.9 s on the laptop and 9 s in CI. The test now runs without
a trace and waits for its timed steps with `locator.waitFor()`, which takes no snapshot.

### Core logic (`core.perf.ts`, Node + fake-indexeddb)

| Operation                                                | Time                   |
| -------------------------------------------------------- | ---------------------- |
| parse a document (frontmatter + metadata)                | 0.014 ms               |
| parse tags / plain text of a 200 KB body                 | 2.2 ms / 2.1 ms        |
| read and sort 1,000 / 5,000 notes                        | 15 ms / 78 ms          |
| search 5,000 notes: `hash map` / `que #topic3`           | 4.8 ms / 2.0 ms        |
| build the search index, 1,000 / 5,000 notes              | 230 ms / 1.15 s        |
| longest main-thread block while building 5,000 (chunked) | **38 ms** (was 1.15 s) |
| save 1,000 notes (with tag index and sync queue)         | 175 ms                 |
| rebuild the tag index, 1,000 notes                       | 88 ms                  |
| first sync of 1,000 notes: push / pull                   | 363 ms / 181 ms        |
| idle sync cycle                                          | 3 ms                   |

fake-indexeddb is slower than browsers' IndexedDB, so storage numbers are upper bounds.
The real-browser startup above confirms it.

### File Mode (Rust, `folder.rs`)

| Operation (5,000 files, 4 KB, 50 folders) | Time  |
| ----------------------------------------- | ----- |
| list recursively                          | 11 ms |
| read every file                           | 99 ms |

## What was optimized, and why

- **Search index build.** It was the only operation that blocked the page noticeably: 1.15 s
  of main-thread work for 5,000 notes on the first search. `SearchIndex.build` now indexes in
  chunks of 150 notes and yields between them. The total time is unchanged, but the longest
  block drops from 1.15 s to 38 ms, under the 50 ms long-task threshold, so typing and
  scrolling stay smooth.
- **Bundle splitting** (earlier phases, also measured): the renderer (153 kB gzipped) and
  the editors (92 kB) load on demand. Start-up loads about 190 kB gzipped: the app (113 kB)
  and a chunk it shares with the editors (77 kB: `yaml` and `markdown-it`, which the note
  list and the search index need).
- **Editor start (updates package 1):** the editor chunk and the search index are prepared
  when the browser is idle after start-up, so opening a note and the first search do not
  wait. The note list's summaries are kept in memory (`NoteCatalog`) and updated one note at
  a time, so a save does not re-read the library. Typing no longer serializes the document:
  the ProseMirror → Markdown conversion runs once per autosave, not per keystroke. The editor
  and its toolbar re-render only for their own state (memoized, stable callbacks).

- **Opening the first note (editor performance package):** the editor appeared about 300 ms
  after its code and the note were there (469 ms from page load to editor, now 182 ms; a note
  shown rendered, 336 ms → 73 ms after its placeholder). React holds back what follows a
  Suspense fallback for up to 300 ms, and the editor and the renderer were loaded with
  `React.lazy`. They now load through `useModule` (`presentation/hooks/use-module.ts`),
  which does not suspend, and the note page reads the note and loads the editor at the same
  time. The renderer is prepared while idle too, and `MarkdownView` renders again only when
  its note changes (it re-parsed the whole note on every focus change).
- **Typing in long notes:** tag highlighting rebuilt its decoration set for the whole
  document on every keystroke, which grows faster than the note does. It now moves the
  previous tags with the edit and looks for tags only in the text blocks the edit changed.
  In the 200 KB note, main-thread time per keystroke fell from 7.6 ms to 4.0 ms (script
  5.0 ms → 1.5 ms); in a 20 KB note it is under 1 ms.

Nothing else is worth optimizing at these numbers. The list renders 2,000 rows in the
startup time above without virtualization; rows off screen skip layout
(`content-visibility: auto`).

## Not measured here

- **Mobile:** no Android device or emulator on the build machine (the SDK downloads are
  blocked, see [clients](architecture/clients.md)). Expect about 3–5× the desktop numbers
  on mid-range phones. The chunked index build matters most there.
- **Desktop inter-process calls:** File Mode reads each file with one command. With very
  large folders, a batched read command would cut the per-call overhead. This was not
  measured, because it needs a GUI-driven test of the packaged app.
- **Watcher under heavy churn** (for example `git checkout` of thousands of files): the
  debounce groups events and an overflow triggers one rescan. The rescan cost is the list
  and read numbers above.
