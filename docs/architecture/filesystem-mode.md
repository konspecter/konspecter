# File Mode (desktop)

On the desktop, the library is real folders of Markdown files, one or several
([ADR-004](decisions/ADR-004-filesystem-mode.md), [ADR-024](decisions/ADR-024-desktop-folder-sync.md),
[ADR-030](decisions/ADR-030-multiple-library-folders.md)):
every conspect is a file the user can see in Finder or Explorer. The files are the only copy
of the notes on the device. Other programs (VS Code, Vim, Obsidian, Git) can read and change
them, Konspecter reads and writes them in place, and sync carries them to the other devices.

```text
~/Konspecter/
├── java.md
├── databases/postgres.md
└── networking.md
```

## The folders

- **`~/Konspecter`** is connected on the very first start, made if needed: in the home
  folder, not hidden, and outside iCloud's Documents folder.
- **More folders** are added with the folder-with-a-plus button in the sidebar, Settings →
  **Library** → **Add folder…**, or **Add a folder…** on the welcome. Each shows the system
  folder picker; the app then reloads with the new folder. The desktop shell remembers the
  list (`folders.json` in the app's config directory: path, alias, date added).
  - A folder connected already is refused, and so is one inside a connected folder, or
    holding one.
  - A folder's **id** is a hash of its path, so the same folder connected again keeps it.
- **Settings → Library** is a table of the folders (path, date added). Each row can be
  shown in Finder, Explorer or Files, given an **alias** (shown instead of the folder's
  name), or **removed**.
  - Removing a folder only disconnects it, the default folder included: its files and
    folders stay where they are.
  - A list left empty stays empty: the default folder is not made again, and the app asks
    for a folder before anything can be written.
  - A folder that cannot be opened, or whose files cannot be read just now, stays listed as
    one that cannot be opened; the other folders work on.
  - `folders.json` is written atomically; one that cannot be read is put aside as
    `folders.unreadable.json`, never overwritten.
- **One folder** looks as before. **Several** are the roots of the sidebar's tree, each with
  its own tags and notes. A new note goes into the open note's folder (the first folder with
  none open), or the folder is asked for each time (Settings → New conspects).
- An earlier version's single folder (`folder.json`) moves into the list once, keeping its
  links, reading positions and the last location, even when it cannot be opened at that
  start (a disk not mounted).
- **The app library moves in once.** On the first start after the desktop became
  folder-only, the notes of the app library (IndexedDB) are written into the folder (or
  linked to a file with the same text), keeping their sync ids and state, and leave the
  library without a deletion being queued (`FolderSync.moveLibrary`).
- Web and mobile keep the app library.

## Sync

