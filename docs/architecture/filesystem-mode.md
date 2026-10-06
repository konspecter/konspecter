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

## Ignored files

The folder's **`.konspecterignore`**, at its root and written like `.gitignore`, names what is
not a note ([plan](../../.claude/plans/ignore-file.md)). Settings → **Ignored files** edits it
in a text box; Save writes the file and reads the folder again by the new rules. A folder
without the file uses the default (`domain/note/ignore.ts` `DEFAULT_IGNORE`, the same in
`folder.rs`):

```gitignore
.*
node_modules
vendors
dist
bin
```

- **Hidden files follow the rules.** The default skips them with `.*`; without that line
  hidden files and folders are read like any other. The app's own temporary files are not
  `.md`, so they never are.
- **Native side:** the walk does not enter what the rules skip, the watcher does not report
  it, no file is created or renamed into it, and no folder in it is removed (`invalid_path`).
  A change to the file, by the app or another program, reloads the rules (all clones of the
  folder share them) and asks for a rescan. Semantics are gitignore's, from the `ignore`
  crate: as in git, nothing inside a skipped folder can be included again.
- **`FolderStore`** reads the rules on load and on every refresh, with the `ignore` npm
  package. A skipped path is no note even when reported. A note whose tags lead into a
  skipped folder (`#dist`) is made at the top level, a save stays where the file is, and the
  reformat leaves it alone.

## Following changes on disk

Other programs can change the folder at any time. The app follows:

```text
file saved in Vim ─→ Rust watcher (notify, 300 ms debounce) ─→ event "folder-changed"
                 ─→ FolderStore re-reads those files ─→ cache, tag and search indexes
                 ─→ change events ─→ pages that show them reload
```

