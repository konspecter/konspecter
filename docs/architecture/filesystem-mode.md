# File Mode (desktop)

On the desktop, the library can be a real folder of Markdown files instead of the app's
own database ([ADR-004](decisions/ADR-004-filesystem-mode.md)). The files are the only copy
of the notes. Other programs (VS Code, Vim, Obsidian, Git) can read and change them, and
Konspecter reads and writes them in place.

```text
~/Notes/
├── java.md
├── databases/postgres.md
└── networking.md
```

## Choosing the library

Settings → **Library** (desktop only):

- **App library** (default): notes in IndexedDB, with sync.
- **Open a Markdown folder…** shows the system folder picker. The app reloads on the folder.
  _Use the app library_ switches back. The folder's files are never changed by switching.
- **Import into the app library** copies the folder's files into the app library, for
  example to sync them. Files whose content is already in the library are skipped, so
  importing twice adds nothing, and the files themselves stay as they are.

The choice is remembered by the desktop shell (`folder.json` in the app's config
directory). **Sync applies to the app library only.** To sync a folder across devices, use Git,
iCloud Drive, Dropbox or Syncthing ([ADR-009](decisions/ADR-009-file-mode-and-sync.md)).

## How it works

```text
pages ─→ NoteRepository ─┬─ NoteStore    (IndexedDB, synced)       — app library
   (application/notes/)  └─ FolderStore  (folder on disk)          — File Mode
                                   │ desktop bridge (TypeScript, validated)
                                   ▼
                          Rust commands (src-tauri/src/folder.rs)
```

- **`NoteRepository`** (`application/notes/`) is the port every page uses. Both backends
  implement it, and neither knows about the other.
- **`FolderStore`** (`infrastructure/folder/`) reads every `.md` file into an in-memory
  cache and derives the tag index and the search index from it, just as the app library
  derives its indexes from notes. A note's **id is its path** relative to the folder (for
  example `databases/postgres.md`). Reading positions are kept in the app's database
  under `file:<path>`, never in the files.
- **Metadata** is parsed from each file's frontmatter, exactly as for library notes.
  Files without frontmatter are fine. Without an `updated` date, a file is ordered by its
  modification time. Saving from the app stamps `created`/`updated` into the frontmatter,
  as it does everywhere.

## Following changes on disk

Other programs can change the folder at any time. The app follows:

```text
file saved in Vim ─→ Rust watcher (notify, 300 ms debounce) ─→ event "folder-changed"
                 ─→ FolderStore re-reads those files ─→ cache, tag and search indexes
                 ─→ change events ─→ pages that show them reload
```

- **Watcher:** `notify` watches the folder recursively, debounced so a burst of writes is one
  event. It reports relative `.md` paths. It ignores hidden files, which includes the app's own
  temporary files, and other file types. A folder rename or a watcher error asks for a
  **rescan** instead, which re-reads the file list.
- **Incremental update:** only the reported files are re-read. A new file is added, a
  missing file removed, and a changed file replaced, with its tags and search entry
  updated. Unchanged content, typically the app's own write coming back, only updates the
  recorded modification time and emits nothing.
- **Renames:** a file that disappeared while a file with identical content appeared in the
  same batch is a rename. The reading position moves to the new path, and an open note page
  follows it to the new id.
- **Write-back:** saving writes the file atomically. If the file changed on disk since it was
  read, the write is refused rather than overwriting the other program's version.
- **Live pages:** the note list, the sidebar (recent notes, tags), search results and the
  open note follow changes, keeping the current content visible meanwhile. The same mechanism
  shows notes that arrive by sync. The editor reloads a changed note only while nothing is
  unsaved; with unsaved text it keeps the version it opened, so the next save detects the
  change and keeps both versions instead of overwriting.

## External editors

```text
Konspecter  ⇄  ~/Notes/java.md  ⇄  VS Code / Vim / Neovim / …
```

- **Open in external editor** (note page, File Mode) opens the file with the system's
  default app for `.md`. **Show in Finder** reveals it (other platforms open the containing
  folder). There is deliberately no "custom editor command" setting: a command line
  configurable from the web view would let injected script run programs.
- Changes made in the other editor arrive through the watcher. The open note reloads (when
  nothing is unsaved in it), and the list, tags and search follow.
- **Robust reload:** editors that save by deleting and recreating the file (a common atomic
  save) make it vanish briefly. A known file that is missing is checked again after 150 ms
  before it counts as deleted. Temporary and swap files are hidden or not `.md`, and are
  ignored.
- **Race handling:** both editors may change the same file.
  - While the in-app editor is open, a change on disk shows a banner: _changed elsewhere since
    you opened it_.
  - Saving then applies the sync rule ([sync](sync.md#conflict-resolution)): the file keeps
    the other program's version, and the in-app edit becomes a **conflict copy** file (the
    title marked, `conflict_of: <path>` in the frontmatter), which opens.
  - If the other program writes after the check but before the save, which the watcher
    has not reported yet, the atomic write's modification-time precondition refuses
    (`changed_on_disk`) and the same conflict copy is made.
  - Nothing is overwritten, and nothing is lost.

## The native side (Rust)

`src-tauri/src/folder.rs`, exposed as commands in `lib.rs`:

| Command                          | Does                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `folder_pick`                    | system folder picker; opens and remembers the folder                                                                  |
| `folder_current`, `folder_close` | the open folder, or none                                                                                              |
| `folder_list`                    | every `.md` file, recursively, sorted by path                                                                         |
| `folder_read`                    | a file's text and entry (path, modification time, size)                                                               |
| `folder_write`                   | atomic write (temporary file + rename); refuses with `changed_on_disk` if the file changed since `expectedModifiedMs` |
| `folder_create`                  | a new top-level file named after the title (`Title.md`, `Title 2.md` …), never overwriting                            |
| `folder_trash`                   | moves the file to the system trash                                                                                    |

### Safety

- **Only the native folder picker can choose the folder.** The web app passes only relative
  paths, so it cannot aim file access anywhere else, even if script were injected.
- Every path is validated: no `..`, no absolute or drive paths, no backslashes, no hidden
  files or folders, `.md` only. Its **real** location (symlinks resolved) must be inside the
  folder.
- The listing skips hidden entries and symlinks, and stops after 20,000 files or 24 levels.
  Files over 5 MB are refused. Invalid UTF-8 is read with replacement characters instead of
  failing.
- Writes are atomic, and deletes go to the **trash**, so no version is lost.

## Tests

- Rust unit tests (`folder.rs`) on temporary folders: path validation, symlink escape,
  recursive listing, atomic write, the changed-on-disk refusal, unique names, invalid
  UTF-8, size limits, watcher path classification, and a real watcher seeing an external write.
- `FakeFolder` (TypeScript) mirrors those rules for `FolderStore`, import, and app-level tests:
  listing, editing, creating, trashing, tags, search, reading positions, external edits,
  deletions, renames, rescans, ignoring its own writes, and live pages.
