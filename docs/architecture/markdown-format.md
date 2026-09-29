# Markdown document format

A note is one Markdown document. The document is canonical: title, dates and cover are read
from it, and the app never keeps a second copy of them anywhere else
([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

```markdown
---
title: Java Collections
created: 2026-09-28T10:15:00Z
updated: 2026-09-28T10:15:00Z
author: Ann
tags:
  - java#collections
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

| Field         | Type                    | Meaning                                                                                                                                  |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | text                    | Display title. Falls back to the body's first line.                                                                                      |
| `created`     | ISO 8601 date/date-time | When the note was created.                                                                                                               |
| `updated`     | ISO 8601 date/date-time | When the note was last saved. Used for ordering.                                                                                         |
| `author`      | text, or a list of text | Who wrote the note. A list (`[Ann, Bob]`) is shown as `Ann, Bob`.                                                                        |
| `tags`        | list of tags, or text   | The note's tags besides those in the body (see [tags](tags.md)).                                                                         |
| `cover`       | text (URL, path, data)  | Cover image: a URL, a path, or an uploaded image as a base64 `data:` URL.                                                                |
| `conflict_of` | text (note id)          | Set on conflict copies made before the last write won ([ADR-011](decisions/ADR-011-last-write-wins.md)): the note this one is a copy of. |

- **Date spellings:** other tools write `create_at` and `updated_at`. They are read as
  `created` and `updated` (which win when a document has both). A save stamps the date under
  every spelling the document already uses, so `updated_at` stays `updated_at` and never gets
  a second, diverging `updated`. New documents get `created` and `updated`.
- **Dates** are `YYYY-MM-DD` or a date-time **with** a time zone (`Z` or `±hh:mm`), for
  example `2026-09-28T10:15:00Z` or `2026-09-28T12:15:00+02:00`. Date-times without a zone
  are rejected as ambiguous, and so are impossible dates (`2026-02-30`). The app writes
  second-precision UTC (`2026-09-28T10:15:00Z`) and compares instants, not strings.
- **Text** must be a YAML string. `title: 2024` is a number and is rejected. Write
  `title: "2024"` instead.
- **Unknown keys** (e.g. `project: Konspecter` added by another tool) are allowed and preserved.

## Title fallback

Without a non-blank `title`, the title is the body's first non-blank line with any ATX
heading markers removed (`# Title`, `## Title ##`). `#java` is not a heading and stays as is.
The UI shows "Untitled" when both are empty.

## Writing documents

- `serializeDocument` writes the **canonical form**: non-null fields in the order `title`,
  `created`, `updated`, `author`, `cover`, then `---`, a blank line and the body. A document without
  metadata is written as its body alone, unless the body itself would read as frontmatter,
  in which case an empty `---`/`---` block is written first. `parseDocument(serializeDocument(d))`
  returns `d`.
- `updateMetadata` changes individual fields of an existing document's text. Setting a field
  to `null` removes it. Only the lines of the fields it sets change: the new `key: value` is
  written in place of the old one (keeping its quotes, a flow list's style and a trailing
  comment), a new key goes after the last one with the same indentation and line endings,
  and a removed key's lines go. Every other byte of the frontmatter (blank lines, spacing,
  comments, other keys' formatting) and the body stays as written, so the dates each save
  writes never move what is being typed in the Markdown editor. Only YAML that cannot be
  edited line by line (a flow map `{title: T}`, aliases) is re-emitted by the `yaml`
  library. A document without frontmatter gets a canonical block added. A field is written under the
  spellings the document already has (see _Date spellings_).
- `setFrontmatterTags` replaces the `tags` list the same way (a flow list `[a, b]` stays one)
  and removes the key when no tags are left.

## How the app stamps dates

When a note is saved (`createNote`, `updateNote` in `domain/note/note.ts`):

- `updated` is set to now.
- `created` is kept if the text has one. Otherwise it is taken from the previously saved
  version, or set to now for a new note.
- Other fields are left exactly as the author wrote them.

## Editing metadata

In Text mode, the editor shows **title**, **author**, **tags** and **cover** fields above the
body (`editors/MetadataFields.tsx`). In Markdown mode the frontmatter is edited directly. Both
views read from the same document text, so switching modes always shows the current values.

- Each field writes its key with `updateMetadata`, which keeps comments, unknown keys and
  the body as written. Clearing a field removes the key.
- **Tags:** the frontmatter's `tags` are shown as `#tag` with a remove button. The field after
  them adds a tag on Enter or a comma (with or without `#`); a name the tag rules reject is
  explained and kept for fixing, and a tag already listed (in any case) is not added twice.
  Tags written in the body stay in the text; Details lists all of the note's tags.
- **The frontmatter follows the text editor** (`withBody` in `domain/note/note.ts`). Every
  edit made in Text mode writes what the body says into the frontmatter, so the title and tags
  the app shows are the document's own `title` and `tags`:
  - `title` is set to the body's first line as readable text (`# Using **maps**` →
    `Using maps`, `firstLineTitle`) while it is absent or still equal to the previous first
    line. A title set to something else (in the field, in Markdown mode or by another program)
    is the author's and stays; clearing the field lets it follow the first line again.
  - `tags` lists every tag written in the body. A tag deleted from the body leaves the list;
    tags only ever listed in the frontmatter stay. A tag written in the body and also added by
    hand leaves the list with the body's.
  - Markdown mode edits the text as written and changes nothing by itself. Switching to it
    shows the frontmatter Text mode wrote.
- The title field and the tags row stay hidden while they only repeat the body (the heading,
  the tags written in it). Tags written in the body are listed without a remove button:
  they are removed in the text.
- **Dates** are shown read-only under the text (`Created …`, `Edited …`), from the stored
  version. They are stamped on save as described above.
- **Cover:** any text is stored, including paths for File Mode. The note page shows it when
  it is an absolute `http(s)` URL (the same rule as for images in the body) or an uploaded
  image.
- **Uploaded cover:** _Upload…_ next to the field stores the image in the document itself, as
  `cover: data:image/webp;base64,…`, so it travels with the note through sync, File Mode and
  export without a separate file (`infrastructure/files/cover-image.ts`). An image over
  1600 px or 256 KB is scaled to at most 1600 px on its longest side and re-encoded as WebP
  (JPEG on white where the browser cannot encode WebP); a smaller PNG, JPEG, GIF, WebP or AVIF
  is kept byte for byte. Only those raster types are displayed (no SVG). The field then shows
  "Uploaded image, 180 kB" instead of the base64, with _Replace…_ and _Remove_; Markdown mode
  shows the whole line.

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
