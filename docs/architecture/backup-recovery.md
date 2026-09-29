# Backup and recovery

Because Markdown is the canonical data ([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)),
backup is an export, and recovery rebuilds everything else from the documents.
Settings → **Backup & recovery** (app library).

## Backup

_Export all_ ([import and export](import-export.md)) writes every note as a `.md` file: a ZIP
in the browser, a folder on the desktop. The backup is readable with any editor, can be opened
in File Mode, and can be imported again with identical results. The server holds a second copy
of every synced note, including deleted ones, whose Markdown is kept.

## Derived data rebuilds itself

| Data                  | Rebuilt from | When                                                                                                                                                       |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tag index (IndexedDB) | notes        | on open, if its version differs **or it does not match the notes** (an entry without a note, a malformed entry, entries missing), and on _Rebuild indexes_ |
| search index (memory) | notes        | first search of a session, and on _Rebuild indexes_                                                                                                        |
| File Mode indexes     | the files    | on open and on rescans                                                                                                                                     |

A corrupted index can therefore never lose data or hide notes for longer than one start of
the app, and _Rebuild indexes_ repairs it at once.

## Unreadable records

A stored record that fails validation, for example after a bug or tampering, is **not
discarded**:

- It is left out of the library, so the other notes stay usable, instead of making the
  note list fail. Opening it directly reports the error.
- The note list shows a banner that points to recovery.
- Recovery lists each record with the reason. _Download them (.json)_ saves the raw records.
  Only after that is _Remove them_ enabled. Removing never touches readable notes.

Notes with **invalid frontmatter** are not unreadable records: they are valid notes whose
document needs fixing. They stay in the list as "Unreadable note" and open as source, to be
fixed ([Markdown format](markdown-format.md#validation-and-invalid-documents)).

## Recovery paths, summarized

| Problem                            | Recovery                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| index damaged or outdated          | automatic on next start; _Rebuild indexes_                                                                    |
| a record unreadable                | download the raw record, then remove it                                                                       |
| frontmatter invalid                | edit the note (Markdown mode)                                                                                 |
| device lost or storage cleared     | reconnect sync (server copy), or import the last export                                                       |
| a version replaced by a later edit | undo in the editor, an export, or file history in File Mode ([ADR-011](decisions/ADR-011-last-write-wins.md)) |
