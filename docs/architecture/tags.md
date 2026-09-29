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
- **Case-insensitive:** tags are normalized to lowercase (`#Java` = `#java`). The spelling is
  kept for display only (`writtenTags`).
- **Anywhere in text:** paragraphs, headings (`# Java #tips` → `tips`), lists, quotes,
  tables, and link text.
- **Never in:** inline code, fenced or indented code, HTML, URLs (`…/page#section`,
  autolinks, link destinations), image alt text, or escaped `\#`.
- **Frontmatter:** the text of the frontmatter is not scanned, but its `tags` field lists tags
  too, with the same rules, without the leading `#` (in YAML an unquoted `#` starts a
  comment):

  ```yaml
  tags:
    - parent_1#child
    - parent_2
  ```

  A single string works as well (`tags: java, go` or `tags: java go`). A note's tags are its
  frontmatter tags, then its body tags, each once (`noteTags`, `frontmatterTags`); entries
  that are not tags (`2024`, `a b`) are skipped. The editor's **Tags** field adds and removes
  frontmatter tags (`setFrontmatterTags`), and tags typed in the body in Text mode are
  added to the list too (see [editing metadata](markdown-format.md#editing-metadata)).

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
- **Sidebar tree:** a project tree (`TagTreeView.tsx`, styled after VS Code's explorer) with
  two kinds of node. A tag is a **folder** (`tagTree` in the domain) showing the number of
  notes within it (its own and its children's); a note is a **document** inside each tag it
  carries itself (`notesTaggedExactly`), so a note tagged only `java#collections` sits in
  `collections`, not directly in `java`. An open folder lists its child tags, then its notes,
  both by name. Folders start closed; the active tag and the folders above it start open.
  The tags are read again whenever a note changes, and so are the notes of every open folder.
- **Tree labels:** a folder shows its tag's last segment as written, with `_` shown as a
  space and, by default, a capital first letter (setting "Tag names"; "As written" keeps the
  case) (`tagLabel`: `#Java#Linked_List` → `Java` › `Linked List`). When notes spell a
  tag differently, the spelling in most notes wins, and on a tie the first in code point
  order, so capitals win (`tagSpellings`). Links, filters and the index use the lowercase
  name.
  A folder's name opens its filtered list (and opens the folder); a document opens the note.
- **Filtering:** a tag opens the note list searched for it, `/?q=%23java%23collections` (a
  [search](search.md) tag filter). A filter on `java` includes notes tagged only
  `java#collections`. The filter shows as a removable chip in the search box, and the tag is marked in the tree.

- **In notes:** the editors and the reader mark tags (`tagRanges` finds them in plain text
  with the same rules; code, HTML, URLs and frontmatter are skipped), a little heavier than
  the text (weight 560, not bold).

## Reading mode

Tags render as plain text for now. Hiding them in reading mode is optional in the plan and
has not been implemented.
