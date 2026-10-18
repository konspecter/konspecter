# Tag-Chain Specification

**Author:** Dmitry Taynov  
**Date:** 2026-10-18
**Version**: v1.0

> **Implementation and attribution request:** If you implement, adapt, or otherwise use this feature, please refer to this specification as the source of the Tag-Chain design, in the implementation, documentation, or relevant change description.

## 1. Overview

Tag-Chain defines how tags are written in Konspecter, what they mean, and how they form the tag tree in the sidebar.

A tag is one name. `#parent#child` is a chain: two tags, `parent` and `child`, and a link that places `child` under `parent`.

Tags are ordinary text in a conspect. The tag list, tree, and index are derived from Markdown content and can be rebuilt from it.

## 2. Writing tags

| Written in Markdown         | Tags                             | Links                                                     |
| --------------------------- | -------------------------------- | --------------------------------------------------------- |
| `#java`                     | `java`                           | None                                                      |
| `#java#collections`         | `java`, `collections`            | `collections` under `java`                                |
| `#java#collections#hashmap` | `java`, `collections`, `hashmap` | `collections` under `java`; `hashmap` under `collections` |
| `#java #collections`        | `java`, `collections`            | None; these are two independent tags                      |
| `# Java`                    | None                             | A heading, not a tag                                      |

### 2.1 Tag names and recognition

- **Allowed name characters:** letters of any script, digits, `_`, and `-`. An underscore is displayed as a space in the tree: `#Linked_List` → `Linked List`.
- **Word boundary:** a tag starts at the start of a word. `C#`, `foo#bar`, and `##x` are not tags; `(#tips)` is. Punctuation ends a tag, so `#java.` is the tag `java`.
- **Numeric names:** a chain cannot start with a number. Therefore, `#2024` and `#123` (for example, an issue number) are not tags. Later names in a chain may be numeric: `#java#8`.
- **Case-insensitivity:** `#Java` and `#java` refer to the same tag. The spelling is retained for display; when conspects use different spellings, the most frequently used spelling wins.
- **Where tags are recognized:** anywhere in ordinary text, including paragraphs, headings (`# Java #tips` contains the tag `tips`), lists, blockquotes, tables, and link text.
- **Excluded contexts:** tags are not recognized inside inline or block code, HTML, URLs (for example, `…/page#section`), image alt text, or an escaped `\#`.
- **Frontmatter:** YAML frontmatter may list tag chains without the leading `#`. Because an unquoted `#` starts a YAML comment, write values such as:

  ```yaml
  tags:
    - java#collections
    - algorithms
  ```

## 3. One chain, three views

For `#java#collections`:

| View                          | Representation                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Markdown                      | `#java#collections` in the text; `java#collections` in the `tags` frontmatter value |
| Tag list (details and search) | `#java`, `#collections`                                                             |
| Tree                          | Java › Collections                                                                  |

## 4. Building the tree

The links from all conspects combine into one tree. Consequently, a tag may have more than one parent.

For example:

```text
A: #java#collections
B: #python#collections
C: #collections
```

The resulting tree includes:

```text
Java
└── Collections     A, C

Python
└── Collections     B, C
```

`collections` is one tag displayed under both parents.

### 4.1 Which folders contain a conspect?

A conspect appears in folders whose path ends with its tag chain:

- `#java#collections` (A) appears only in Java › Collections—not directly in Java and not in Python › Collections.
- A bare `#collections` (C) appears in every Collections folder.
- `#java #collections` appears in Java and in every Collections folder.

A folder counts the conspects in it and in its descendant folders, each conspect counted once.

A tag without a parent is a root. If chains create a cycle—for example, `#a#b` in one conspect and `#b#a` in another—the alphabetically first tag becomes the root, and a branch stops before a tag already above it.

## 5. Search and filters

The tree determines organization. For search and filters, a chain gives the conspect each of its tags: searching for `#java` finds every conspect tagged `java`, including conspects written with `#java#collections`.

Tags can be combined with words, for example `hashmap #java`. Clicking a folder in the tree filters by that tag.

## 6. Desktop folders

On desktop, where conspects are files, the tag tree also acts as the folder tree. A conspect's folder is determined by its first chain.

```text
#java#collections  ⇄  ~/Konspecter/java/collections/hashmap.md
```

Changing the first chain moves the file. If a file is placed in a folder without tags of its own, the folder's chain is written into its frontmatter so that the tags remain in the document.

Additional chains and independent tags do not change where the file lives.

## 7. Design rationale

- **Short, reusable names:** `collections` can be used under both Java and Python; there is no need to maintain separate `java/collections` and `python/collections` tags.
- **Hierarchy is declared where it is used:** there is no separate taxonomy to maintain; the tree is derived from the conspects.
- **Plain text:** tags remain usable in any Markdown editor, Git, and `grep`.

## 8. Related project documentation

- Tag implementation rules: `docs/architecture/tags.md`
- Desktop folder behavior: `docs/architecture/decisions/ADR-013-folders-follow-tags.md`
