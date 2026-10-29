# ADR-028: Tags are suggested as they are typed

Status: accepted (2026-10-30). Narrows [ADR-006](ADR-006-codemirror.md), which left
autocompletion out of the Markdown editor.

## Context

Tag autocomplete was out of scope, and ADR-006 kept the editors free of autocompletion so that
what is typed is what is saved. A library grows tags in many spellings (`#JavaScript`,
`#javascript`, `#java-script`) and the tree is only as tidy as the tags typed; the owner asked
for the existing tags to be offered while one is typed, in the search box and in both editors.

## Decision

1. **Only tags are suggested**, nothing else: typing `#` and a character (by the tag rules,
   [tags](../tags.md)) lists the library's tags that start with the name typed, then those that
   contain it, at most eight, each with how many notes have it (`domain/tag/tag-suggestions.ts`).
   In a chain (`#java#co`) the last name is completed.
2. **Nothing is written unless a tag is taken:** ↑/↓ choose, Enter or a click takes the chosen
   tag in place of the name typed, Escape closes the list. Enter on the very tag typed is not
   taken in the editors: the list closes and Enter starts a new line, so a tag at the end of a
   line costs no extra key. What is typed otherwise is still what is saved.
3. **Only while typing:** the list opens on typed text, not when the caret moves next to a tag,
   nor after a paste or a tag just taken; never in code, HTML, URLs or the frontmatter.
4. **The suggestions are the catalog's** (`application/notes/tag-suggester.ts`), worked out
   again only when the notes change. The open note's own tags are left out, so a tag half typed
   and saved by a pause is not offered back.
5. **One list for every field:** `useTagCompletion` holds the choice and the keys, and the
   `TagSuggestions` list is the same under the search box and at the caret in either editor.
   The editors give the list's keys priority (a ProseMirror view prop, a `Prec.highest`
   CodeMirror handler); `@codemirror/autocomplete` is not used, so both editors behave alike.

## Consequences

- In the search box a tag taken becomes a filter chip at once.
- Screen readers hear the list through `aria-activedescendant` on the field or the editor.
- The search in the open note offers no tags: there `#` is text to find.
