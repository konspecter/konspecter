# User interface

The web app is the UI of every client (browser, desktop, Android). Updates package 1
(`.claude/plans/updates-1.md`) defines it; this is how it is built.

## Layout

```text
┌─ Sidebar ─────────────┬─ Top bar: [ search ]  (theme) (Text|Markdown)      (antenna) ─┐
│ ☰            ⚙  ✎     ├────────────────────────────────────────────────────────────────┤
│ Tags (tree)           │                                                                │
│ Recent (by last edit) │   Main content: note list · editor · settings                  │
└───────────────────────┴────────────────────────────────────────────────────────────────┘
```

- Two panels over the whole window (`components/Layout.tsx`): the sidebar is sticky at full
  height and scrolls on its own; the page scrolls under a sticky top bar (so the reading
  position keeps using the window's scroll). No app header, brand or menu.
- **Sidebar** (`Sidebar.tsx`): toggle, Settings, New note; the tag tree (collapsible
  branches, a tag opens `/?q=#tag`); recent notes, most recently edited first, with the open
  one marked. Hidden or shown per device (`localStorage`); on narrow screens it starts hidden
  and slides over the content. While it is hidden, its toggle and New note sit in the top bar.
- **Top bar:** the search box (centre), the theme toggle and the Text/Markdown toggle to its
  right, a sync hint when sync needs attention, and the antenna at the far right.
- **Desktop (macOS):** the title bar is an overlay; the window buttons sit in the sidebar's
  top bar and both bars are drag regions (`data-tauri-drag-region`).

## Main content

| Route        | Shows                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `/`          | Every note, most recently edited first; `?q=` filters it as you type       |
| `/notes/new` | The editor on a new note, focused; stored by its first non-blank save      |
| `/notes/:id` | The editor on a note; title/cover fields, dates and actions under the text |
| `/settings`  | Settings, including the keyboard shortcuts                                 |

- **Search** (`pages/NotesPage.tsx`, `SearchBox.tsx`): focusing the search box shows the list;
  typing filters it (words and `#tag` filters, [search](search.md)), keeping the recent-edit
  order. Matches are marked in titles and snippets like a highlighter pen (`highlight` and
  `snippet` in `domain/search/snippet.ts`, Unicode-aware, so Cyrillic works). The previous
  results stay while the next search runs, so typing never blanks the list. ↓ moves into the
  results, Enter opens the first.
- **Editing** ([editors](editors.md)): there is no permanent toolbar. The formatting toolbar
  is a vertical strip beside the text block holding the caret, shown only while the text has
  focus, absolutely positioned (no layout space, no shift). Changes save themselves
  ([ADR-010](decisions/ADR-010-autosave-editor-first.md)).

## Shared state

- `application/notes/note-catalog.ts`: summaries of every note (title, date, excerpt),
  loaded once and updated one note at a time from repository change events. The sidebar and
  the list read it with `useSyncExternalStore`, so a save reorders Recent at once without
  re-reading the library.
- `presentation/app/activity.ts`: whether data is moving (a save pending or running, sync
  cycling), with a short linger so brief writes show as one pulse.
- The editor mode is the `defaultEditor` setting; the top bar changes it.

## No loading screens

Nothing shows "Loading…". Local reads take milliseconds, so the space stays empty for that
moment; the editor chunk is preloaded when the browser is idle after start-up, and so is the
search index. The **antenna** is the only activity indicator: light gray and still while
idle, darker with animated waves while saving or syncing (the dark theme inverts the
emphasis so it stays visible; `prefers-reduced-motion` stops the animation).

## Keyboard

One registry, `presentation/app/shortcuts.ts`, used by the handlers and by the lists in the
`?` dialog and in Settings. `Mod` is ⌘ on macOS and Ctrl elsewhere; the physical key is also
matched, so the shortcuts work on Cyrillic layouts.

| Keys    | Action             | Where                       |
| ------- | ------------------ | --------------------------- |
| `Mod+P` | Search             | everywhere, also in editors |
| `Mod+N` | New note           | everywhere, also in editors |
| `Mod+,` | Settings           | everywhere, also in editors |
| `Mod+S` | Save now           | the editor                  |
| `/` `n` | Search, new note   | outside text fields         |
| `?`     | Show the shortcuts | outside text fields         |

Modifier shortcuts are caught in the capture phase, before editors and the browser (no print
dialog on `Mod+P`). Browsers keep `Ctrl+N` for themselves in ordinary tabs; it works in the
desktop app and in the installed PWA, and `n` works everywhere.

## Visual rules

- **Font:** Inter (variable, SIL OFL 1.1, `@fontsource-variable/inter`) for UI and text;
  only its Latin and Cyrillic subsets are bundled (`app/fonts.css`) and precached. Code uses
  the system monospace font.
- **Colours** are soft tokens on `:root` with a dark set (`app/app.css`): no pure white,
  black, red, green or blue.
- **Focus:** text fields, the search box and the editors show focus by their background or
  caret, never an outline box. Buttons and links keep a focus ring for keyboard users.
- The whole window is used at any size; the note column is at most 720px wide with room on
  its left for the toolbar. WCAG 2.1 AA is checked on every screen in both themes
  (`tests/e2e/accessibility.spec.ts`).
