# Editors

A note is edited in one of two modes (`apps/web/src/presentation/editors/`). Both edit the
same canonical Markdown document. Opening a note opens the editor, and edits save
themselves ([Autosave](#autosave), [ADR-010](decisions/ADR-010-autosave-editor-first.md)).

| Mode         | Edits                         | Implementation                                            |
| ------------ | ----------------------------- | --------------------------------------------------------- |
| **Text**     | the body, as rich text        | ProseMirror + `prosemirror-markdown`                      |
| **Markdown** | the whole document, as source | CodeMirror 6 ([ADR-006](decisions/ADR-006-codemirror.md)) |

The mode switch is the Text/Markdown toggle in the top bar; the choice is remembered (the
`defaultEditor` setting). Edits carry over when switching modes.

## Text mode

A Telegraph-like editor: the page looks like the rendered note (same `.markdown` typography),
with a contextual formatting toolbar and Markdown-style shortcuts.

- **Contextual toolbar:** hidden until the text has focus. Then it is a vertical strip in the
  margin, starting at the top of the block that holds the caret, and it follows the caret
  from block to block. It is absolutely positioned, so it takes no space and never shifts the
  text. Tab moves from the text into it; it hides when focus leaves both. On narrow screens it
  floats at the right edge.

- **Formatting:** bold, italic, inline code, link, heading (H2), subheading (H3), quote,
  bulleted and numbered lists, and code block. The toolbar shows which marks and blocks
  are active.
- **Shortcuts:** typing `#`–`######` + space makes a heading, `>` a quote, `-`/`*`/`+` a
  list, `1.` a numbered list, and ` ```lang ` + space a code block. Backspace right
  after a shortcut undoes it. `Mod-B/I/\`` toggle marks, `Mod-Z`/`Mod-Shift-Z`undo and redo,`Mod-[`/`Mod-]`outdent and indent list items, and`Shift-Enter` inserts a line break.
- **Markdown generation:** the ProseMirror document uses `prosemirror-markdown`'s CommonMark
  schema, so every editor state maps to Markdown and back. The serializer writes the body.
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

- **Highlighting:** GFM Markdown, YAML in the frontmatter block, and fenced code in its own
  language (grammars from `@codemirror/language-data`, loaded on demand). Colours use the
  reader's tokens, so both themes match.
- **Editing:** undo and redo, search and replace (`Mod-F`), Tab indents, and long lines
  wrap.
- **No autocompletion**, by design, and no bracket closing, so what you type is what is
  saved.

Markdown mode is always available. It is the way to edit whatever Text mode would change.
Text mode is the default for new and existing notes.

## Title and cover

`MetadataFields` edits `title` and `cover` in the frontmatter. While they are empty the fields
stay hidden (the body's heading is the title); a note that has them shows them, and _Title
and cover_ under the text opens both.

## Autosave

`Autosave` (`application/notes/autosave.ts`, no React) owns saving; the note page
(`pages/NotePage.tsx`) wires it to the editor:

- The editor reports every change at once with a function that returns the whole document.
  The ProseMirror → Markdown serialization runs only when that function is called, at save
  time, not per keystroke.
- Saves are coalesced: 400 ms after typing pauses, at most every 2 s while it continues, one
  write in flight, latest text wins. Leaving the note, hiding the tab (`visibilitychange`,
  `pagehide`) and ⌘/Ctrl+S save at once.
- A new note is created by its first non-blank save. Until its first line is finished that
  save waits 2 s, because File Mode names the file after the title. The URL then changes to
  the note's id **without remounting the editor**: both routes render one element and the
  session keeps its React key, so focus, caret and undo history survive.
- Before each save the stored version is compared with the last one the session saw. If it
  changed elsewhere (sync, another program, another tab), or File Mode refuses the write as
  `changed_on_disk`, the text is saved as a conflict copy and editing continues there (the
  editor reloads with the copy's frontmatter; text typed meanwhile is kept). A change from
  elsewhere while nothing is unsaved simply replaces the editor's content.
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
