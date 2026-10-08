# Changelog

## Unreleased

- **One canonical domain:** Konspecter's own service is `konspecter.com` (the site and the API)
  and `app.konspecter.com` (the web app). `www.konspecter.com` redirects (301) to the same page
  there, and `konspecter.ru` to the Russian one; a self-hosted server can redirect its own extra
  names the same way (`KONSPECTER_REDIRECT_ADDRESSES`, `KONSPECTER_RU_REDIRECT_ADDRESSES`).
- **Russian pages of their own:** the landing page, the Markdown cheatsheet, the terms and the
  privacy policy are in English at their paths and in Russian under `/ru` (`/ru/`,
  `/ru/markdown`), each with canonical and `hreflang` links for search engines, in a new
  `/sitemap.xml` with `/robots.txt`. Sign-in, settings and the web app stay out of search.
  A Russian browser opening an English page gets its Russian one; the language switch goes
  to the page in the chosen language and keeps the choice, and Russian emails link to
  `/ru/` ([ADR-026](docs/architecture/decisions/ADR-026-canonical-domain.md)).
- **Release notes from the changelog:** a release's GitHub draft and GitLab Release carry the
  version's `CHANGELOG.md` section as their notes (`scripts/release-notes.mjs`), and a tag
  without one stops at the first job. In Claude Code, `/release` picks the version from the
  commits, dates the changelog, tags and pushes ([docs/release.md](docs/release.md)).
- **Settings in groups:** Appearance, Writing and reading, Sync, Conspects and files, Keyboard
  shortcuts and App, each a tinted panel of rows. A setting's name and hint sit on the left;
  its control, and a section's buttons, keep to the right edge, on one line in every language.
  A few short choices are a segmented control, longer ones a dropdown. On a phone a segmented
  control is one row across the width, in every language (Russian “Крупнее” and “Продолжать,
  где остановился” are shorter to fit).
- **No collapsing page on Android:** anything wider than the screen made the WebView widen the
  page, which read as a scrollbar hundreds of pixels wide and squeezed the column to nothing.
  The scrollbar is now measured on its own (0 on phones).
- **No blue flash on tap** in the Android app: the WebView's tap highlight is off. Instead, a
  pressed button or link shades at once and fades back over 200 ms, in the app and on the site.
- **`pnpm version:set 0.2.0`** writes a release's version into every file that carries it,
  now including the Android app: `versionName` is the version and `versionCode` follows it
  (`major * 10000 + minor * 100 + patch`) instead of a fixed `1.0` and `1`
  ([docs/release.md](docs/release.md)).
- **Conspects have their own addresses:** `/conspects/new` and `/conspects/:id` instead of
  `/notes/…`. Old links and the place the app last showed still open, at the new address. The
  server API keeps `/api/notes`.
- **Sidebar panes fold** like VS Code's: Tags, Recent and Details each fold on their header,
  any number open at once, each scrolling on its own; what is folded is kept per device.
- **Self-hosting from published images.** Each release pushes `konspecter-server`,
  `konspecter-site` and `konspecter-web` for amd64 and arm64 (GHCR, and the GitLab
  registry), plus a deploy bundle: `compose.yaml`, `Caddyfile` and `.env.example`. Download
  it, fill in `.env`, `docker compose up -d` ([docs/self-hosting.md](docs/self-hosting.md),
  [ADR-023](docs/architecture/decisions/ADR-023-published-images.md)). The web app now
  learns the server it suggests from its host (`/config.json`) instead of its build.
  `deploy/compose.yaml` pulls images; `compose.build.yaml` builds them from a checkout, and
  `.env` needs `KONSPECTER_VERSION`.
- **Connect an app by QR code.** Account settings on the site show a QR code (and its link);
  scanning it in the app (Settings → Sync → Scan QR code) or pasting the link connects the
  app with no server address or code to type. A code works once, for 5 minutes. The server
  gains migration `007_connect_codes.sql`; Android asks for the camera on first use
  ([ADR-019](docs/architecture/decisions/ADR-019-connect-by-qr-code.md)).
- **Sign-in page:** a card with the email form and the other services side by side (one
  column on phones). A one-time code by email comes first; the password field shows on
  _Use password_.
- **HTML emails** with the logo, a large code or a button, and a footer; the plain text is
  still sent alongside.
- **Language as a dropdown** on the site and in the app's settings; the site's header
  greets an account by its name when it has one.
