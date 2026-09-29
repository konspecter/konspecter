# Changelog

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
- Removed: the separate reader, edit and tags pages (`/notes/:id/edit`, `/search`, `/tags`,
  `?tag=`); their functions live in the editor, the list and the sidebar.

## 0.1.0 — 2026-09-28

The first complete version, built phase by phase from the implementation plan.

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
