# Markdown document format

A note is one Markdown document. The document is canonical: title, dates and cover are read
from it, and the app never keeps a second copy of them anywhere else
([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

```markdown
---
title: Java Collections
created: 2026-09-28T10:15:00Z
updated: 2026-09-28T10:15:00Z
cover: null
---

# Java Collections

ArrayList — dynamic array.
```

Code: `apps/web/src/domain/document/document.ts` (pure, no UI or storage dependencies).

## Frontmatter

- Recognized only when the document **starts** with a `---` line (a UTF-8 byte-order mark
  before it is ignored) **and** a later line is `---` or `...`. A leading `---` with no
  closing line is a thematic break, and the whole text is the body.
- The block between the delimiters is YAML 1.2 (core schema) and must be a mapping
  (`key: value` pairs) or empty. Invalid YAML, duplicate keys, or a list or scalar at the top
  level make the document invalid.
- The body is everything after the closing delimiter line, minus one blank line if it
  directly follows. A document without frontmatter is all body and is perfectly valid, which
  covers plain `.md` files.

## Fields

All fields are optional. `null` and an absent key mean the same thing.

| Field         | Type                    | Meaning                                                                                           |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `title`       | text                    | Display title. Falls back to the body's first line.                                               |
| `created`     | ISO 8601 date/date-time | When the note was created.                                                                        |
| `updated`     | ISO 8601 date/date-time | When the note was last saved. Used for ordering.                                                  |
| `cover`       | text (URL or path)      | Cover image. Parsed and validated, not displayed yet.                                             |
| `conflict_of` | text (note id)          | Set on conflict copies: the note this one is a copy of (see [sync](sync.md#conflict-resolution)). |

- **Dates** are `YYYY-MM-DD` or a date-time **with** a time zone (`Z` or `±hh:mm`), for
  example `2026-09-28T10:15:00Z` or `2026-09-28T12:15:00+02:00`. Date-times without a zone
  are rejected as ambiguous, and so are impossible dates (`2026-02-30`). The app writes
  second-precision UTC (`2026-09-28T10:15:00Z`) and compares instants, not strings.
- **Text** must be a YAML string. `title: 2024` is a number and is rejected. Write
  `title: "2024"` instead.
- **Unknown keys** (e.g. `tags: [a, b]` added by another tool) are allowed and preserved.

## Title fallback

Without a non-blank `title`, the title is the body's first non-blank line with any ATX
heading markers removed (`# Title`, `## Title ##`). `#java` is not a heading and stays as is.
The UI shows "Untitled" when both are empty.

## Writing documents

- `serializeDocument` writes the **canonical form**: non-null fields in the order `title`,
  `created`, `updated`, `cover`, then `---`, a blank line and the body. A document without
  metadata is written as its body alone, unless the body itself would read as frontmatter,
  in which case an empty `---`/`---` block is written first. `parseDocument(serializeDocument(d))`
  returns `d`.
- `updateMetadata` changes individual fields of an existing document's text. Setting a field
  to `null` removes it. It keeps the rest of the frontmatter (unknown keys, comments, key
  order) and the body byte for byte. The edited YAML block is re-emitted by the `yaml`
  library, so unusual formatting inside it (indentation, quoting style) may be normalized.
  A document without frontmatter gets a canonical block added.

## How the app stamps dates

When a note is saved (`createNote`, `updateNote` in `domain/note/note.ts`):

- `updated` is set to now.
- `created` is kept if the text has one. Otherwise it is taken from the previously saved
  version, or set to now for a new note.
- Other fields are left exactly as the author wrote them.

## Editing metadata

In Text mode, the editor shows a **title** field and a **cover** field above the body
(`editors/MetadataFields.tsx`). In Markdown mode the frontmatter is edited directly. Both
views read from the same document text, so switching modes always shows the current values.

- Each field writes its key with `updateMetadata`, which keeps comments, unknown keys and
  the body as written. Clearing a field removes the key.
- **Title sync:** an empty title field means "use the first line". The field's placeholder
  shows that derived title, so the explicit title and the heading never silently disagree.
  Setting a title makes it win over the heading.
- **Dates** are shown read-only under the text (`Created …`, `Edited …`), from the stored
  version. They are stamped on save as described above.
- **Cover:** any text is stored, including paths for File Mode. The note page shows it only
  when it is an absolute `http(s)` URL, the same rule as for images in the body.

## Validation and invalid documents

`parseDocument` throws `InvalidDocumentError` with a message meant for the author (for example
`Frontmatter "created" must be an ISO 8601 date such as 2026-09-28T10:15:00Z`).

- **Saving** an invalid document is refused: the editor keeps the text and shows the message
  until the document is valid again, then saves.
- **Stored** documents that are invalid (e.g. written by an older version or another tool)
  are never hidden or discarded. The list shows them as "Unreadable note", and the note opens as
  source with the problem explained, so it can be fixed (or deleted).

## Library

YAML is parsed and edited with [`yaml`](https://github.com/eemeli/yaml) (ISC, no dependencies).
It was chosen over `js-yaml` because its document API edits individual keys while keeping
comments and unknown keys. It was chosen over `gray-matter` because that library brings four
dependencies and Node-specific code. Splitting off the frontmatter block is a small,
well-defined convention and is done in `document.ts`. The Markdown body is not parsed there.
It is rendered by `MarkdownView` (below) for notes the text editor cannot represent.

## Reading (rendering)

For a note the text editor cannot represent (tables, HTML, …), Text mode renders the body
with `MarkdownView` (`apps/web/src/presentation/markdown/`):

| Step      | Library                                               | What it does                                                                 |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Parse     | `react-markdown` (micromark), `remark-gfm`            | CommonMark plus GFM: tables, task lists, strikethrough, autolinks, footnotes |
| Raw HTML  | `rehype-raw`                                          | Parses HTML written in the Markdown                                          |
| Sanitize  | `rehype-sanitize` (GitHub schema)                     | Removes everything not on GitHub's allowlist                                 |
| Highlight | `rehype-highlight` (highlight.js, `common` languages) | Highlights fenced code that names a language                                 |
| Title     | `omitLeadingTitle` (ours)                             | Drops a leading `<h1>` that the page already shows as the title              |
| Render    | `react-markdown`                                      | Builds React elements. No HTML string is ever set with `innerHTML`           |

### Safe HTML handling

- Raw HTML is supported but always sanitized with the GitHub allowlist, so HTML renders as it
  would on GitHub. `<details>`, `<summary>`, `<kbd>`, `<sup>`, `<img>` and similar tags work.
  `<script>`, `<style>`, `<iframe>`, `<form>` and other active content, every `on*`
  attribute, and `style` attributes are removed.
- URLs: `href` only allows `http`, `https`, `mailto`, `irc(s)`, `xmpp` and relative URLs, and
  `src` only allows `http`, `https` and relative URLs. `javascript:` and `data:` URLs are
  dropped in both Markdown and HTML, including encoded variants.
- `id` and `name` attributes from notes are prefixed with `user-content-` so they cannot
  shadow page globals (DOM clobbering).
- Highlighting runs after sanitizing. Its `<span class="hljs-…">` markup is generated by us,
  not taken from the note.
- External links (`http(s)://`, `//`) open in a new tab with `rel="noopener noreferrer"`.
  Remote images load lazily.

### Rendering choices

- Code blocks are highlighted only when the fence names a language (`detect: false`), so
  output is deterministic. Unknown languages render as plain text. Highlight colours are theme
  tokens in `markdown.css` for light and dark.
- The page shows the document title as its `<h1>`. If the body starts with an `<h1>` that the
  title was derived from, or that repeats the frontmatter title, that heading is not rendered
  again.
- Tags (`#java#collections`) are not headings and render as plain text for now.
- The renderer and highlighter are about 150 kB gzipped, more than the rest of the app. They
  are loaded as a separate chunk the first time a note is opened. If that chunk cannot be
  downloaded, the note page shows an error in place of the body instead of breaking.
