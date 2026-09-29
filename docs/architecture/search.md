# Search

Search runs entirely on the device, so it works offline. The index is derived data built
from the notes ([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

## Full-text search

| Piece      | Where                                   | What it does                                                                |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Text       | `domain/document/plain-text.ts`         | Body → readable text (prose, code, image alt), no markup, URLs or HTML tags |
| Index      | `infrastructure/search/search-index.ts` | MiniSearch (MIT) over `title` and `text`                                    |
| Store glue | `NoteStore.search`                      | Builds the index on first search and keeps it in step with `put`/`delete`   |
| Snippets   | `domain/search/snippet.ts`              | Excerpt around the first match, split into matching and plain parts         |
| UI         | top bar search, list at `/?q=`          | Filters every note as you type, marks matches; the query lives in the URL   |

### Ranking and matching

- BM25 scoring (MiniSearch). Title matches are boosted 3×.
- All words must match (`AND`). Every word also matches as a prefix (`coll` finds
  `collisions`), and words of 5+ letters tolerate a typo (edit distance ≈ 20%).
- Equal scores are ordered by `updated` (newest first), then by id, so results are
  deterministic.
- Code is indexed, so identifiers like `ConcurrentHashMap` are searchable. Notes with invalid
  frontmatter are indexed by their raw text so they can still be found.

### Snippets

A window of about 180 characters around the first match, cut at word boundaries with `…`
where text is omitted. Matches are found as word prefixes of the terms MiniSearch matched,
and rendered with `<mark>` from text parts. The snippet is never built as an HTML string.

## Combined search

The query is parsed by `parseQuery` (`domain/search/query.ts`), a pure and deterministic
function:

| Query                    | Meaning                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `hashmap`                | notes whose title, text **or tag names** match `hashmap`     |
| `#java` / `java#streams` | tag filter: only notes within that tag (child tags included) |
| `hashmap #java`          | both: text matches _and_ the note is within `#java`          |
| `#java #go`              | within **every** tag filter                                  |

- A token that starts with or contains `#` and is a valid tag is a filter. Anything else is a
  word. A plain `java` is a word, and it also matches notes tagged `java` through the
  indexed tag names (boosted 2×). A lone `#` or `#123` is searched as text.
- With filters but no words, all notes within the tags are listed, newest first.
- Active filters appear as chips on the search page. Removing a chip removes its tokens from
  the query (`withoutTag`).
- Ordering is the same as for text search: score, then `updated`, then id.

### The index lives in memory

The index is not persisted. It is rebuilt from the notes the first time you search in a
session, which parses every note once, and is updated incrementally afterwards. That keeps
it trivially consistent and impossible to corrupt. Persisting it is a Performance-phase
option if measurements call for it.

## Server

The server may later use PostgreSQL full-text search. No dedicated search server
(Elasticsearch, Meilisearch) is used.

## In the UI

The search box in the top bar ([user interface](ui.md)) shows every note when it gets focus
(⌘/Ctrl+P or a click), most recently edited first. Typing filters that list: the matching
notes keep the recent-edit order (ranking still decides which notes match, up to 50), and the
matched words are marked in titles (`highlight`) and snippets (`snippet`). The index is
warmed when the browser is idle after start-up, so the first search does not build it.
