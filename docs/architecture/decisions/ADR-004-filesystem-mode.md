# ADR-004: File Mode is a separate storage backend

Status: accepted (2026-09-28)

## Context

Desktop users want their notes as plain `.md` files in a folder they control, editable with
other tools. The app library (IndexedDB) has different properties: ids independent of file
names, derived indexes persisted alongside, background sync with revisions and conflict
copies.

## Decision

File Mode is a second implementation of the UI's `NoteRepository` port (`FolderStore`),
chosen at startup. It is not a sync target of the app library, and the two are not merged:
in File Mode the files are the only copy, note ids are paths, and derived indexes live in
memory. File access goes through Rust commands that accept only paths relative to a folder
chosen in the native picker.

## Consequences

- Every screen works with both backends, and pages depend on the port only. This is the
  first code in `application/`.
- File Mode has no sync (yet). Moving notes between the two is an explicit _import_.
- External changes must be detected (a watcher), and writes must not overwrite them. That
  is the filesystem-synchronization work.
- Renaming a file changes a note's id. The watcher detects renames and pages follow them.

## Alternatives considered

- **Mirror files into IndexedDB and sync them**: one code path in the UI, but two copies of
  every note, whose disagreements would have to be reconciled, including with the server.
- **Filesystem access from the web view** (File System Access API): not available in the
  WebKit web views Tauri uses on macOS and Linux, and weaker scoping than native commands.
