# ADR-006: CodeMirror 6 for the Markdown editor

Status: accepted (2026-09-28)

## Context

Markdown mode edits the whole document as source, frontmatter included. It needs Markdown
and YAML highlighting, highlighting inside fenced code, undo and search, good performance on
long notes, and accessibility. The plan rules out autocompletion.

## Decision

Use CodeMirror 6 (`@codemirror/*`, MIT), assembled from individual extensions rather than
`basicSetup`: history, search, selection drawing, line wrapping, placeholder, and
`yamlFrontmatter` over `markdown` (GFM) with `@codemirror/language-data` for fenced code.
Autocompletion, bracket closing and line numbers are deliberately left out. Highlight colours
reuse the reader's CSS tokens.

## Consequences

- Grammars for fenced-code languages are separate chunks, loaded when a block first uses
  them, so the editor chunk stays small (about 140 kB gzipped with ProseMirror).
- The editor is uncontrolled: React passes the initial value and receives changes. Switching
  modes remounts it.
- Tests read and write the document through `EditorView.findFromDOM`, and real typing works
  in jsdom.

## Alternatives considered

- **Plain `<textarea>`**: no dependencies, but no highlighting, and poor for long documents
  and code.
- **Monaco**: very capable, but several megabytes, desktop-oriented, and awkward on mobile.
- **CodeMirror 5 / Ace**: older architectures with weaker mobile and accessibility support.