Sync covers every connected folder (`infrastructure/folder/folder-sync.ts`, `FolderSync`, the engine's
`SyncStore` port; [sync](sync.md#the-desktop-folder)). The files stay plain Markdown; the
app's database keeps a **link** per file: the server's note id, the path, the base revision
and the SHA-256 of the text last synced.

- **Any change is an edit:** a file whose text hashes differently from its link is pushed,
  whether Konspecter, another program or Git changed it. New files get a link and are
  uploaded; a linked file that is gone is a deletion.
- **Renames keep the note:** the app's own renames and the watcher's (same text, new path)
  move the link, and so does a file renamed while the app was closed (found by its hash).
- **Pulls are files:** a note from elsewhere is written in its first tag chain's folder,
  named after its title (numbered if taken), a changed one is written over and moved when
  its chain changed, and a deleted one goes to the trash. Open editors take them in place.
- **Several folders:** a note new to this device is written into the first folder. A
  removed folder's links are **dormant**: they push nothing and take nothing in, so its notes
  stay as they are on the server and the other devices, and connected again it uploads
  nothing twice.
- **Adoption:** a folder new to sync (connected, connected again, back from a disk), an
  account or a key starts over: everything is pulled again, until then files that never
  reached the server wait, and a pulled note with exactly their text links to them rather
  than being written again. A copy of a folder duplicates nothing.
- **An emptied folder deletes nothing:** one with none of its linked files on start is
  adopted again, and its notes are written back into the first folder. Deleting files while the app runs does
  delete them everywhere, and so does an ignore rule that leaves them out.

## How it works

```text
pages ─→ NoteRepository ─┬─ NoteStore     (IndexedDB, synced)      — app library
   (application/notes/)  └─ FolderLibrary (connected folders)      — File Mode
                                 └─ FolderStore per folder
                                       │ desktop bridge, one per folder (validated)
                                       ▼
                          Rust commands (src-tauri/src/folder.rs, library.rs)
```

- **`NoteRepository`** (`application/notes/`) is the port every page uses. Both backends
  implement it, and neither knows about the other.
- **`FolderStore`** (`infrastructure/folder/`) reads every `.md` file of one folder into an
  in-memory cache and derives its tags from it, just as the app library derives its indexes
  from notes. Its ids are paths relative to the folder (`databases/postgres.md`).
- **`FolderLibrary`** puts the connected folders together. A note's **id is its folder's id
  and its path** (`9c1f0a7e3b2d4c58/databases/postgres.md`). It routes every call to the
  note's folder, counts tags across them (and per folder, for the tree's roots), searches
  every folder in one index, and makes new notes in the folder asked for, else the first.
  Reading positions are kept in the app's database under `file:<folder id>/<path>`, never
  in the files.
- **Metadata** is parsed from each file's frontmatter, exactly as for library notes.
  Files without frontmatter are fine. Without an `updated` date, a file is ordered by its
  modification time. Saving from the app stamps `created`/`updated` into the frontmatter,
  as it does everywhere.

## Ignored files

The folder's **`.konspecterignore`**, at its root and written like `.gitignore`, names what is
not a note. Settings → **Ignored files** edits it
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
- **New notes follow their titles until closed**, whatever the setting: the first save of
  a new note may catch its title half typed, or typed in the wrong keyboard layout ("cnfnm"
  on the way to "Статья"). The editor creates it with `followTitle` (`Autosave`), so every
  save renames the file after the title while the note is open. Closing it (its editor
  session ends and the last save is written) calls `settleName`, and the name stays from then
  on. Notes created otherwise (imported, the welcome example, from sync) keep their names.
- **Untitled files** follow their titles the same way: `untitled.md` (and `untitled-2.md` …)
  is a placeholder for a note saved before it had a title. A save that gives it a title
  renames it, and the file keeps following its title until the note is closed, so a save in
  the middle of the title ("ha.md") does not name it for good. Files found with such a name
  and a title when the folder opens are renamed then, in their folders. Only that lower-case
  name counts: `Untitled.md` from another program is left alone.
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
  Library → _Reformat the folders…_ asks again at any time.

## External editors

```text
Konspecter  ⇄  ~/Notes/java.md  ⇄  VS Code / Vim / Neovim / …
```

- **Open in external editor** (note page, File Mode) opens the file with the system's
  default app for `.md`. **Show in folder** reveals it in Finder on macOS (other platforms
  open the containing folder in their file manager). There is deliberately no "custom editor command" setting: a command line
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

`src-tauri/src/library.rs` (the list of folders) and `src-tauri/src/folder.rs` (one
folder's files), exposed as commands in `lib.rs`. Every file command takes the folder's id
(`folder`) and a path inside it; the `folder-changed` event says which folder changed.

| Command                         | Does                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folders_list`                  | the connected folders: id, path, alias, date added, whether it opens                                                                                  |
| `folder_add`                    | system folder picker; connects the folder (`folder_connected`, `folder_overlaps` refused) and watches it                                              |
| `folder_remove`                 | disconnects a folder and stops watching it; no file is touched                                                                                        |
| `folder_set_alias`              | names a folder (trimmed, 100 characters at most); empty goes back to its name                                                                         |
| `folder_reveal_root`            | opens the folder itself in the system file manager                                                                                                    |
| `folders_reset`                 | forgets the list (factory reset, a wipe): the next start is a first start                                                                             |
| `folder_list`                   | every `.md` file the ignore rules do not skip, recursively, sorted by path                                                                            |
| `folder_ignore_read`            | the folder's `.konspecterignore`, or the default without one                                                                                          |
| `folder_ignore_write`           | writes `.konspecterignore` atomically; listing and watching follow it at once                                                                         |
| `folder_read`                   | a file's text and entry (path, modification time, size)                                                                                               |
| `folder_write`                  | atomic write (temporary file + rename), over whatever is there: the last write wins                                                                   |
| `folder_create_at`              | a new file at exactly the given path, making its folders; `exists` if it is taken (never overwrites)                                                  |
| `folder_rename`                 | renames a file, into other folders too (made as needed), never over another one (`exists`); a change of case only works on case-insensitive disks too |
| `folder_remove_empty_dir`       | removes a folder left empty (but for a `.DS_Store`), then its parents left empty                                                                      |
| `folder_trash`, `folder_delete` | moves the file to the system trash; deletes it for good (a wiped device)                                                                              |
| `folder_open_external`          | opens the file in the system's default app for `.md`                                                                                                  |
| `folder_reveal`                 | shows the file in the system file manager                                                                                                             |

### Safety

- **Only the native folder picker can add a folder.** The web app passes only a folder's id
  and paths relative to it, so it cannot aim file access anywhere else, even if script were
  injected.
- Every path is validated: no `..`, no absolute or drive paths, no backslashes, `.md` only.
  Its **real** location (symlinks resolved) must be inside the folder. New files and renames
  never land where the ignore rules skip.
- The listing skips what the ignore rules match (hidden entries by default) and symlinks, and
  stops after 20,000 files or 24 levels.
  Files over 5 MB are refused. Invalid UTF-8 is read with replacement characters instead of
  failing.
- Writes are atomic, and deletes go to the **trash**, so no version is lost.

## Tests

- Rust unit tests (`library.rs`) on temporary folders: stable ids, the first start, a list
  left empty, the move from `folder.json`, a folder that cannot be opened, overlapping
  folders refused (a difference in case on macOS too), removing that leaves the files, and
  aliases.
- Rust unit tests (`folder.rs`) on temporary folders: path validation, symlink escape,
  recursive listing, atomic write, unique names, exact-path
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
