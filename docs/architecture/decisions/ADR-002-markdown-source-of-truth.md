# ADR-002: Markdown is the source of truth

Status: accepted (2026-09-28)

## Context

Notes must outlive the application. Users should be able to back up, export, and edit them
in any editor, and recover them when an index is corrupted.

## Decision

Each note is a Markdown document with a small YAML frontmatter block (`title`, `created`,
`updated`, `author`, `tags`, `cover`). Everything the UI shows about a note, and every edit
made through it (title, author, tags, …), is read from and written to that text. Tag indexes, search indexes and reading positions are derived data
kept outside the document and are always rebuildable from the documents. Reading state
never modifies the Markdown.

## Consequences

- Export is a copy, and backups are usable without the app.
- Every index needs a "rebuild from documents" path, which has to be tested.
- Metadata is not duplicated outside the document. Local records hold only `id` and
  `markdown`, and dates are read from the frontmatter (added in the document format phase;
  see [markdown-format.md](../markdown-format.md)).
- Features that would need data Markdown cannot express (block IDs, rich embeds) must fit
  into Markdown or frontmatter, or be rejected.
- Parsing uses a mature CommonMark/GFM parser rather than a custom one.

## Alternatives considered

- **Database rows as the canonical form** (Markdown as an export format): simpler queries,
  but export becomes a lossy conversion and external editing becomes impossible.
- **Proprietary JSON/block format**: richer editing, but it breaks portability, which is
  the core promise.
