# ADR-009: How File Mode and cloud sync interact

Status: accepted (2026-09-28). Conflict copies and the changed-on-disk refusal (3) are
superseded by [ADR-011](ADR-011-last-write-wins.md): the later write wins.

## Context

There are two storage models ([ADR-003](ADR-003-local-first.md), [ADR-004](ADR-004-filesystem-mode.md)):

- **App library:** IndexedDB, note ids are UUIDs, synced with the server through revisions,
  with conflict copies.
- **File Mode:** a folder of `.md` files, note ids are paths, the files are the only copy,
  and other programs change them at any time.

Users of File Mode may also want their notes on other devices. The plan requires that the
two models are not mechanically merged.

## Decision

1. **Cloud sync syncs the app library only.** A folder opened in File Mode is never
   uploaded, mirrored into the library or modified by sync.
2. **Crossing between the two is explicit:** _Import into the app library_ (folder → library,
   skipping content already there) and _export_ (library → folder of `.md` files, with the
   import/export work). Both copy. After that, the copies are independent.
3. **A folder is synced with file-level tools**: Git, iCloud Drive, Dropbox, Syncthing. The
   watcher, the robust reload and the changed-on-disk refusal make Konspecter safe to use
   next to them: their changes appear live, and a concurrent edit becomes a conflict copy
   instead of overwriting.
4. **The app library keeps syncing in the background while a folder is open**, so switching
   back shows current notes. Settings says which library sync applies to.

## Consequences

- Each model keeps its guarantees: revisions and server-side conflict detection for the
  library, and "the files are the truth" for File Mode. No note has two sources of truth.
- A folder user who wants Konspecter's own sync must import. That is a one-time, visible
  step, and it duplicates rather than links.
- There is no cross-device conflict detection for folders beyond what the file-sync tool
  offers. Konspecter's local race handling still prevents overwrites on each device.

## Alternatives considered

- **Folder sync binding** (for a later, separate decision): a `.konspecter/` sidecar in the
  folder maps paths to server ids and records the last synced revision and content hash of
  each file. A file is dirty when its hash differs, pulls are written as files (atomically,
  with the changed-on-disk precondition), deletions go to the trash, and conflict copies
  become files. It is feasible with the existing engine and domain rules, but it has to
  solve renames against server ids, edits made while the app is closed, and case-insensitive
  file systems. It is worth doing only when there is demand.
- **Mirror the folder into IndexedDB and sync that**: two local copies of every note, whose
  disagreements would need a third reconciliation layer. Rejected: it is exactly the
  mechanical merge the plan forbids.
