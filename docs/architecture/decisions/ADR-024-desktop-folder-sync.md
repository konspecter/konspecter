# ADR-024: The desktop library is a folder, and sync covers it

Status: accepted (2026-10-07). Supersedes [ADR-009](ADR-009-file-mode-and-sync.md) and amends
[ADR-004](ADR-004-filesystem-mode.md).

## Context

On the desktop there were two libraries: the app library (IndexedDB, synced) and File Mode
(a folder of `.md` files, not synced by Konspecter, ADR-009). Conspects written in the app
library could not be seen in Finder or Explorer, and a folder could reach other devices only
through Git, iCloud Drive or Syncthing. Users expect the opposite: on a computer, every
conspect is a file they can see, and Konspecter's own sync carries it to their other devices.

## Decision

1. **The desktop always works on a folder.** Without a chosen one it is `~/Konspecter`, made
   on first start: in the home folder, not hidden (a dot-folder would not show in file
   managers), and outside iCloud's Documents folder, whose own sync would compete. Settings →
   Library → _Change folder…_ picks another. The app library is gone from the desktop: on the
   first start after the update its notes move into the folder as files, keeping their ids
   and sync state, so nothing is uploaded again. Web and mobile keep the app library.
2. **Sync covers the folder** through a second implementation of the engine's `SyncStore`
   port, `FolderSync`. The files stay plain Markdown: no ids in them. The app keeps one
   **link** per file in its database (`links`, schema v6), keyed by the server's note id: the
   path, the base revision and the SHA-256 of the text last synced. A file whose text hashes
   differently is dirty, whoever changed it; a linked file that is gone is a deletion; a
   rename (the app's, another program's, or while the app was closed: same text, new place)
   moves the link. Pulls are written with the same placing rules as new notes (folders follow
   tags, names follow titles), deletions go to the trash, and the later edit wins as everywhere
   ([ADR-011](ADR-011-last-write-wins.md)).
3. **A folder new to sync is adopted, not merged blindly.** After choosing another folder, or
   connecting another account or key, the links lose their revisions and the cursor starts
   over. Until the first complete pull, files that never reached the server wait; a note
   pulled with exactly the text of such a file links to it instead of being written again.
   Choosing a copy of the folder therefore duplicates nothing.
4. **An emptied folder deletes nothing.** A folder that holds none of its linked files on
   start is treated as a new one: the server's notes are written into it, nothing is deleted.

## Consequences

- One source of truth per device: on the desktop the files, elsewhere the app library. The
  links are bookkeeping, like the tag index: losing them costs one adoption, never a note.
- File-level sync tools are no longer needed for Konspecter's folder; running one as well
  works (its changes are edits like any other) but is not recommended.
- Changing the folder's ignore rules so that files drop out of it deletes those notes on the
  other devices, as deleting the files would.
- Deleting every file of a folder while the app is closed does not delete the notes: they
  come back on the next start. Deleting them while it runs does.
- Identity rests on the device's links: a file copied into the folder by hand is a new note,
  and a file moved and edited while the app was closed is a deletion and a new note.

## Alternatives considered

- **Ids in each file's frontmatter:** identity would survive any move and copy, but every file
  would carry a field the user did not write, shown by every editor and on every device.
- **Mirroring the folder into the app library** (ADR-009's rejected option): two local copies
  whose disagreements need a third reconciliation layer.
- **Keeping the app library as an option on the desktop:** its conspects would again be
  invisible in the file manager, which is what this decision removes.
