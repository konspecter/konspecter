# Architecture overview

Konspecter stores notes as Markdown documents. The documents are the data;
search indexes, tag indexes and reading state are derived and can always be rebuilt from
them ([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

## Target architecture

```text
UI (React) ─→ application logic ─→ local storage (IndexedDB) ─→ indexes
                                          ↕
                                     sync engine ─→ encrypts ─→ HTTP/JSON API (Go) ─→ PostgreSQL
                                                                     ↑
browser ─→ account site (React Router, server-rendered in Node) ─────┘
           sign-in, devices, encryption settings

Desktop File Mode (separate backend):
  .md files on disk ↔ filesystem backend + watcher ↔ desktop app (Tauri)
```

- **Local-first** ([ADR-003](decisions/ADR-003-local-first.md)): every core operation
  works offline. The network is never between the user and their data.
- **One UI codebase**: `apps/web` is the React app. The desktop (Tauri) and mobile (Capacitor)
  clients will wrap the same UI rather than fork it.
- **Server**: Go, domain-oriented packages
  ([ADR-005](decisions/ADR-005-domain-oriented-packages.md)), HTTP/JSON, PostgreSQL. It
  stores only ciphertext ([ADR-017](decisions/ADR-017-end-to-end-encryption.md)) and owns
  all account and security logic.
- **Account site**: `apps/site` renders the landing page, sign-in, settings and device
  approval on the server and calls the API ([ADR-014](decisions/ADR-014-account-site.md)).

## What exists today (phases 0–26)

```text
apps/web/src/
├── main.tsx                 opens storage, picks the library backend, renders the app
├── application/             NoteRepository port; import (files, folders) and export
├── domain/document/         Markdown document format: frontmatter, parse, serialize, validate
├── domain/settings/         settings type, defaults and validation
├── domain/sync/             sync bookkeeping types and validation
├── domain/tag/              tag parser: #tag, #parent#child (markdown-it text tokens)
├── domain/note/             Note (id + document) and pure rules (create, update, read, order)
├── domain/reading/          reading position state and scroll maths
├── domain/search/           query parsing (words + #tag filters), snippets
├── infrastructure/search/   in-memory full-text index (MiniSearch)
├── infrastructure/http/     API client (validated responses)
├── infrastructure/sync/     background sync engine (+ fake server for tests)
├── infrastructure/folder/   FolderStore: File Mode backend over the desktop bridge
├── infrastructure/desktop/  desktop bridge (Tauri commands, validated)
├── infrastructure/storage/  NoteStore on IndexedDB (idb), derived tag index
└── presentation/
    ├── app/                 App (route table), activity, shortcut registry, global CSS, fonts
    ├── components/          Layout, Sidebar, SearchBox, Antenna, icons, tag tree, Empty/Error states
    ├── editors/             NoteEditor (Text/Markdown modes), ProseMirror and CodeMirror editors, lazy chunk
    ├── hooks/               useAsync (loading/error/retry), useShortcuts, useReadingPosition
    ├── markdown/            MarkdownView: GFM rendering, sanitizing, highlighting (lazy chunk)
    └── pages/               Notes (list + search), Note (editor + autosave), Settings, NotFound

apps/server/
├── cmd/server/              serve, migrate, create-user, create-token, revoke-tokens
├── internal/                config, notes, keys, auth, accounts, devices, oauth, mail,
│                            httpapi, storage/postgres
└── migrations/              embedded SQL

apps/site/                   account site (React Router framework mode, SSR)
packages/ui/                 the shared look: tokens, fonts, controls, icons
packages/i18n/               the shared message engine
packages/crypto/             end-to-end encryption on WebCrypto
deploy/                      PostgreSQL, the API, the site, the web app and Caddy in front
```

`application/` holds the `NoteRepository` port that pages use, with two implementations: the
app library (`NoteStore`, IndexedDB, synced) and desktop File Mode (`FolderStore`, `.md` files).
See [File Mode](filesystem-mode.md).

### Web app

- Two panels, a sidebar and the main area: see [user interface](ui.md). Routes (React
  Router): `/` every note (`?q=` searches and filters it, also by `#tag`), `/notes/new`,
  `/notes/:id` (both the editor), `/settings`. Anything else shows "not found".
- `main.tsx` opens IndexedDB before the first render and passes the `NoteStore` to `App` as a
  prop, which passes it on to the pages. If IndexedDB cannot be opened, a startup error
  is shown instead.
- The list of notes (sidebar and `/`) comes from `NoteCatalog` (`application/notes/`), loaded
  once and kept current one note at a time from the repository's change events. Pages load
  other data through `useAsync` (error states with retry). Nothing shows a loading text: a
  local read is quick, and the antenna in the top bar shows saving and syncing.
- Opening a note opens the editor: Text mode (rich text, ProseMirror) or Markdown mode (the
  whole document as source, CodeMirror), switched in the top bar. Notes the text editor
  cannot represent are shown rendered, as sanitized, syntax-highlighted Markdown (see
  [reading](markdown-format.md#reading-rendering)). Edits save themselves (`Autosave`,
  [ADR-010](decisions/ADR-010-autosave-editor-first.md)); saving validates the document and
  stamps its dates. See [editors](editors.md).
- The note page shows the cover image, the created and edited dates, and the title, author,
  tags and cover fields over the frontmatter (collapsed while empty).
- Notes with invalid frontmatter are listed and opened as "Unreadable note" so they can be
  fixed.
- The app is an installable PWA that works fully offline. See [clients](clients.md).
- Background sync with the server: see [sync](sync.md).
- Import and export of `.md` files: see [import and export](import-export.md). Backups and
  self-repairing indexes: see [backup and recovery](backup-recovery.md).
- Search: see [search](search.md). Reading position: see [reading](reading.md).
- See the [Markdown document format](markdown-format.md), [storage](storage.md) and the
  [domain model](domain-model.md).
- The styling is plain CSS with custom properties: soft light and dark themes, the Inter
  font (Latin and Cyrillic), a 720px note column. See [user interface](ui.md) and
  [settings](settings.md) for theme, language, text size, editor mode and reading behaviour.

### Server

Go HTTP/JSON API over PostgreSQL: accounts and sessions, devices, the wrapped content key,
and encrypted notes with revisions and optimistic concurrency. See [server](server.md).

### Account site

React Router in framework mode, server-rendered in Node, on the API's origin behind a
proxy. See [user interface](ui.md#the-account-site) and
[ADR-014](decisions/ADR-014-account-site.md) to [ADR-017](decisions/ADR-017-end-to-end-encryption.md).
The hosted web app is on an origin of its own: [ADR-018](decisions/ADR-018-web-app-origin.md).

## Planned frontend structure

As logic arrives, `apps/web/src` grows the layers suggested by the plan: `domain/`
(pure rules such as the tag parser and document format), `application/` (use cases),
`infrastructure/` (IndexedDB, HTTP, filesystem) and `presentation/`. Code that must be
shared with other clients moves into `packages/*` when a second consumer exists, not before.

## Tooling

| Concern   | Tool                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| Packages  | pnpm workspaces (`apps/*`, `packages/*`, `tests`)                                        |
| Build/dev | Vite                                                                                     |
| Types     | TypeScript 6 in strict mode (typescript-eslint does not support 7 yet)                   |
| Lint      | ESLint (typescript-eslint strict type-checked, react-hooks)                              |
| Format    | Prettier; gofmt for Go                                                                   |
| Tests     | Vitest + Testing Library (jsdom); `go test`                                              |
| Licenses  | `scripts/check-licenses.mjs` + `license-policy.json`                                     |
| CI        | GitHub Actions (`.github/workflows/`) and GitLab CI/CD (`.gitlab-ci.yml`), the same jobs |
