# ADR-030: Several library folders at once

Status: accepted (2026-11-11). Extends [ADR-024](ADR-024-desktop-folder-sync.md), whose
desktop library was one folder.

## Context

The desktop library was one folder, `~/Konspecter` or another chosen in its place. People
keep notes in more than one place: a personal folder, a work folder, a Git repository of
notes, a folder on another disk. Moving between them meant changing the library's folder,
and only one was open and synced at a time.

## Decision

1. **The library is a list of folders.** The desktop shell keeps it in `folders.json` in the
   app's config folder: each folder's path, an optional alias and when it was added, in
   order. Only the system folder picker adds one (`folder_add`), so the web app still never
   names a location of its own.
2. **A folder's id is a hash of its path.** It is FNV-1a (64 bits) of the saved path, in hex.
   The same folder connected again gets the same id, so its sync links and reading
   positions come back with it.
3. **A note's id is its folder's id, a slash and its path in the folder.** An example is
   `9c1f0a7e3b2d4c58/java/streams.md`.
   - Each folder stays a `FolderStore` of its own, with its own `.konspecterignore`.
   - Inside each folder, the folders follow the tags ([ADR-013](ADR-013-folders-follow-tags.md)).
   - `FolderLibrary` puts the folders together behind the `NoteRepository` port. It lists,
     counts tags, routes every call to the note's folder, and searches all of them in one
     index.
   - Reading positions are kept under `file:<folder id>/<path>`.
4. **Overlapping folders are refused.** A folder already connected (`folder_connected`) is
   refused. So is one inside a connected folder, or holding one (`folder_overlaps`). The
   comparison works on the disk's own files, so a difference in letter case does not get
   past it.
5. **Any folder can be removed, and removing deletes nothing.** Settings → Library removes a
   folder from the list, `~/Konspecter` included. Its files and folders stay where they are.
   - The default `~/Konspecter` is made on the very first start only. A list left empty stays
     empty, and the app then asks for a folder before anything can be written.
   - A folder that cannot be opened (moved, or on a disk that is not mounted) stays on the
     list, marked as one that cannot be opened, with nothing under it. So does an open folder
     whose files cannot be read just now, until they can: the other folders work on, and
     its sync links wait.
6. **Sync covers every connected folder.**
   - **A note new to this device** is written into the first folder in the list.
   - **A folder new to sync** is adopted. This covers a folder that has been connected,
     connected again, or come back, as well as the first start of this version. Everything
     is pulled again, and files that never reached the server wait until that pull is
     complete, as in ADR-024. Other folders' links are kept.
   - **A disconnected folder's links are dormant.** This covers a folder that is removed or
     cannot be opened. Its links push nothing (deletions included) and take nothing in, so
     its notes stay as they are on the server and on the other devices. Connected again, the
     folder picks them up and uploads nothing twice.
   - **An emptied folder is adopted again.** That is a folder with none of its linked files.
     Its notes are written back into the first folder; nothing is deleted.
7. **The tree shows a root per folder when there are several.** Each root is labelled by the
   folder's alias, else its name, and holds that folder's tags and notes. A root folds, has
   a context menu with Show in Finder, Show in Explorer or Show in Files, and remembers its
   folding on the device. With one folder the tree is as before.
8. **A new note goes to the open note's folder** (the first one with none open), or the
   folder is asked for each time. The `newNoteFolder` setting chooses which.
9. **The earlier version moves in once.** `folder.json` becomes `folders.json`. Its folder
   stays the library's folder even if it cannot be opened at that start (a disk not
   mounted): it is listed as such, and `~/Konspecter` does not take its place.
   - In the app's database, the links' paths and the files' reading positions gain the
     folder's id. So does the remembered last location.
   - Nothing is uploaded again.
   - The new state is saved at once and every step skips what it has done already, so an
     upgrade cut short is finished at the next start, never done twice.

## Consequences

- One source of truth per device stays the files. Each file belongs to exactly one folder,
  and a note to exactly one file.
- Adding or removing a folder reloads the window, so the folders' stores, sync and watchers
  start afresh. Pending saves are written first, while their folder is still connected.
- `folders.json` is written atomically, and a change to the list applies only once it is
  saved.
- Some cases are not caught:
  - A folder that is a copy of another connected folder is not an overlap: its files are new
    notes.
  - An unreadable `folders.json` is put aside as `folders.unreadable.json`, not overwritten;
    the start goes on as a first start, so the default folder is connected again.
- With no folder connected, a pull that brings a note new to this device fails and is
  retried until a folder is added. Nothing is lost.

## Alternatives considered

- **The folder's path in the note id.** Note ids would then hold `/Users/…` and backslashes,
  and splitting an id would need the longest matching root.
- **One store over every folder, with the folder's id as the top folder.** That folder would
  become a tag (ADR-013), and every file would be rewritten with it.
- **Forgetting a removed folder's links.** A later pull from the start would then write that
  folder's notes into the first folder, and connecting it again would upload every file
  twice.
- **A random folder id.** Connecting the same folder again could then not find its links
  without matching every file's text.