- **Watcher:** `notify` watches the folder recursively, debounced so a burst of writes is one
  event. It reports relative `.md` paths. It skips what the ignore rules match, hidden files
  other than `.md` (the app's own temporary files, `.DS_Store`), and other file types. A folder rename or a watcher error asks for a
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
- **Own renames:** paths the app is renaming are left out of watcher batches while the
  rename runs, and afterwards the cache already has the new path, so the app's own renames
  emit nothing extra.

## File names

A file's name is the **slug** of its note's title (`domain/note/file-name.ts`, `slugFor`):
lower case, Cyrillic transliterated, accents dropped from Latin letters, everything that
is not a letter or digit collapsed into `-`, at most 80 characters, `untitled` when nothing
is left. "Hello мир!" is `hello-mir.md`. Letters of other scripts are kept as they are.

- **New notes** always get the slug name, in the folder of their first tag chain
  ([Folders are tags](#folders-are-tags)), the top level without tags. A taken name gets a
  number: `hello-mir-2.md`, `hello-mir-3.md` … Names compare ignoring case, as on macOS and
  Windows disks.
- **Title changes** (Settings → **File names**, File Mode only; off by default): when on, a
  save whose title no longer fits the file name renames the file, in its own folder.
  `test.md` titled "Hello мир!" becomes `hello-mir.md`. A name that fits already is kept,
  numbered ones too (`hello-mir-2.md`), and `Maps.md` becomes `maps.md` by a change of case
  only. Files that are never saved from the app keep whatever names they have.
- A rename never replaces another file: `folder_rename` fails with `exists` for a name taken
  by a file the app has not seen yet, and the next number is tried. `put` returns the note
  under its new id and emits a change with `previousId`. The open note's autosave
  (`onRenamed`) moves the editing session to the new id with the caret and the undo history
  intact, and the reading position moves with it.
- **Live pages:** the note list, the sidebar (recent notes, tags), search results and the
  open note follow changes, keeping the current content visible meanwhile. The same mechanism
  shows notes that arrive by sync. The editor reloads a changed note only while nothing is
  unsaved; with unsaved text it keeps the version it opened, so the next save detects the
  change and keeps both versions instead of overwriting.

## Folders are tags

The folder tree and the tag tree are one ([ADR-013](decisions/ADR-013-folders-follow-tags.md),
rules in `domain/note/folders.ts`): a note's folder is its **first tag chain**.

```text
~/Notes/folder1/folder2/file-1.md   ⇄   # File 1   tags: folder1#folder2
```

- **Disk → app:** a file without tags in folders gets its folders' chain written into its
  frontmatter `tags` when the folder opens or the file appears (`withFolderTags`). A file
  another program moves out of its chain's folder gets the new folders' chain instead.
  Folder names become tag names with what a tag cannot hold as `_` (`My Notes` →
  `My_Notes`); a folder whose name gives no tag (`2024/`) leaves its files alone.
- **App → disk:** a new note is created in its chain's folder, and a save that changes the
  first chain moves the file there, keeping its name (numbered if taken). Existing folders
  are reused whatever their case. The folder a move or a deletion leaves empty is removed,
  with its parents left empty (`folder_remove_empty_dir`; a `.DS_Store` does not count).
  A save that keeps the chain never moves a file.
- **Reformatting:** when a folder opens with files that have tags but sit elsewhere
  (`misplaced`), the app asks once for that folder whether to reformat the collection
  (`ReformatPrompt`); yes moves them into their chains' folders (`reformat`). Settings →
  Library → _Reformat the folder…_ asks again at any time.

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
- **Both editors on one file: the last write wins**
  ([ADR-011](decisions/ADR-011-last-write-wins.md)).
  - While nothing is unsaved in the app, a change on disk replaces the open note's content.
  - With unsaved text in the app, its next save writes over the other program's change: the
    edit being saved is the latest. Writes are atomic, without a modification-time
    precondition.
  - A file deleted elsewhere while open says so; editing it writes it again.
  - No conflict copies are made. File-level history (Git, Time Machine) is the way back.

## The native side (Rust)

`src-tauri/src/folder.rs`, exposed as commands in `lib.rs`:

| Command                          | Does                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder_pick`                    | system folder picker; opens and remembers the folder                                                                                                  |
| `folder_current`, `folder_close` | the open folder, or none                                                                                                                              |
| `folder_list`                    | every `.md` file the ignore rules do not skip, recursively, sorted by path                                                                            |
| `folder_ignore_read`             | the folder's `.konspecterignore`, or the default without one                                                                                          |
| `folder_ignore_write`            | writes `.konspecterignore` atomically; listing and watching follow it at once                                                                         |
| `folder_read`                    | a file's text and entry (path, modification time, size)                                                                                               |
| `folder_write`                   | atomic write (temporary file + rename); refuses with `changed_on_disk` if the file changed since `expectedModifiedMs`                                 |
| `folder_create_at`               | a new file at exactly the given path, making its folders; `exists` if it is taken (never overwrites)                                                  |
| `folder_rename`                  | renames a file, into other folders too (made as needed), never over another one (`exists`); a change of case only works on case-insensitive disks too |
| `folder_remove_empty_dir`        | removes a folder left empty (but for a `.DS_Store`), then its parents left empty                                                                      |
| `folder_trash`                   | moves the file to the system trash                                                                                                                    |

### Safety

- **Only the native folder picker can choose the folder.** The web app passes only relative
  paths, so it cannot aim file access anywhere else, even if script were injected.
- Every path is validated: no `..`, no absolute or drive paths, no backslashes, `.md` only.
  Its **real** location (symlinks resolved) must be inside the folder. New files and renames
  never land where the ignore rules skip.
- The listing skips what the ignore rules match (hidden entries by default) and symlinks, and
  stops after 20,000 files or 24 levels.
  Files over 5 MB are refused. Invalid UTF-8 is read with replacement characters instead of
  failing.
- Writes are atomic, and deletes go to the **trash**, so no version is lost.

## Tests

- Rust unit tests (`folder.rs`) on temporary folders: path validation, symlink escape,
  recursive listing, atomic write, the changed-on-disk refusal, unique names, exact-path
  creation and renames that never overwrite (a change of case included), folders made for
  new paths (never through a symlink out) and removed only when empty, invalid
  UTF-8, size limits, watcher path classification, the ignore rules (default, the folder's own,
  changes seen by the watcher, nothing made or removed where they skip), and a real watcher
  seeing an external write.
- `FakeFolder` (TypeScript) mirrors those rules for `FolderStore`, import, and app-level tests:
  listing, editing, creating, trashing, tags, search, reading positions, external edits,
  deletions, renames, rescans, ignoring its own writes, and live pages. File names ignore
  case there, as on macOS. Slug names and renames after the title are covered in
  `folder-store.test.ts` and in the app tests (the open note keeps its editor), and so are
  folders following tags (`folders.test.ts` for the rules) and the reformat question.
