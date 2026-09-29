import type { NoteRepository } from "../notes/note-repository";
import type { FolderBridge } from "../../infrastructure/desktop/desktop";
import { importMarkdown, type ImportReport } from "./import-markdown";

/**
 * Copies every Markdown file of a folder into a library (see importMarkdown).
 * The files themselves are not changed.
 */
export async function importFolder(
  folder: FolderBridge,
  library: NoteRepository,
  now: Date = new Date(),
): Promise<ImportReport> {
  const sources = [];
  for (const entry of await folder.list()) {
    const { text } = await folder.read(entry.path);
    sources.push({ name: entry.path, text });
  }
  return importMarkdown(sources, library, now);
}
