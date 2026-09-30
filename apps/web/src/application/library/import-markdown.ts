import { InvalidDocumentError, parseDocument } from "../../domain/document/document";
import type { NoteRepository } from "../notes/note-repository";

/** A Markdown file to import, already read as text. */
export type MarkdownSource = { readonly name: string; readonly text: string };

export type ImportReport = {
  readonly imported: number;
  /** Files whose content the library already has. */
  readonly duplicates: number;
  /** Files the library refused, with the error (the interface words it). */
  readonly rejected: readonly { readonly name: string; readonly error: unknown }[];
};

/** Compares notes by content, ignoring frontmatter and the escape added below. */
function bodyOf(markdown: string): string {
  try {
    return parseDocument(markdown)
      .body.trim()
      .replace(/^\\---/, "---");
  } catch {
    return markdown.trim();
  }
}

/**
 * Adds Markdown files to a library as new notes, keeping their content
 * (frontmatter included) as written. Files whose body the library already has
 * are skipped, so importing twice adds nothing. A file with invalid
 * frontmatter is still imported, with the block escaped so it reads as text.
 */
export async function importMarkdown(
  sources: readonly MarkdownSource[],
  library: NoteRepository,
  now: Date = new Date(),
): Promise<ImportReport> {
  const existing = new Set((await library.list()).map((note) => bodyOf(note.markdown)));
  let imported = 0;
  let duplicates = 0;
  const rejected: { name: string; error: unknown }[] = [];
  for (const { name, text } of sources) {
    const body = bodyOf(text);
    if (existing.has(body)) {
      duplicates += 1;
      continue;
    }
    try {
      try {
        await library.create(text, now);
      } catch (error) {
        if (!(error instanceof InvalidDocumentError)) throw error;
        await library.create(text.replace(/^\uFEFF?---/, "\\---"), now);
      }
      existing.add(body);
      imported += 1;
    } catch (error) {
      rejected.push({ name, error });
    }
  }
  return { imported, duplicates, rejected };
}
