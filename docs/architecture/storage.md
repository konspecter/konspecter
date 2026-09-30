# Local storage

Notes live in the browser's IndexedDB, so the app works fully offline. The network is never
between the UI and the user's data ([ADR-003](decisions/ADR-003-local-first.md)).

## Library: `idb`

[`idb`](https://github.com/jakearchibald/idb) (ISC, no dependencies, about 1 kB) wraps the
native IndexedDB API in promises and typed schemas without adding its own data model.

Alternatives considered:

- **Raw IndexedDB**: no dependency, but callback- and event-based code that is easy to get
  wrong, especially transaction lifetimes.
- **Dexie** (Apache-2.0): a capable query layer, but much larger and more opinionated than a
  key–value store of Markdown documents needs. It can be reconsidered if indexes outgrow
  plain object stores.

Tests run against the same `NoteStore` code on
[`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) (Apache-2.0, dev only), an
in-memory implementation of the IndexedDB spec.

## Schema

Database `konspecter`, version 5:

| Object store | Key       | Value                                                                     |
| ------------ | --------- | ------------------------------------------------------------------------- |
| `notes`      | note `id` | `{ id, markdown }` (see [domain model](domain-model.md))                  |
| `tags`       | `noteId`  | `{ noteId, written, memberOf }`, derived, `memberOf` multiEntry idx       |
| `meta`       | name      | `tagIndexVersion`                                                         |
| `reading`    | note id   | `{ noteId, position, updatedAt }`, user state (see [reading](reading.md)) |
| `sync`       | note id   | sync bookkeeping (see [sync](sync.md))                                    |

Keys are out-of-line (`put(note, note.id)`), and only `id` and `markdown` are written. The
store has no secondary indexes. The note catalog (`application/notes/note-catalog.ts`) reads all
notes once, sorts them by the frontmatter `updated` date and then follows changes one note at
a time. Derived indexes (tags, full-text search) come in later
phases and must be rebuildable from the notes.

### Versions and migrations

Schema changes bump `DATABASE_VERSION` and add an upgrade step in `openNoteStore`.

| Version | Records                                  | Upgrade step                                                                                                                |
| ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1       | `{ id, markdown, createdAt, updatedAt }` | creates the `notes` store                                                                                                   |
| 2       | `{ id, markdown }`                       | moves `createdAt`/`updatedAt` into each document's frontmatter as `created`/`updated`, unless the document already has them |
| 3       | same                                     | adds `tags` and `meta`. The tag index is built on open                                                                      |
| 4       | same                                     | adds `reading`                                                                                                              |
| 5       | same                                     | adds `sync` (filled when sync is first connected)                                                                           |

Migrations never discard text. A record whose frontmatter cannot be parsed keeps its Markdown
unchanged and loses only the record dates. Records that are not notes at all are left as
they are, and reads report them as errors.

An open connection closes itself when another tab asks for a newer version (`blocking`), so
upgrades never wait forever. The old tab then shows storage errors until it is reloaded.

## Tag index

`tags` is **derived data**: one entry per note, with the tag chains written in it, case kept
(`written`, e.g. `Java#Linked_List`: spellings and parent links), and the note's tags
(`memberOf`, e.g. `java`, `linked_list`; see [tags](tags.md)). The `memberOf` multiEntry
index answers "which notes carry `java`?" directly, including notes written
`#java#collections`. The tag list with counts and parents (`countTags`) is computed from the
entries (`infrastructure/storage/tag-index.ts`).

- **Always in step:** `put` and `delete` write the note and its entry in one transaction.
- **Rebuildable:** `rebuildIndexes()` clears the store and recomputes it from the notes. On open,
  if `meta.tagIndexVersion` is missing or differs from `TAG_INDEX_VERSION` (after an
  upgrade, or when the tag rules change), the index is rebuilt. Losing the index never loses
  data.
- Notes with invalid frontmatter and records that are not notes contribute no tags.

## Code

`apps/web/src/infrastructure/storage/note-store.ts`:

- `openNoteStore(name?)` opens (and on first run creates) the database and returns a
  `NoteStore`.
- `NoteStore` has `list()` (unordered), `get(id)`, `put(note)` (create or replace),
  `delete(id)`, `tags()` (tag counts), `notesWithTag(tag)` and `rebuildIndexes()`.

The UI receives the store as a prop from `main.tsx`. There is no interface in front of it:
tests use the real implementation on `fake-indexeddb`.

## Validation

Everything read from IndexedDB is `unknown` until `parseNote` (domain) validates it. A record
that fails validation is left untouched: `get` rejects with `InvalidNoteError`, `list` skips
it, and recovery reports it ([backup and recovery](backup-recovery.md)).

## Not yet handled

- **Eviction:** browsers may clear IndexedDB under storage pressure unless the origin has
  persistent storage (`navigator.storage.persist()`). This is part of the PWA/offline-data
  phase.
- **Multiple tabs:** each tab reads fresh data when a page mounts, but open pages are not
  notified of changes made in other tabs. A schema upgrade in one tab disconnects the others
  (see above).
- **Deletion is permanent:** there are no tombstones yet. Sync (a later phase) introduces them.
