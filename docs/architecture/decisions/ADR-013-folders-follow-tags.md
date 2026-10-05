# ADR-013: In File Mode the folders follow the tags

Status: accepted (2026-10-05). Extends [ADR-004](ADR-004-filesystem-mode.md); keeps
[ADR-002](ADR-002-markdown-source-of-truth.md) (the Markdown document is the source of
truth).

## Context

A folder of Markdown files has its own tree, and so do the tags: the sidebar shows tag
chains (`#java#collections`) as nested folders ([tags](../tags.md)). Until now the two were
unrelated. A file in `java/collections/` had no tags unless its text said so, and a note
created in the app always went to the folder's top level, whatever its tags. The user asked
for the two trees to be one, in both directions: `folder1/folder2/file1.md` is a conspect
tagged `folder1` and `folder2`, and a conspect titled "File 1" with those tags is the file
`folder1/folder2/file-1.md`.

## Decision

1. **A note's folder is its first tag chain.** The folders `folder1/folder2/` are the chain
   `#folder1#folder2`: the tags `folder1` and `folder2`, with `folder2` under `folder1`, so the
   tag tree shows the folder tree. The first chain is the first of the note's chains: those in
   its frontmatter `tags`, then those in its body (`noteWrittenTags`). A note without tags is
   at the top level. Independent tags (`#folder1 #folder2`) are two chains: the note is in
   `folder1/`. A folder's name is read as a tag with what a tag cannot hold made `_`
   (`My Notes` → `My_Notes`, shown as "My Notes"); folders whose names give no tag (`2024/`,
   a chain cannot start with digits only) stand for no chain, and their files are left alone.
2. **The tags are in the document.** Folders never add tags on their own: a file without
   tags of its own found in folders (when the folder opens, or when it appears) gets its
   folders' chain written into its frontmatter `tags`. A file another program moves from its
   chain's folder to another gets the new folders' chain in place of the old one (at the top
   level, the old one is removed). The document stays the single source of truth; the path
   follows it.
3. **The app moves files when the chain changes.** A new note is created in its chain's
   folder. A save that changes the first chain moves the file into the new chain's folder,
   keeping its name (numbered if taken there). Folders are made as needed and reused
   whatever their case (`Java/` holds `#java`); a folder a move or a deletion leaves empty is
   removed (a Finder `.DS_Store` does not count). A save that keeps the chain never moves a
   file, so a file left elsewhere stays there.
4. **Reformatting is asked, once.** When an opened folder has files with tags outside their
   chain's folder, the app asks whether to reformat the collection: yes moves them all. Either
   answer is remembered for that folder; Settings → Library can reformat later.

The rules are pure functions in `domain/note/folders.ts`; `FolderStore` applies them. The
native side makes the folders a new path needs (`create_at`, `rename`) and removes empty
folders (`folder_remove_empty_dir`), with every path checked as before.

## Consequences

- The sidebar's tag tree is the folder tree, and moving a note is changing its first tag.
- Opening a folder can write to files: those in subfolders without tags gain a `tags` field
  (no other change; their dates are not touched). Git and sync tools see that as an edit.
- Typing a new first tag moves the file as the autosaves come in (`#ja`, then `#java`):
  the folders in between are made and removed again. The end state is right.
- A file's first chain decides alone: further chains and independent tags do not place it.

## Alternatives considered

- **Folders as tags derived at read time**, never written: no file changes on opening, but
  the tags would come from outside the document, and the app shows and edits tags from the
  document everywhere (details, the tag list, removing a frontmatter tag).
- **Every tag a folder level** (`#a #b` → `a/b/`): matches independent tags too, but the path
  then depends on the order tags happen to be written in, and reading it back would invent
  parent links (`b` under `a`) the note never made.
- **Move only on request**: simpler, but the trees drift apart with every edit.
