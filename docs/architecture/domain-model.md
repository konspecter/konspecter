# Domain model

## Document

The canonical content of a note. See the [Markdown document format](markdown-format.md)
(`apps/web/src/domain/document/document.ts`):

```ts
type MarkdownDocument = {
  metadata: { title; created; updated; cover }; // each string | null
  body: string;
};
```

## Note

A stored note is an id plus its document (`apps/web/src/domain/note/note.ts`):

```ts
type Note = {
  id: string; // random UUID, assigned on creation; not part of the document
  markdown: string; // the whole document, frontmatter included
};
```

Title, dates and cover are read from the document every time. There is no second copy of
them. The server's planned `created_at`/`updated_at` columns are expected to be row
bookkeeping for sync, not the note's dates. That is decided with the server API.

Rules, all pure functions:

- `createNote(markdown, now, id?)` validates the document and stamps `created`/`updated` into
  its frontmatter.
- `updateNote(note, markdown, now)` validates, sets `updated`, and keeps `created` from the
  previous version if the new text dropped it.
- `parseNote(unknown)` validates a stored record (`id`, `markdown`) and drops unknown fields.
- `readNote(note)` parses the document and returns either `{ valid: true, document }` or
  `{ valid: false, error }`, so an invalid document is still a note.
- `readNotes(notes)` reads and orders notes: `updated` descending (as instants), then notes
  without a date or with invalid frontmatter, then by `id`.
- `noteTitle(read)` is the document title (see the format's title fallback). The UI shows
  "Untitled" or "Unreadable note".
