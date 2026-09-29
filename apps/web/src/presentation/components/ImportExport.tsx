import { useId, useState, type ChangeEvent } from "react";
import { exportFiles } from "../../application/library/export-notes";
import { importMarkdown, type ImportReport } from "../../application/library/import-markdown";
import type { NoteRepository } from "../../application/notes/note-repository";
import { exportToFolder, isDesktop } from "../../infrastructure/desktop/desktop";
import { downloadFile, readMarkdownFiles, zipFiles } from "../../infrastructure/files/files";
import { errorMessage } from "./ErrorState";

type Result = { readonly text: string; readonly details: readonly string[] };

function describeImport(
  report: ImportReport,
  unreadable: readonly { name: string; reason: string }[],
) {
  const parts = [`Imported ${String(report.imported)} ${report.imported === 1 ? "note" : "notes"}`];
  if (report.duplicates > 0) parts.push(`${String(report.duplicates)} already in the library`);
  const problems = [...unreadable, ...report.rejected];
  if (problems.length > 0) parts.push(`${String(problems.length)} not imported`);
  return { text: `${parts.join(", ")}.`, details: problems.map((p) => `${p.name}: ${p.reason}`) };
}

/** Markdown in, Markdown out: `.md` files or a folder in, `.md` files (ZIP or folder) out. */
export function ImportExport({ store }: { store: NoteRepository }) {
  const filesId = useId();
  const folderId = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  function run(action: () => Promise<Result | null>) {
    setBusy(true);
    setFailure(null);
    setResult(null);
    action().then(
      (value) => {
        setResult(value);
        setBusy(false);
      },
      (error: unknown) => {
        setFailure(error);
        setBusy(false);
      },
    );
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    run(async () => {
      const { sources, rejected } = await readMarkdownFiles(files);
      return describeImport(await importMarkdown(sources, store), rejected);
    });
  }

  function handleExport() {
    run(async () => {
      const files = exportFiles(await store.list());
      if (files.length === 0) return { text: "There are no notes to export.", details: [] };
      if (isDesktop()) {
        const done = await exportToFolder(files);
        return done
          ? { text: `Exported ${String(done.written)} notes to ${done.folder}.`, details: [] }
          : null;
      }
      downloadFile("konspecter-notes.zip", zipFiles(files));
      return {
        text: `Exported ${String(files.length)} notes as konspecter-notes.zip.`,
        details: [],
      };
    });
  }

  return (
    <section className="setting offline-storage" aria-labelledby="import-export">
      <h2 id="import-export" className="setting-heading">
        Import &amp; export
      </h2>
      <p className="setting-hint">
        Notes are plain Markdown: imports keep files as written, and exports are the same{" "}
        <code>.md</code> files, readable without Konspecter.
      </p>
      <div className="actions">
        <label htmlFor={filesId} className="button">
          Import .md files…
        </label>
        <input
          id={filesId}
          className="visually-hidden"
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          disabled={busy}
          onChange={handleFiles}
        />
        <label htmlFor={folderId} className="button">
          Import a folder…
        </label>
        <input
          id={folderId}
          className="visually-hidden"
          type="file"
          {...{ webkitdirectory: "" }}
          disabled={busy}
          onChange={handleFiles}
        />
        <button type="button" className="button" disabled={busy} onClick={handleExport}>
          {isDesktop() ? "Export all to a folder…" : "Export all (.zip)"}
        </button>
      </div>
      {result && (
        <div role="status" className="setting-hint">
          <p>{result.text}</p>
          {result.details.length > 0 && (
            <ul>
              {result.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {failure !== null && (
        <p role="alert" className="inline-error">
          {errorMessage(failure)}
        </p>
      )}
    </section>
  );
}
