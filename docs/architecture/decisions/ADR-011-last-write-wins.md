# ADR-011: The last write wins

Status: accepted (2026-09-29). Supersedes the conflict rules of
[ADR-003](ADR-003-local-first.md) ("never lose a document version"),
[ADR-009](ADR-009-file-mode-and-sync.md) (conflict copies in File Mode) and
[ADR-010](ADR-010-autosave-editor-first.md) §4 (conflict copies on save).

## Context

Konspecter is a personal knowledge base: one person, several devices and programs, no
co-editing. Until now a note changed in two places at once became two notes, the original
and a "conflict copy", which the user then had to compare and clean up. In practice the two
versions are the same person's edits minutes apart, and the later one is the one they
want. The copies were noise, and they appeared most often in the everyday case: a note open
in one place and edited in another.

## Decision

1. **The later edit wins, by edit time.** Of two versions, the one whose `updated`
   frontmatter date is later replaces the other: on the server, on every device, and on
   disk in File Mode. Ties, and versions without a date, go to the server's version, which
   is already everywhere. An old offline edit that uploads late loses to a newer one.
2. **Edits beat deletions**, as before: a note deleted in one place but edited in another
   stays, with the edit. The server restores a deleted note when a client updates it at the
   deleted revision.
3. **A save is the latest write.** The editor saves over whatever changed the stored version
   meanwhile (sync, another program, another tab). While nothing is unsaved, a version that
   arrives from elsewhere replaces the editor's content. A note deleted elsewhere while open
   says so, and editing it brings it back.
4. **No conflict copies are made anywhere.** `conflict_of` stays in the document format, and
   older copies still show their banner.

The rule lives in `domain/sync/conflicts.ts` (sync), `application/notes/autosave.ts`
(saves) and `FolderStore.put` (files, written without the changed-on-disk precondition).

## Consequences

- One note stays one note. Nothing to clean up after editing on two devices.
- **The losing version is gone.** The server keeps only the current version, and File Mode
  overwrites the file. Undo in the editor, exports, and file-level history (Git, Time
  Machine) remain the ways back.
- It relies on device clocks being roughly right (normal with NTP). A device whose clock is
  far behind loses its edits to others until it is corrected.
- Two people sharing one account would overwrite each other. Collaboration is out of scope.

## Alternatives considered

- **Keep conflict copies** (Phase 18): never loses a version, but makes work in the common
  case to guard against a rare one.
- **Last to reach the server wins**: needs no clocks, but a laptop that was offline for a
  day would overwrite everything edited meanwhile when it reconnects.
- **Merging (three-way text merge or CRDTs)**: keeps both edits when they touch different
  parts, but is complex, can produce text neither side wrote, and does not fit Markdown
  frontmatter well.