- **The landing page speaks to everyone:** new copy, a recipe instead of SQL in the picture,
  and larger hero text.
- **The server hosts the web app too.** `deploy/compose.yaml` runs it as a `web` service
  (`apps/web/Dockerfile`, with the server already filled in for sync), and Caddy serves it on
  a second address (`KONSPECTER_APP_ADDRESS`, e.g. `app.notes.example.com`). Add its URL to
  `KONSPECTER_ALLOWED_ORIGINS` (and `KONSPECTER_DOWNLOAD_WEB_URL` for the landing page link).
- **A new logo and app icon: the Konspecter bookmark.** A slanted, woven # (the tags and
  Markdown headings conspects are made of) with one stroke turned into a red bookmark ribbon
  (the app remembers where you stopped), white on a graphite plate. It replaces the owl on
  every platform (macOS, Windows, iOS/Apple touch, Android adaptive and themed icons, PWA,
  favicon, splash screens); the favicon uses a heavier cut that stays clear at 16 px. The
  account site shows it without the plate, in graphite or white by the site's theme. The
  master artwork is in `logo/`.

## Unreleased — updates package 2

- The Tags field over the text is gone: tags are written in the text. A tag listed only in the
  frontmatter has a × next to it in Details that removes it, in either editor mode.
- **Frontmatter stays as you type it.** Saving no longer rewrites the whole YAML block in
  the Markdown editor (which dropped a space just typed at the end of a line, blank lines and
  comments' spacing, and re-indented lists): only the lines of the fields the app sets (the
  dates, and the title, cover or tags when edited elsewhere) change.
- **The app opens as you left it:** on the page you were on (a conspect, a search, settings),
  scrolled where you were, and when you were editing, with the cursor where it was and the
  editor focused. The desktop window waits for the last changes to be saved before it closes.
- **The later edit wins.** A conspect changed in two places (two devices, the app and another
  program, two tabs) no longer splits into a "conflict copy": the version edited later
  replaces the other everywhere, and edits still beat deletions. An open conspect follows
  changes from elsewhere while nothing is unsaved in it, in place: the editor does not
  reload and the cursor stays where it was.
- **Edits arrive at once.** The server tells connected apps when something changed
  (`GET /api/events`, Server-Sent Events), and each save is uploaded right away, so an edit
  shows on the other devices about half a second after the typing pauses (at least every
  second while it goes on); without the event stream they check every 10 s.
- An "All conspects" button (a list icon) in the sidebar between Settings and New conspect,
  and in the top bar while the sidebar is hidden, and <kbd>Esc</kbd> to get there from
  anywhere, also from the editor.
- A new app icon: the Konspecter owl, a simple, friendly orange owl with big amber eyes
  holding an ancient parchment scroll on wooden rods, a flat mascot with fine brown outlines
  on a warm cream plate, drawn in
  each system's style (macOS squircle with shadow, full-bleed iOS/Apple touch icon, Windows
  tile, Android adaptive and themed icon, PWA maskable icon), and new Android splash screens.
- English and Russian, chosen from the system's language (English otherwise) or in Settings →
  Language; a change applies at once.
- The note's details move to the sidebar's footer, "Details": dates, length, tags, cover and
  other frontmatter fields, with the actions as icon buttons; smaller and quieter text.
- The formatting toolbar is flat and pale until pointed at, folds to one tool, always stays on
  the left (also on phones) and grows upward when there is no room below.
- The editing area is a slightly darker panel with the same gap on every side, as tall as the
  note (setting "Editing area"), more distinct in the dark theme; page margins are equal on
  both sides at every width.
- Deleting a note asks for confirmation in the app's own dialog.
- Shortcuts ⌘/Ctrl+\ to show or hide the sidebar and ⌘/Ctrl+/ to switch between the text
  editor and Markdown, from anywhere, also on a Russian layout.
- The note list and search results have no heading; tag filters are chips inside the search
  box (a typed `#tag` becomes one after a space; × or Backspace removes it).
- ↑ and ↓ move through the note list and search results; ↑ on the first goes back to the
  search box.
- Over an open note, focusing the search box (also ⌘/Ctrl+P or `/`) keeps the note; the list
  appears once something is typed, and clearing the field returns to the note.
- A cover image can be uploaded (_Upload…_ next to the cover field): it is scaled down and
  stored in the note itself as a base64 `data:` URL, so it syncs and exports with the note.
