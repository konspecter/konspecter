# Tags

Tags are written inline in the Markdown body. They are ordinary text in the document and in
the editors. The tag list of a note is derived from its Markdown, never stored separately
([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

Code: `apps/web/src/domain/tag/tags.ts`. It is pure, deterministic and independent of the
UI, and is tested in `tags.test.ts`.

## Syntax

| Written                  | Tags                                      |
| ------------------------ | ----------------------------------------- |
| `#java`                  | `java`                                    |
| `#java#getting-started`  | `java#getting-started` (child of `java`)  |
| `#java #getting-started` | `java` and `getting-started`, independent |
| `# Java Collections`     | none: a heading, not a tag                |

- **Segments** are letters (any script), digits, `_` and `-`. `#` between segments makes a
  hierarchy, and a trailing `#` or punctuation ends the tag (`#java.` → `java`).
- **Start:** `#` starts a tag only when it does not follow a letter, digit, `_` or `#`. So
  `C#`, `foo#bar` and `##x` are not tags, while `(#tips)` is.
- **Not all digits:** a first segment made only of digits (`#123`, `#2024`) is not a tag, to
  avoid issue numbers. Later segments may be digits (`#java#8`).
- **Case-insensitive:** tags are normalized to lowercase (`#Java` = `#java`).
- **Anywhere in text:** paragraphs, headings (`# Java #tips` → `tips`), lists, quotes,
  tables, and link text.
- **Never in:** inline code, fenced or indented code, HTML, URLs (`…/page#section`,
  autolinks, link destinations), image alt text, or escaped `\#`.
- **Frontmatter** is not scanned. Callers pass the document body.

The result is deduplicated and ordered by first appearance.

## How it works

The body is tokenized with markdown-it (GFM tables, linkify, HTML), a mature CommonMark
parser, so code, HTML and URLs are excluded by structure, not by guesswork. The tag pattern
is matched only against plain text tokens. The `text_join` rule is disabled so an escaped
`\#` stays a separate token and is never read as a tag.

## Helpers

- `parseTagName("#Java#Collections")` parses a tag typed by the user (with or without `#`).
- `tagWithAncestors(java#collections)` returns `java`, `java#collections`. A note tagged with a
  child tag also belongs to its ancestors.
- `isWithin(tag, ancestor)` tests hierarchy membership.

## Index and navigation

- **Index:** a derived IndexedDB store, always rebuildable (see [storage](storage.md#tag-index)).
- **Sidebar tree:** the hierarchy (`tagTree` in the domain), each tag with the number of notes
  within it (its own and its children's). Branches start collapsed; the branch of the active
  tag starts open. It is read again whenever a note changes.
- **Filtering:** a tag opens the note list searched for it, `/?q=%23java%23collections` (a
  [search](search.md) tag filter). A filter on `java` includes notes tagged only
  `java#collections`. The filter shows as a removable chip, and the tag is marked in the tree.

## Reading mode

Tags render as plain text for now. Hiding them in reading mode is optional in the plan and
has not been implemented.
