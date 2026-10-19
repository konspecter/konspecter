# Changelog

## Unreleased

- **A quieter splash screen:** a start quicker than 150 ms no longer flashes the logo; on a
  slower one the logo fades in, now at a ninth of the screen's area, with a soft shadow under
  it.
- **New apps connect only while sync is on:** where sync is paid for, an account whose sync is
  not active (never started, or its time is over) cannot connect another app: the settings and
  the `/activate` page say so and link to the subscription. The apps connected already can
  still be disconnected. The settings no longer blink an error while they check for a newly
  connected app.

## 0.11.0 — 2026-10-20

- **A splash screen while the app starts:** the web, desktop and mobile apps no longer show a
  blank page while they load, which a slow connection made long. The logo appears in the middle
  of the screen at once, at a fifth of its area in either orientation, with the version under
  it, and its red bookmark fills from the bottom up as the app gets ready.
- **Auto renew remembers your choice:** the subscribe form in the settings starts with Auto
  renew as you last chose it, so after paying for one period it starts unticked, even if you
  left that checkout without paying.

## 0.10.0 — 2026-10-20

- **`Esc` no longer goes back:** it only closes dialogs and leaves the search box, as it does
  everywhere else, so pressing it in the editor or in Settings no longer jumps to another page.
  Back is `‹`, ⌘/Ctrl+← outside text, or a swipe on a touch screen.
- **Indent list items with Tab:** in the text editor, Tab nests a list item under the one above
  it and Shift+Tab brings it back out, as ⌘/Ctrl+] and ⌘/Ctrl+[ already did. Inside a list, Tab
  no longer takes the focus out of the text; elsewhere it still moves on.
- **Tag-Chain explained:** the site has a page of its own on how `#parent#child` tags build the
  tag tree, linked from the footer and from the Markdown cheatsheet, in English and Russian.
- **Telegram and VK:** the site's footer links to Konspecter's channels.
- **Paid sync names the step left:** before paying, the buy form says sync takes two steps,
  paying and setting it up, since conspects are encrypted end to end. Once sync is paid, the
  settings and the payment return page name what is left (encryption, then connecting an app)
  until it is done.
- **The payment return page lets go:** a cross closes it for the settings, and it checks on the
  payment only while it is open, so it no longer brings you back after you have left it.
- **Refunds say what they took back:** the refund email tells when the paid time now ends, or
  that it is over, and whether only part of the payment came back; the settings list partly
  refunded payments.

## 0.9.0 — 2026-10-19

- **Hear of new versions on the desktop:** once a day the desktop app looks for a newer
  release; when there is one, a banner says "Konspecter 0.9.0 is available." and _Download_
  opens its page, with what is new and the files. Settings → App → New versions turns the check
  off, and _Check now_ checks once even then.

## 0.8.0 — 2026-10-19

- **New notes take their finished titles:** in a Markdown folder, a new note's file follows its
  title until the note is closed, so a first save of a half-typed title (or one typed in the
  wrong keyboard layout) no longer names the file for good.
- **`pnpm release` writes the changelog:** every `feat`, `fix`, `perf` or breaking commit since
  the last release that wrote no `CHANGELOG.md` entry gets one drafted from its message, shown
  with the release notes; `e` at the question opens the changelog in the editor first.
- **List notes' headings in the sidebar tree:** A note in the tag tree can hold its h1–h3 headings,
  nested; a heading opens the note scrolled to it, in either editor or the rendered view. Off by
  default (Settings → Headings in the sidebar): finding every note's headings slows the start (about
  357 ms instead of 333 ms for 2,001 notes), so summaries skip them unless the setting is on.
- **Swipe through history instead of toggling the sidebar:** A swipe to the right goes back and one
  to the left forward, both past Settings as `Esc` does.
- **Stay locked or unpaid while checking, without a syncing flash:** Each check briefly reported
  `syncing`, so Settings swapped the passphrase form out and back, clearing what was typed and
  making the page jump.
