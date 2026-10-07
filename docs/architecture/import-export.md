# Import and export

Notes are plain Markdown, so moving them in and out is copying files, never a conversion
([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)). Settings → **Import & export**.

## Import

| From        | How                                                             |
| ----------- | --------------------------------------------------------------- |
| `.md` files | _Import .md files…_ (multiple selection)                        |
| a folder    | _Import a folder…_ (browser folder picker; subfolders included) |

`application/library/import-markdown.ts`:

- Each file becomes a new note **as written**: frontmatter, unknown keys and body are kept.
  Missing `created`/`updated` dates are added, as for any new note.
- **Duplicates** (the same body already in the library) are skipped, so importing twice adds
  nothing.
- **Validation** (`infrastructure/files/files.ts`): only `.md`/`.markdown` up to 5 MB are
  read. When a folder is imported, other files are skipped silently, and so is what the
  app's `.konspecterignore` rules match (Settings → **Ignored files**, written like
  `.gitignore`, paths relative to the chosen folder; by default hidden files and folders,
  `node_modules`, `vendors`, `dist` and `bin`). Files chosen one by one are read as chosen.
  The import from a File Mode folder follows that folder's own rules. Invalid UTF-8 is
  replaced with `�` rather than refused. A file with invalid frontmatter is still imported,
  with its leading `---` escaped, so no text is lost.
- The result says how many were imported, skipped and not imported, with the reason for each.

## Export

| What      | Browser / PWA       | Desktop                     |
| --------- | ------------------- | --------------------------- |
| one note  | _Download .md_      | _Export…_ → choose a folder |
| all notes | _Export all (.zip)_ | _Export all to a folder…_   |

- Files are the notes **exactly as stored**, frontmatter included, named after their titles
  (`application/library/export-notes.ts`, `domain/note/file-name.ts`). Names use the same
  portable rule as File Mode: letters and digits of any script, spaces, `-`, `_`, at most 80
  characters, made unique (`Maps.md`, `Maps 2.md`, case-insensitive).
- The ZIP (fflate, MIT) has the files at the top level. Unzipped, it is a folder that works
  with any editor and can be opened in File Mode or imported again. A round trip gives
  identical notes (tested).
- On the desktop, a native folder picker and the File Mode code (`export_to_folder`) write the
  files, never overwriting existing ones, because web-view downloads are not reliable there.
- In File Mode, notes already are files, so export is not offered.
- On the Android app, export needs a native share or save step, which is not built yet.