- In a new note, a first line shorter than 50 characters becomes the title when Enter ends it.
- The interface calls notes "conspects" (in Russian «конспекты»), everywhere they are shown; the
  sidebar's tag tree is «Теги» in Russian. The export ZIP is `konspecter-conspects.zip`. Code,
  storage, the server API and URLs (`/notes/…`) keep the name "note".
- Tags in notes are a little heavier than the text; tag names in the sidebar start with a
  capital letter (setting "Tag names").
- Markdown mode highlights the Markdown and fenced code (```json and others) in colour; a
  typed `"` stays straight in code and frontmatter instead of turning into «».
- The antenna shows a third state: crossed out with an orange X when sync has no connection;
  it is the only sign of it (no "Offline" text in the top bar).
- The page no longer shifts sideways when a scrollbar appears.
- The desktop app no longer opens the web inspector.
- The dates each save writes (`created`, `updated`) appear in the editor at once, also in
  Markdown mode's source, so the editor and the stored note never differ.
- Tags listed in the frontmatter's `tags` field count as the note's tags: in the sidebar
  tree, search filters and Details.
- Fixed: coming back to a note right after leaving it could show it without its last changes
  until later; opening a note now waits for its save still running.
- Fixed: a tag with `_` in Cyrillic (`#новые_технологии`) typed in the text editor was saved
  as `#новые\_технологии` and cut to `новые`.
- The author (`author`) and the frontmatter's tags can be edited in the note's properties
  (_Properties_ in Details, formerly _Title and cover_); Details shows the author. Everything
  is written into the Markdown's frontmatter, keeping the rest of it as written.
- Text mode keeps the frontmatter in step with the text: the first line becomes `title`
  (unless a different title was set) and every `#tag` typed is listed in `tags`; a tag
  deleted from the text leaves the list.
- Dates written by other tools as `create_at` / `updated_at` are understood, and saving keeps
  those names instead of adding `created` / `updated` beside them.

## Unreleased — updates package 1

- A two-panel window: a sidebar with the tag tree and recently edited notes, and a top bar
  with search, the theme and Text/Markdown toggles, and an activity antenna. No app header.
- Notes open straight in the editor and save themselves as you type (no Save button); a new
  note keeps its editor when it is first stored. Edits that cross a change made elsewhere
  still become conflict copies.
- A contextual, vertical formatting toolbar beside the block being edited.
- Search from the top bar filters every note as you type, most recently edited first, and
  marks what matched (Cyrillic included).
- Global shortcuts ⌘/Ctrl+P, ⌘/Ctrl+N and ⌘/Ctrl+, (also on Cyrillic keyboard layouts).
- No loading screens; the editor and the search index are prepared in the background.
- The Inter font (Latin and Cyrillic), softer colours, and focus shown without outline boxes.
- The sidebar's tag tree reads like a project explorer: tags are folders, the notes tagged
  with them are documents inside, with folder and document icons and indent guides.
  Tag names show as written (case kept) with `_` as a space.
- The Text/Markdown switch in the top bar is a single icon button: a T for the text editor,
  the Markdown mark for the source.
- The top bar search is centred on wide windows, fills the row between the buttons on medium
  ones and has its own full-width row on small screens; the buttons are no longer hidden.
- Removed: the separate reader, edit and tags pages (`/notes/:id/edit`, `/search`, `/tags`,
  `?tag=`); their functions live in the editor, the list and the sidebar.

## 0.1.0 — 2026-09-28

The first complete version, built phase by phase.

- Markdown documents with YAML frontmatter (title, dates, cover) as the only source of truth.
- A text editor (ProseMirror) that never changes a note's meaning, and a Markdown editor
  (CodeMirror 6) with metadata fields.
- GFM reader with syntax highlighting and sanitized HTML.
- Tags anywhere in the text, with hierarchy, a tag tree and filters.
- Offline full-text search combined with tag filters, with snippets.
- Reading-position memory, and settings (theme, editor, text size, reading behaviour).
- An installable PWA that works offline.
- A Go server with PostgreSQL: accounts, tokens, notes with revisions.
- Background sync with an offline queue, retries, and deterministic conflict resolution that
  keeps every version.
- A desktop app (Tauri 2) with File Mode: a folder of `.md` files, a file watcher, external
  editors, and race handling.
- An Android app (Capacitor 8).
- Import and export of `.md` files, folders and ZIPs, backup, and self-repairing indexes.
- Security hardening (CSP, headers, rate limiting, token revocation, keychain storage),
  accessibility checks (WCAG AA) and performance measurements.
