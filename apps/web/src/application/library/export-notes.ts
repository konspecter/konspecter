import { documentTitle } from "../../domain/document/document";
import { uniqueFileNames } from "../../domain/note/file-name";
import { readNote, type Note } from "../../domain/note/note";

export type ExportFile = {
  readonly name: string;
  readonly title: string;
  readonly contents: string;
};

/**
 * Notes as `.md` files, exactly as stored (frontmatter included), named after
 * their titles. No conversion: the export is the library.
 */
export function exportFiles(notes: readonly Note[]): ExportFile[] {
  const titles = notes.map((note) => {
    const read = readNote(note);
    return (read.valid ? documentTitle(read.document) : "") || "Untitled";
  });
  const names = uniqueFileNames(titles);
  return notes.map((note, index) => ({
    name: names[index] ?? `${note.id}.md`,
    title: titles[index] ?? "Untitled",
    contents: note.markdown,
  }));
}
