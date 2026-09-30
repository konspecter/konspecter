# Tags

Tags are written inline in the Markdown body. They are ordinary text in the document and in
the editors. The tag list of a note is derived from its Markdown, never stored separately
([ADR-002](decisions/ADR-002-markdown-source-of-truth.md)).

Code: `apps/web/src/domain/tag/tags.ts`. It is pure, deterministic and independent of the
UI, and is tested in `tags.test.ts`.

## Syntax

| Written                  | Tags                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| `#java`                  | `java`                                                                    |
| `#java#getting-started`  | `java` and `getting-started`, and `getting-started` has the parent `java` |
| `#java #getting-started` | `java` and `getting-started`, independent                                 |
| `# Java Collections`     | none: a heading, not a tag                                                |

- **Chains:** a tag is one name. `#parent#child` is not one tag but a chain of two, `parent`
  and `child`, that also says `child` has the parent `parent`; each tag of a longer chain is
  the parent of the next. A chain has three presentations:

  | Presentation | `#java#collections` shows as                                  |
  | ------------ | ------------------------------------------------------------- |
  | Markdown     | `#java#collections` in the body, `java#collections` in `tags` |
  | Tag list     | `#java`, `#collections` (the note's Details, search chips)    |
  | Tree         | Java › Collections                                            |

- **Names** are letters (any script), digits, `_` and `-`. `#` between names makes a chain,
  and a trailing `#` or punctuation ends it (`#java.` → `java`).
- **Start:** `#` starts a tag only when it does not follow a letter, digit, `_` or `#`. So
  `C#`, `foo#bar` and `##x` are not tags, while `(#tips)` is.
- **Not all digits:** a chain whose first name is only digits (`#123`, `#2024`) is not a tag,
  to avoid issue numbers. Later names may be digits (`#java#8`).
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

  A single string works as well (`tags: java, go` or `tags: java go`). The field lists chains,
  as the body writes them (`noteWrittenTags`). A note's tags are those of its frontmatter
  chains, then its body chains, each once (`noteTags`, `frontmatterTags`); entries that are
  not tags (`2024`, `a b`) are skipped. A tag only the frontmatter lists is removed with the ×
  next to it in the note's Details (`withoutTag`, `setFrontmatterTags`): every chain listing
  it is split around it, so no parent is invented (`a#b#c` without `b` → `a`, `c`). Chains
  typed in the body in Text mode are added to the list too (see
  [editing metadata](markdown-format.md#editing-metadata)).

The result is deduplicated and ordered by first appearance.

## How it works

The body is tokenized with markdown-it (GFM tables, linkify, HTML), a mature CommonMark
parser, so code, HTML and URLs are excluded by structure, not by guesswork. The tag pattern
is matched only against plain text tokens. The `text_join` rule is disabled so an escaped
`\#` stays a separate token and is never read as a tag.

## Helpers

- `parseTagChain("#Java#Collections")` parses a tag or chain typed by the user (with or
  without `#`): the tags `java`, `collections` and the canonical name `java#collections`.
- `chainLinks(chain)` returns the parent links it makes: `[java, collections]`.
- `writtenTagList(chains)` is the tag list: each tag once, with its first spelling.

## Index and navigation

- **Index:** a derived IndexedDB store, always rebuildable (see [storage](storage.md#tag-index)).
- **Parents:** the parent links come from every note's chains, so they are global: with
  `#java#collections` in one note and `#python#collections` in another, `collections` has two
  parents, and a note with a bare `#collections` carries the same tag.
- **Sidebar tree:** a project tree (`TagTreeView.tsx`, styled after VS Code's explorer) with
  two kinds of node. A tag is a **folder** (`tagTree` in the domain) under each of its parents;
  only a tag without a parent is a root. Tags that only a cycle reaches (`#a#b` and `#b#a`)
  would never show, so the first of them by name becomes a root, and a branch stops before a
  tag already above it. A folder is its tag, the same wherever it shows: it counts the notes
  carrying the tag, links to its filter, and holds as **documents** the notes with a chain
  ending in it (`notesInTag`). So a note written `#java#collections` sits in `collections`,
  not directly in `java`; one written `#java #collections` sits in both. An open folder lists
  its child tags, then its notes, both by name. Folders start closed; the active tag's
  folders and those above them start open. The tags are read again whenever a note changes,
  and so are the notes of every open folder.
- **Tree labels:** a folder shows its tag as written, with `_` shown as a space and, by
  default, a capital first letter (setting "Tag names"; "As written" keeps the case)
  (`tagLabel`: `#Java#Linked_List` → `Java` › `Linked List`). When notes spell a
  tag differently, the spelling in most notes wins, and on a tie the first in code point
  order, so capitals win (`tagSpellings`). Links, filters and the index use the lowercase
  name.
  A folder's name opens its filtered list (and opens the folder); a document opens the note.
- **Filtering:** a tag opens the note list searched for it, `/?q=%23collections` (a
  [search](search.md) tag filter), which finds the notes carrying it. A chain gives a note
  each of its tags, so `#java` finds notes written `#java#collections`. The filter shows as a
  removable chip in the search box, and the tag is marked in the tree.

- **In notes:** the editors and the reader mark tags (`tagRanges` finds them in plain text
  with the same rules; code, HTML, URLs and frontmatter are skipped), a little heavier than
  the text (weight 560, not bold).

## Reading mode

Tags render as plain text for now. Hiding them in reading mode is optional in the plan and
has not been implemented.
