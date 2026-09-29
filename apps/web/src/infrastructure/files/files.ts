import { strToU8, zipSync } from "fflate";
import type { MarkdownSource } from "../../application/library/import-markdown";
import type { ExportFile } from "../../application/library/export-notes";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Reads files chosen in the browser for import. Only `.md`/`.markdown` files
 * up to 5 MB are read; invalid UTF-8 is replaced rather than refused. With a
 * folder, other files are silently skipped.
 */
export async function readMarkdownFiles(files: readonly File[]): Promise<{
  sources: MarkdownSource[];
  rejected: { name: string; reason: string }[];
}> {
  const sources: MarkdownSource[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const decoder = new TextDecoder("utf-8");
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      if (!file.webkitRelativePath) rejected.push({ name, reason: "not a Markdown file" });
      continue;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      rejected.push({ name, reason: "larger than 5 MB" });
      continue;
    }
    sources.push({ name, text: decoder.decode(await file.arrayBuffer()) });
  }
  return { sources, rejected };
}

/** A ZIP of the files, each at the top level. */
export function zipFiles(files: readonly ExportFile[]): Blob {
  const entries = Object.fromEntries(files.map((file) => [file.name, strToU8(file.contents)]));
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

/** Offers a file to the browser for saving. */
export function downloadFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
