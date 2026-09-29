# Editors

A note is edited in one of two modes (`apps/web/src/presentation/editors/`). Both edit the
same canonical Markdown document. Opening a note opens the editor, and edits save
themselves ([Autosave](#autosave), [ADR-010](decisions/ADR-010-autosave-editor-first.md)).

| Mode         | Edits                         | Implementation                                            |
| ------------ | ----------------------------- | --------------------------------------------------------- |
| **Text**     | the body, as rich text        | ProseMirror + `prosemirror-markdown`                      |
| **Markdown** | the whole document, as source | CodeMirror 6 ([ADR-006](decisions/ADR-006-codemirror.md)) |

The mode switch is one icon button in the top bar (pressed while the Markdown source shows;
its icon, a T or the Markdown mark, is the mode it switches to); the choice is remembered (the
`defaultEditor` setting). Edits carry over when switching modes.

## Text mode

A Telegraph-like editor: the page looks like the rendered note (same `.markdown` typography),
with a contextual formatting toolbar and Markdown-style shortcuts.

- **Contextual toolbar:** hidden until the text has focus. Then it is a vertical strip in the
  margin, starting at the top of the block that holds the caret, and it follows the caret
  from block to block. It is absolutely positioned, so it takes no space and never shifts the
  text. Tab moves from the text into it; it hides when focus leaves both. It is always on the
  left: in the column's margin, and on small screens in the editor's left gap (a compact
  toolbar). It stays visible: it grows down from the block's top, and when it does not fit
  below within the window (under the top bar) and there is more room above, it ends at the
  block's bottom and grows up (`toolbarTopFor`); scrolling and resizing place it again. At
  rest it is flat and pale (no frame, muted buttons); pointing at it or moving the focus into
  it brings up its frame.
- **Folding:** the toolbar starts folded (remembered per device, `localStorage`): one tool,
  the one in effect at the caret (a heading, bold…), else the last one used, else Bold, and a
  chevron that unfolds all of them. Unfolded, the chevron folds it again.

- **Formatting:** bold, italic, inline code, link, heading (H2), subheading (H3), quote,
  bulleted and numbered lists, and code block. The toolbar shows which marks and blocks
  are active.
- **Shortcuts:** typing `#`–`######` + space makes a heading, `>` a quote, `-`/`*`/`+` a
  list, `1.` a numbered list, and ` ```lang ` + space a code block. Backspace right
  after a shortcut undoes it. `Mod-B/I/\`` toggle marks, `Mod-Z`/`Mod-Shift-Z`undo and redo,`Mod-[`/`Mod-]`outdent and indent list items, and`Shift-Enter` inserts a line break.
- **First line as title:** in a new note, Enter at the end of the first line makes it the
  title (a level 1 heading) when it is shorter than 50 characters, while the note is still
  that one line, so only once (`firstLineTitle`). Markdown mode does the same by writing
  `# ` in front, unless the line already starts with Markdown syntax.
- **Tags** are marked (a decoration, weight 560: heavier than the text, not bold), outside
  code, with the parser's rules (`tagRanges`).
- **Quotes in code:** a typographic quote the system puts in for a typed `"` or `'` (macOS
  smart quotes, «» in Russian) is replaced by the straight quote in code blocks and inline
  code; text keeps the system's choice.
- **Markdown generation:** the ProseMirror document uses `prosemirror-markdown`'s CommonMark
  schema, so every editor state maps to Markdown and back. The serializer writes the body,
  except that `_` between letters or digits of any script is written as it is (the library
  escapes it unless both neighbours are ASCII, which cut `#новые_технологии` to `#новые`).
  The frontmatter is kept byte for byte (`replaceBody` in the document module).
- **Canonical output:** until the first edit, the document is untouched, so opening and saving
  never reformats a note. After an edit, the body is written in the serializer's style:
  `*` bullets, ATX headings, and soft line breaks joined into one line.

### Never lossy

The text editor only opens a note if it can represent the body without changing what it
means. `markdownToTextDoc` checks two things:

1. **Known unsupported features:** tables, strikethrough and HTML (found with a GFM-aware
   markdown-it pass), plus task lists and footnotes (found by pattern, because markdown-it
   does not parse them and the editor would escape them).
2. **A round trip:** parse → serialize, then compare what the original and the result _mean_:
   token structure, text (soft breaks as spaces), URLs and code, ignoring markers and escapes.

If either check fails, Text mode shows the note **rendered** (read-only, with GFM tables and
highlighted code) with a notice that explains why ("This note uses tables, so it can only be
edited in Markdown mode."); the title and cover fields still work. A note with invalid
frontmatter opens as source, where the frontmatter can be fixed.

## Markdown mode

CodeMirror 6 over the whole document, frontmatter included (`MarkdownSourceEditor.tsx`):

- **Highlighting:** GFM Markdown (headings, emphasis, links and URLs, list and quote markers,
  inline code, escapes), YAML in the frontmatter block, and fenced code in its own language
  (grammars from `@codemirror/language-data`, loaded on demand), with code blocks on the code
  background. Colours are the reader's code tokens (global in `app.css`), so both themes
  match. Tags are marked (outside code, HTML, URLs and the frontmatter).
- **Quotes:** in code blocks, inline code and the frontmatter a typed `"` or `'` stays
  straight even when the system substitutes a typographic quote (see Text mode); `autocorrect`
  and `autocapitalize` are off.
- **Editing:** undo and redo, search and replace (`Mod-F`), Tab indents, and long lines
  wrap.
- **No autocompletion**, by design, and no bracket closing, so what you type is what is
  saved.

Markdown mode is always available. It is the way to edit whatever Text mode would change.
Text mode is the default for new and existing notes.

## Properties

`MetadataFields` edits `title`, `author` and `cover` in the frontmatter. There is no tags
field: tags are written in the text, and a tag only the frontmatter lists is removed in the
note's Details (the × next to it), which hands the editor an `edit` to apply in any mode. Text mode
also writes the body's first line and tags into `title` and `tags` as it serializes
(`withBody`). While the fields are empty or only repeat the body they stay hidden (the body's
heading is the title); a note that has them shows
them, and _Properties_ in the sidebar's Details opens all of them. The cover can be typed as a URL or path, or
uploaded: the image is stored in the frontmatter as a base64 `data:` URL
([format](markdown-format.md#editing-metadata)).

## Editing area

With the setting "Editing area" on (the default), the editor is a panel a shade darker than
the page (`--color-editor`) with the same gap on every side (`--editor-gap`: 28px, 36px on
small screens, where the gap holds the toolbar) and as tall as the note: no empty space is
forced below the text, and the text adds no margin at its top or bottom. Off, the editor sits
on the page as before (`data-editing-area` on `<html>`).

## Saved dates in the editor

Each save writes `created` and `updated` into the stored document. They join the edited
document at once (`withSavedDates`, from the note page's `saved`): into the frontmatter the
text editor keeps, and in Markdown mode into the source, as the smallest in-place change (the
caret stays, it is not undoable). Only the dates are taken over, so text typed while the save
ran is kept. The editor then holds the stored version, which autosave recognizes, so taking
over the dates never causes another save.

## Autosave

`Autosave` (`application/notes/autosave.ts`, no React) owns saving; the note page
(`pages/NotePage.tsx`) wires it to the editor:

- The editor reports every change at once with a function that returns the whole document.
  The ProseMirror → Markdown serialization runs only when that function is called, at save
  time, not per keystroke.
- Saves are coalesced: 400 ms after typing pauses, at most every second while it continues, one
  write in flight, latest text wins. Leaving the note, hiding the tab (`visibilitychange`,
  `pagehide`) and ⌘/Ctrl+S save at once.
- A new note is created by its first non-blank save. Until its first line is finished that
  save waits 2 s, because File Mode names the file after the title. The URL then changes to
  the note's id **without remounting the editor**: both routes render one element and the
  session keeps its React key, so focus, caret and undo history survive.
- The last write wins ([ADR-011](decisions/ADR-011-last-write-wins.md)): a save goes over
  whatever changed the stored version meanwhile (sync, another program, another tab), since
  the edit being saved is the latest. A change from elsewhere while nothing is unsaved
  replaces the editor's content **in place**: a diff (`editors/diff.ts`, Myers) finds the
  stretches that changed, by lines in Markdown and by blocks in the text editor, each narrowed
  to its characters, and only those are replaced. The editor does not reload, and the caret
  and scroll position stay, even with changes both above and below the caret (the
  frontmatter's `updated` date always changes). The change is not reported as an edit
  (nothing is saved back), and undo does not take it back. Only a version that needs another
  kind of view (for example, rendered instead of rich text) opens anew. A note deleted elsewhere while open says so, and the next
  edit brings it back.
- Invalid frontmatter is not saved; the page says so until it is fixed. A failed write keeps
  the text and is tried again on the next change.
- The antenna in the top bar shows a save from its first pending change until it is written.

## Loading

The editors are a separate chunk (about 92 kB gzipped). It is preloaded when the browser is
idle after start-up, so opening a note does not wait; if it is not there yet, the space stays
empty for the moment it takes (no loading text). The renderer for notes Text mode cannot
represent is another chunk, loaded when such a note is opened. A failed load shows an error
state.

## Testing

jsdom has no layout, so `test-setup.ts` stubs `getClientRects`, `getBoundingClientRect`
and `elementFromPoint`, which ProseMirror uses to map selections. Typing and pasting then work
with Testing Library. CodeMirror is read and written through `EditorView.findFromDOM`
(`editors/test-helpers.ts`). The conversion rules are tested without a DOM.
