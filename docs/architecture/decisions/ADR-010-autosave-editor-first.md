# ADR-010: Notes open in the editor and save themselves

Status: accepted (2026-09-28)

## Context

Until now a note opened in a read-only reader, editing was a separate page, and saving was
explicit (Save / Cancel). Updates package 1 (`.claude/plans/updates-1.md`) asks for an
editor that is visible and interactive at once, realtime persistence without a Save button,
three main states only (new note, edit note, search results), and no loading screens.

The existing guarantees must hold: the Markdown document stays the source of truth
([ADR-002](ADR-002-markdown-source-of-truth.md)), the text editor never changes a note's
meaning, and a version changed elsewhere (sync, another program in File Mode) is never
silently overwritten ([ADR-009](ADR-009-file-mode-and-sync.md)).

## Decision

1. **Opening a note opens the editor.** Text mode shows the rich-text editor; a note it
   cannot represent losslessly is shown rendered (the former reader) and is edited in
   Markdown mode. The Text/Markdown switch is in the top bar and is remembered.
2. **Autosave** (`application/notes/autosave.ts`) replaces Save/Cancel. Changes are
   coalesced (400 ms quiet, at most 2 s while typing), one write is in flight, the latest
   text wins, and pending text is flushed when leaving the note, hiding the tab or pressing
   ⌘/Ctrl+S. The editor hands over a function that produces the text, so serializing happens
   per save, not per keystroke.
3. **A new note is created by its first non-blank save**, and the editing session survives
   the URL change to its id: `/notes/new` and `/notes/:id` render one element, and the
   session keeps its React key. While its first line is still being typed, the first save
   waits 2 s, because File Mode names the file after the title.
4. **The conflict rule applies to every save.** Before writing, the stored version is compared
   with the last one the session saw; if it changed (or File Mode refuses with
   `changed_on_disk`), the text becomes a conflict copy and editing continues on the copy.
   A version that changes elsewhere while nothing is unsaved replaces the editor's content.
5. **Invalid frontmatter is not saved.** The editor says why and saves again once it is
   fixed.

## Consequences

- No Cancel: an edit cannot be discarded by leaving. Undo (⌘/Ctrl+Z) and, with sync, the
  server's revisions remain.
- Two tabs on one note: the later edit in a stale tab becomes a conflict copy (tabs do not
  notify each other).
- Leaving a note while its frontmatter is invalid loses the unsaved part (it is shown as not
  saved meanwhile).
- More writes than before (at most one per 400 ms of typing). Each is one IndexedDB
  transaction or one atomic file write; the measurements in `docs/performance.md` show no
  effect on typing.
