# User interface

The web app is the UI of every client (browser, desktop, Android). Updates packages 1 and 2
(`.claude/plans/updates-1.md`, `updates-2.md`) define it; this is how it is built. The
interface speaks English and Russian ([i18n](i18n.md)).

## Layout

```text
┌─ Sidebar ─────────────┬─ Top bar: ≡ [ search ]  (theme) (mode)             (antenna) ─┐
│ ☰         ⚙  ✎        ├────────────────────────────────────────────────────────────────┤
│ Tags (tree)           │                                                                │
│ Recent (by last edit) │   Main content: note list · editor · settings                  │
│ ───────────────────── │                                                                │
│ Details (note page)   │                                                                │
└───────────────────────┴────────────────────────────────────────────────────────────────┘
```

- Two panels over the whole window (`components/Layout.tsx`): the sidebar is sticky at full
  height and scrolls on its own; the page scrolls under a sticky top bar (so the reading
  position keeps using the window's scroll). No app header, brand or menu.
- **Sidebar** (`Sidebar.tsx`): toggle, Settings, New note; the tag tree (tags as folders,
  notes as documents inside them; a tag's name opens `/?q=#tag`, see [tags](tags.md)); recent notes, most recently edited first, with the open
  one marked. Hidden or shown per device (`localStorage`); while it is hidden, its toggle and New note sit at the start of the top bar; on small screens it starts hidden
  and covers the whole screen when opened (see [Small screens](#small-screens)).
- **Details** (`NoteDetails.tsx`, the sidebar's footer): on the note page only (new or
  existing), the note page renders its details into the sidebar through a portal
  (`details-slot.tsx`: the layout provides the element, `<Details>` renders into it). What the
  document says about itself: created and edited dates, author, length (words, characters, reading
  time; `domain/document/stats.ts`), tags as written (links to their lists; a tag only the frontmatter lists has a × that removes
  it from `tags`, applied through the open editor as an edit: `NoteEditor`'s `edit`), cover, the file
  (File Mode) and any other frontmatter fields (`otherMetadata`). Below, the actions as icon
  buttons with titles: properties, download or export (open externally and show in
  Finder in File Mode), delete. Delete asks first in the app's own dialog
  (`ConfirmDialog.tsx`: Cancel focused, Escape cancels), since the browser's `confirm()` is
  not shown by every web view. Smaller (12px) and quieter (`--color-faint`, still WCAG AA)
  than the rest of the app.
- **Top bar:** All notes (`/`) right before the search box, always (the list is what the search
  filters); the search box (centre), the theme toggle and the editor mode button to its
  right, a sync hint when sync needs attention, and the antenna at the far right. The
  controls are never hidden. Wide windows (over 1024px): the search is centred, up to 30rem,
  both sides at least as wide as the controls on the right (plus the macOS window buttons).
  Medium (761–1024px): the search fills the row between the controls, with the same gap on
  each side. Small (≤760px): the top bar keeps theme, mode, sync and the antenna; the list,
  the search and the sidebar's controls are in the island.
- **Desktop (macOS):** the title bar is an overlay; the window buttons sit in the sidebar's
  top bar and both bars are drag regions (`data-tauri-drag-region`). The web inspector is off
  (`devtools: false`).
- **Stable page:** the page scroller keeps the scrollbar's room (`scrollbar-gutter: stable`),
  so content never shifts sideways when a note grows long enough to scroll. The layout
  measures that room (`use-scrollbar-gutter.ts`, `--scrollbar-gutter`) and keeps the same on
  the main column's left, so its margins are equal on both sides at every width.

## Small screens

Phones and windows up to 760px wide (`hooks/use-narrow.ts`: `NARROW`, `useNarrow()`; the same
breakpoint in the CSS), in the browser, the PWA and the Android app alike
([plan](../../.claude/plans/mobile-view.md)).

```text
┌──────────────────────── (theme) (mode) (antenna) ─┐
│ Title                                             │
│ Text across the width: 8px room, 4px inside       │
│                                                   │
│      ( ▯  ☰  ⌕  B  ✎   ⚙ )                        │   the island
└───────────────────────────────────────────────────┘
```

- **The island** (`Layout.tsx`): a rounded block fixed at the bottom centre with round 44px
  buttons: sidebar, all notes, search, the text editor's tools (on the note page), new note
  and, a little apart, settings. It stays above
  the open sidebar, whose menu it completes; its links close the sidebar. Search turns it into
  the search box (the same `SearchBox`, the library or the open note) with a close button at
  its end (`onClose`), which empties the query. The box also shows while the list has a query
  (a tag chosen in the sidebar), and goes when a note opens while it does not have the focus
  (a result tapped). It is always on screen, also while a note is edited: both editors scroll
  the caret into view above it (`coveredBelow` in `editors/place.ts`, as ProseMirror's
  `scrollMargin` and CodeMirror's `scrollMargins`). The viewport meta has
  `interactive-widget=resizes-content`, so the island rides above the soft keyboard.
- **Sidebar:** a full-screen menu, without its own bar (the island holds those buttons), in
  bigger text (16px, the tree 15px, the details 14px). The note's details wait behind a
  "Details" button at its foot (`aria-expanded`).
- **Editors:** the editor takes nearly the whole screen, with 8px of room around it (top and
  sides, instead of the page's inset), and its text 4px inside it on every side (CodeMirror's own
  line padding is dropped). The Markdown source is 13px, at a line height of 1.45.
- **Top bar:** a thin strip: 12px from the screen's top edge to its 16px icons, 2px below them.
- **Editor tools** (`TextEditor.tsx`, `IslandTools`): there is no toolbar beside the text; the
  text editor renders its tools into the island through a portal (`island-slot.tsx`: the
  layout provides the element, `<InIsland>` renders into it). The island's button shows the
  tool a folded toolbar would show (the one in effect at the caret, else the last one used,
  as on wider screens); pressing it opens every tool in a column above it, a vertical
  island of its own (rounded, round buttons; it scrolls when the window is short), and using
  one, or tapping elsewhere, closes them. The Markdown source has no tools.
- **Sizes:** text is 16px instead of 17px (times the text size setting); icon buttons 40px,
  toolbar buttons 36px, sidebar rows taller.

## Main content

| Route        | Shows                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `/`          | Every note, most recently edited first, no heading; `?q=` filters it  |
| `/notes/new` | The editor on a new note, focused; stored by its first non-blank save |
| `/notes/:id` | The editor on a note; its details and actions in the sidebar's footer |
| `/settings`  | Settings, including the keyboard shortcuts                            |

- **The list** (`pages/NotesPage.tsx`): two columns where they fit (at least 320px each), one
  on small screens or beside a sidebar on a medium one; the arrow keys move through the grid
  (↑/↓ a row, ←/→ a column). Each item is the cover beside the title (two lines at
  most), the last-edit date and the tags (two lines at most); not the note's text. A note
  without a displayable cover gets its title's first letter on a pastel colour, its hue
  hashed from the note's id so it stays the same (`--cover-*` tokens per theme).
- **Search** (`pages/NotesPage.tsx`, `SearchBox.tsx`): focusing the search box shows the list,
  except over an open note (new or existing): that stays while the field is empty, and
  emptying the field again returns to it (the list's router state remembers it). Typing
  filters the list (words and `#tag` filters, [search](search.md)), keeping the recent-edit
  order. Matches are marked in titles and snippets like a highlighter pen (`highlight` and
  `snippet` in `domain/search/snippet.ts`, Unicode-aware, so Cyrillic works). The previous
  results stay while the next search runs, so typing never blanks the list. ↓ moves into the
  results, the arrow keys move between them (↑ on the first row returns to the box), Enter opens the
  first. Neither the list nor the results have a visible heading.
- **Search in the note** (`note-find.ts`, [plan](../../.claude/plans/note-find.md)): on the
  note page (new or existing) the box searches the open note instead, unless it was opened
  with `Mod+P` or `/` (the library, as above, until the box loses the focus). Every match is
  marked like the list's, the selected one stronger (`--color-mark-current`), and the first
  is scrolled to the middle of the page below the top bar. The box ends in `2/5` and ↑/↓;
  the ↓ and ↑ keys (or Enter and Shift+Enter) go to the next and the previous match, around
  the ends; Tab leaves the box as usual. The caret stays where it was. Matching is
  `findMatches` (`domain/search/find.ts`): the whole query as one phrase, anywhere in a word,
  any case, never across blocks. The layout owns the query and the selected match and hands
  them to the note page through a context; the open view marks and counts: the text editor
  with ProseMirror decorations, the Markdown editor with CodeMirror decorations (it scrolls
  itself, since it draws only the lines in view, and searches the source, frontmatter and
  marks included), the rendered view with the CSS Custom Highlight API (without it, matches
  are counted and scrolled to but not marked). The search ends with the note.
- **Tag chips:** the query's tag filters are chips inside the search box, before the text
  (`queryParts`, `takeTags`, `joinQuery` in `domain/search/query.ts`). A typed tag becomes a
  chip when a space follows it (or the field is left), a tag chosen in the sidebar arrives as
  one, and × or Backspace at the start of the field removes one. The URL (`?q=#java hash`)
  stays the truth; the box re-splits it when it changes from elsewhere.
- **Editing** ([editors](editors.md)): there is no permanent toolbar. The formatting toolbar
  is a vertical strip beside the text block holding the caret (in the island on small
  screens), shown only while the text has focus, absolutely positioned (no layout space, no shift); flat and pale until pointed at,
  and folded to one tool by default. The editing area is a slightly darker panel with room at
  the sides (setting "Editing area"). Changes save themselves
  ([ADR-010](decisions/ADR-010-autosave-editor-first.md)).

## Shared state

- `application/notes/note-catalog.ts`: summaries of every note (title, date, cover, tags),
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

## Errors

The interface shows an error's message only when Konspecter wrote it: the app's own error
classes (invalid document or note, cover image, server answers, "could not reach the
server", folder errors other than `io` and `credentials`). Anything from a library, the
browser or the operating system reads "Oops, something went wrong." (`app.somethingWrong`),
and the real error is logged: `console.error` (the browser console; logcat on Android), and
on the desktop also its log file ([clients](clients.md)). One place decides:
`presentation/app/errors.ts` (`errorMessage`, `reportError`); components use
`useErrorMessage(error)`, which logs in an effect, never during render. Own messages must
not quote a library either: invalid YAML names the frontmatter line, a network failure keeps
the fetch error as its `cause`.

## Keyboard

One registry, `presentation/app/shortcuts.ts`, used by the handlers and by the lists in the
`?` dialog and in Settings. `Mod` is ⌘ on macOS and Ctrl elsewhere; the physical key is also
matched, so the shortcuts work on Cyrillic layouts.

| Keys    | Action                          | Where                          |
| ------- | ------------------------------- | ------------------------------ |
| `Mod+P` | Search                          | everywhere, also in editors    |
| `Mod+F` | Search in the open note         | the note page, also in editors |
| `Esc`   | All notes (the list, `/`)       | everywhere, also in editors    |
| `Mod+N` | New note                        | everywhere, also in editors    |
| `Mod+,` | Settings                        | everywhere, also in editors    |
| `Mod+\` | Show or hide the sidebar        | everywhere, also in editors    |
| `Mod+/` | Switch text editor and Markdown | everywhere, also in editors    |
| `Mod+S` | Save now                        | the editor                     |
| `/` `n` | Search, new note                | outside text fields            |
| `?`     | Show the shortcuts              | outside text fields            |

Modifier shortcuts are caught in the capture phase, before editors and the browser (no print
dialog on `Mod+P`), and go no further (CodeMirror's own `Mod-/` does not comment the line).
`Esc` leaves the editor for the list, but gives way where Escape already means something: an
open dialog closes, the search box and other form fields (CodeMirror's go-to-line field) let
go of the focus. CodeMirror has no search panel of its own: `Mod+F` is the top bar's. `Mod+\` that shows the sidebar moves the focus into it, to the open note (else to what is
current there, else to the first row); `Mod+\` from there hides it and gives the focus back to
where it was, so the caret is in the editor again. Hiding it from the editor leaves the caret
where it is, and `Mod+/` puts it in the other editor. In the sidebar `↑`/`↓` go row by row
through the tag tree and the recent notes as one flat list; `→` opens a tag folder, then goes
to its first entry, and `←` closes it, then goes to the folder above. On a Russian layout they are the keys that type `ё`/`\` and
`.`: the physical key (`Backslash`, `Slash`) is what counts. Browsers keep `Ctrl+N` for themselves in ordinary tabs; it works in the
desktop app and in the installed PWA, and `n` works everywhere.

## Visual rules

- **Font:** Inter (variable, SIL OFL 1.1, `@fontsource-variable/inter`) for UI and text;
  only its Latin and Cyrillic subsets are bundled (`app/fonts.css`) and precached. Code uses
  the system monospace font.
- **Colours** are soft tokens on `:root` with a dark set (`app/app.css`): no pure white,
  black, red, green or blue. The dark set is a dark grey with a slight yellow shade, not near
  black.
- **Focus:** text fields, the search box and the editors show focus by their background or
  caret, never an outline box. Buttons and links keep a focus ring for keyboard users.
- The whole window is used at any size; the note column is at most 720px wide with room on
  its left for the toolbar. WCAG 2.1 AA is checked on every screen in both themes
  (`tests/e2e/accessibility.spec.ts`).