- **Keep a show-password button on every password field:** The only one was the browser's own
  (Edge's), which shows only while the field has text and goes once it loses the focus. Ours is
  always there, lighter while the field is empty.
- **Keep a pin in the note's frontmatter so it syncs:** Pins lived in each device's localStorage, so
  they never reached other devices or File Mode files. A pin is now `pin: 3` in the note (ADR-027).

## 0.7.0 — 2026-10-16

- **Formatting as you type:** in Text mode, typing the closing marker of `` `code` ``, `*em*`,
  `**strong**` or a `[text](url)` link turns it into formatting, and typing `` ` ``, `*` or `_`
  over a selection marks it. Never inside code.
- **Try sync at once:** Try sync for free on the home page and in the account's settings starts
  the trial straight away, without connecting an app first. Signed out, the trial starts after
  sign-in.
- **Pay for one period:** untick Auto renew to pay for a single period that does not renew.
  Nothing is charged again: an email reminds you before the period ends and links to buying the
  next one, and so do the emails when it is over.

## 0.6.1 — 2026-10-16

- **Buying waits for the terms:** Buy sync on the home page and Subscribe in the settings stay
  disabled until the terms are accepted.
- **Your own way, full width:** where the server sells no sync, the "Your own way" card spans
  the whole sync section.
- **Clearer Russian text:** how sync encrypts conspects, and prices read "300 ₽ в месяц".

## 0.6.0 — 2026-10-16

- **Buy sync from the home page:** every price is listed with what it saves against paying
  monthly, and choosing one goes straight to payment. Signed out, the choice is kept through
  sign-in and picked on the settings page.
- **Free sync, and sync for life:** the apps and the account's settings show sync given free
  until a day, or for life (with nothing offered to buy). The account is emailed when it starts
  and when it ends.
- **Price change emails:** a subscriber is emailed when their subscription's price changes,
  with the old and the new price and the day it takes effect.

## 0.5.1 — 2026-10-16

- **A large import is fast again:** importing many `.md` files no longer redraws the sidebar
  after each one. 2,000 conspects now take seconds instead of about half a minute, and so
  does a first sync of a large library.

## 0.5.0 — 2026-10-16

- **A signed Android release:** the APK is a release build signed with Konspecter's own key,
  the same in every release, so each update installs over the previous one. It is no longer
  a debug build (`konspecter-vX.apk`, without `-debug`). The APKs of earlier releases were
  signed with another key: uninstall such an app once (sync or export the conspects first),
  then install this one.

## 0.4.1 — 2026-10-15

- **Signing in leads to the settings:** without a page to go back to, every way of signing in
  (a code, a password, Google and the others) now ends on the account's settings instead of
  the landing page.
- **The Windows folder reads `C:\…`:** the desktop app showed its folder as
  `\\?\C:\Users\…\Konspecter` on the welcome and in Settings. Sync knows it is the same folder,
  so nothing is synced again.
- **The hero's buttons fit one line:** the download button reads just "Download" (the platform
  stays in its accessible name), so in Russian it no longer wraps under "Open in the browser".
- **The sign-in code is centred:** the code field, its label and the code sit centred over the
  buttons, on the code page and on `/activate`.
- **Text fixes:** the Russian sign-in code email puts each closing remark on a line of its own.

## 0.4.0 — 2026-10-14

- **The welcome shows the first keys:** new conspect, search, find in the conspect, the
  editor mode and the sidebar, with `?` for all of them. Touch screens leave them out.
- **The welcome shows the desktop's folder:** "Your conspects are kept as Markdown files in
  ~/Konspecter", already chosen, with _Choose another folder…_ beside it. The folder picker,
  here and in Settings, opens in the folder in use, so confirming it at once keeps it.
- **The pressed shade is only on the phone's island:** a click on any other button or link
  no longer darkens it and fades back, in the app and on the site. The island's big buttons
  keep it, so a tap there is seen.
- **↑/↓ in the sidebar work after a click in the macOS app:** a clicked row or pane header
  now takes the focus, so the keys go on from it with the focus ring. WebKit, under the macOS
  app and Safari, does not focus a clicked link, and the keys had no row to start from.
- **A download page on the site:** `/download` (and `/ru/download`) lists the downloads, then
  how to open the Mac app the first time, install the Android APK and the web app, where
  conspects are kept, and links to the releases, the source, the Markdown guides and
  self-hosting. The footer and the landing page's downloads link to it.
- **Syncing your own way, on the landing page:** Konspecter needs no server, so a section
  explains syncing through a cloud-drive folder, import and export or a server of your own,
  beside this server's sync, free or paid, where it has one. It replaces the paid-only pricing
  section, and its card leads with "No account".
- **The landing page's features fit the sync mode:** where sync is paid they say it takes a
  subscription; where it is off they promise no sync, server or connected devices.
- **The site's forms work behind the TLS proxy:** the site read every request as `http://`, so
  React Router refused each form post behind Caddy with 400. It now runs on its own
  `server.js`, which trusts forwarded headers from a proxy on a private or local address.
- **Text fixes:** the Russian welcome's link to Settings takes the case its sentence needs,
  the reset texts no longer list reading positions among what is erased, and a typo in the
  Russian site description is corrected.

## 0.3.0 — 2026-10-14

- **Sync mode is chosen, not inferred (breaking):** `KONSPECTER_SYNC_MODE` is `free` (the
  default), `paid` or `none`. `KONSPECTER_BILLING_URL` alone no longer makes sync paid: a
  paid server now needs `KONSPECTER_SYNC_MODE=paid`, and without it sync is free and the
  billing settings are ignored.
- **Download links that never change:** each release also has its downloads under names
  without the version (`Konspecter-macos-arm64.dmg`, `Konspecter-windows-x64-setup.exe`,
  `Konspecter-linux-x64.AppImage`, `Konspecter-android.apk` and more), so a site's
  `KONSPECTER_DOWNLOAD_*_URL` can point at `releases/latest/download/<name>` once.

## 0.2.1 — 2026-10-13

- **`pnpm release`** releases from a terminal, without Claude Code: it works out the version
  from the commits, asks, dates the changelog, commits, tags and pushes
  ([docs/release.md](docs/release.md)).
- **Desktop packages for Linux and Windows:** a release builds `.deb`, `.rpm` and `.AppImage`,
  and the `.msi` and `.exe` installers, beside the macOS `.dmg`. Only the macOS formats were
  listed to bundle, so the 0.2.0 release had no Linux or Windows packages.

## 0.2.0 — 2026-10-13

- **Sign in with GitHub** on the account site, in English and in Russian
  (`KONSPECTER_OAUTH_GITHUB_CLIENT_ID`/`_SECRET`, a GitHub OAuth app). A verified primary
  address signs straight in; otherwise the address is proven with a code first.
- **Releases publish themselves:** a tagged release's GitHub draft is published once every
  build has passed, and the images' `X.Y` and `latest` move with it. A repository that sets
  `DEPLOY_REPOSITORY` and `DEPLOY_TOKEN` also tells another repository to deploy the release
  ([docs/release.md](docs/release.md)).
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

### Updates package 2

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

### Updates package 1

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
