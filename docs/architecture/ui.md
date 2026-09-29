# User interface

The web app is the UI of every client (browser, desktop, Android). Updates packages 1 and 2
(`.claude/plans/updates-1.md`, `updates-2.md`) define it; this is how it is built. The
interface speaks English and Russian ([i18n](i18n.md)).

## Layout

```text
┌─ Sidebar ─────────────┬─ Top bar: [ search ]  (theme) (mode)               (antenna) ─┐
│ ☰         ⚙  ≡  ✎     ├────────────────────────────────────────────────────────────────┤
│ Tags (tree)           │                                                                │
│ Recent (by last edit) │   Main content: note list · editor · settings                  │
│ ───────────────────── │                                                                │
│ Details (note page)   │                                                                │
└───────────────────────┴────────────────────────────────────────────────────────────────┘
```

- Two panels over the whole window (`components/Layout.tsx`): the sidebar is sticky at full
  height and scrolls on its own; the page scrolls under a sticky top bar (so the reading
  position keeps using the window's scroll). No app header, brand or menu.
- **Sidebar** (`Sidebar.tsx`): toggle, Settings, All notes (`/`), New note; the tag tree (tags as folders,
  notes as documents inside them; a tag's name opens `/?q=#tag`, see [tags](tags.md)); recent notes, most recently edited first, with the open
  one marked. Hidden or shown per device (`localStorage`); on narrow screens it starts hidden
  and slides over the content. While it is hidden, its toggle and New note sit in the top bar.
- **Details** (`NoteDetails.tsx`, the sidebar's footer): on the note page only (new or
  existing), the note page renders its details into the sidebar through a portal
  (`details-slot.tsx`: the layout provides the element, `<Details>` renders into it). What the
  document says about itself: created and edited dates, author, length (words, characters, reading
  time; `domain/document/stats.ts`), tags as written (links to their lists), cover, the file
  (File Mode) and any other frontmatter fields (`otherMetadata`). Below, the actions as icon
  buttons with titles: properties, download or export (open externally and show in
  Finder in File Mode), delete. Delete asks first in the app's own dialog
  (`ConfirmDialog.tsx`: Cancel focused, Escape cancels), since the browser's `confirm()` is
  not shown by every web view. Smaller (12px) and quieter (`--color-faint`, still WCAG AA)
  than the rest of the app.
- **Top bar:** the search box (centre), the theme toggle and the editor mode button to its
  right, a sync hint when sync needs attention, and the antenna at the far right. The
  controls are never hidden. Wide windows (over 1024px): the search is centred, up to 30rem,
  both sides at least as wide as the controls on the right (plus the macOS window buttons).
  Medium (761–1024px): the search fills the row between the controls, with the same gap on
  each side. Small (≤760px): the controls keep the first row and the search takes a second
  row across the whole width (`--topbar-search-row`).
- **Desktop (macOS):** the title bar is an overlay; the window buttons sit in the sidebar's
  top bar and both bars are drag regions (`data-tauri-drag-region`). The web inspector is off
  (`devtools: false`).
- **Stable page:** the page scroller keeps the scrollbar's room (`scrollbar-gutter: stable`),
  so content never shifts sideways when a note grows long enough to scroll. The layout
  measures that room (`use-scrollbar-gutter.ts`, `--scrollbar-gutter`) and keeps the same on
  the main column's left, so its margins are equal on both sides at every width; on small
  screens the note's margins match the search bar's.

## Main content

| Route        | Shows                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `/`          | Every note, most recently edited first, no heading; `?q=` filters it  |
| `/notes/new` | The editor on a new note, focused; stored by its first non-blank save |
| `/notes/:id` | The editor on a note; its details and actions in the sidebar's footer |
| `/settings`  | Settings, including the keyboard shortcuts                            |

- **Search** (`pages/NotesPage.tsx`, `SearchBox.tsx`): focusing the search box shows the list,
  except over an open note (new or existing): that stays while the field is empty, and
  emptying the field again returns to it (the list's router state remembers it). Typing
  filters the list (words and `#tag` filters, [search](search.md)), keeping the recent-edit
  order. Matches are marked in titles and snippets like a highlighter pen (`highlight` and
  `snippet` in `domain/search/snippet.ts`, Unicode-aware, so Cyrillic works). The previous
  results stay while the next search runs, so typing never blanks the list. ↓ moves into the
  results, ↑ and ↓ move between them (↑ on the first returns to the box), Enter opens the
  first. Neither the list nor the results have a visible heading.
- **Tag chips:** the query's tag filters are chips inside the search box, before the text
  (`queryParts`, `takeTags`, `joinQuery` in `domain/search/query.ts`). A typed tag becomes a
  chip when a space follows it (or the field is left), a tag chosen in the sidebar arrives as
  one, and × or Backspace at the start of the field removes one. The URL (`?q=#java hash`)
  stays the truth; the box re-splits it when it changes from elsewhere.
- **Editing** ([editors](editors.md)): there is no permanent toolbar. The formatting toolbar
  is a vertical strip beside the text block holding the caret, shown only while the text has
  focus, absolutely positioned (no layout space, no shift); flat and pale until pointed at,
  and folded to one tool by default. The editing area is a slightly darker panel with room at
  the sides (setting "Editing area"). Changes save themselves
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
search index. The **antenna** is the only activity indicator, in three states: light gray and
still while idle, darker with animated waves while saving or syncing (the dark theme inverts
the emphasis so it stays visible; `prefers-reduced-motion` stops the animation), and crossed
out with an orange X while sync is set up but there is no connection (notes keep saving on the
device and sync when it is back). That is the only sign of it: the top bar shows text only when
sync fails or holds notes back.

## Keyboard

One registry, `presentation/app/shortcuts.ts`, used by the handlers and by the lists in the
`?` dialog and in Settings. `Mod` is ⌘ on macOS and Ctrl elsewhere; the physical key is also
matched, so the shortcuts work on Cyrillic layouts.

| Keys    | Action                          | Where                       |
| ------- | ------------------------------- | --------------------------- |
| `Mod+P` | Search                          | everywhere, also in editors |
| `Esc`   | All notes (the list, `/`)       | everywhere, also in editors |
| `Mod+N` | New note                        | everywhere, also in editors |
| `Mod+,` | Settings                        | everywhere, also in editors |
| `Mod+\` | Show or hide the sidebar        | everywhere, also in editors |
| `Mod+/` | Switch text editor and Markdown | everywhere, also in editors |
| `Mod+S` | Save now                        | the editor                  |
| `/` `n` | Search, new note                | outside text fields         |
| `?`     | Show the shortcuts              | outside text fields         |

Modifier shortcuts are caught in the capture phase, before editors and the browser (no print
dialog on `Mod+P`), and go no further (CodeMirror's own `Mod-/` does not comment the line).
`Esc` leaves the editor for the list, but gives way where Escape already means something: an
open dialog closes, the search box and other form fields let go of the focus, and CodeMirror's
search panel closes. `Mod+\` and `Mod+/` leave the caret where it is: in the editor after hiding the sidebar, and in
the other editor after switching. On a Russian layout they are the keys that type `ё`/`\` and
`.`: the physical key (`Backslash`, `Slash`) is what counts. Browsers keep `Ctrl+N` for themselves in ordinary tabs; it works in the
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
