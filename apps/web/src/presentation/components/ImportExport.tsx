import { useId, useState, type ChangeEvent } from "react";
import { exportFiles } from "../../application/library/export-notes";
import { importMarkdown, type ImportReport } from "../../application/library/import-markdown";
import type { NoteRepository } from "../../application/notes/note-repository";
import { exportToFolder, isDesktop } from "../../infrastructure/desktop/desktop";
import { downloadFile, readMarkdownFiles, zipFiles } from "../../infrastructure/files/files";
import { errorMessage, reportError } from "../app/errors";
import { useErrorMessage } from "../hooks/use-error-message";
import { t, tn } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type Result = { readonly text: string; readonly details: readonly string[] };

function describeImport(
  report: ImportReport,
  unreadable: readonly { name: string; reason: string }[],
) {
  const parts = [tn("transfer.imported", report.imported)];
  if (report.duplicates > 0) parts.push(tn("transfer.duplicates", report.duplicates));
  const problems = [
    ...unreadable,
    ...report.rejected.map(({ name, error }) => {
      reportError(error);
      return { name, reason: errorMessage(error) };
    }),
  ];
  if (problems.length > 0) parts.push(tn("transfer.rejected", problems.length));
  return { text: `${parts.join(", ")}.`, details: problems.map((p) => `${p.name}: ${p.reason}`) };
}

/** Markdown in, Markdown out: `.md` files or a folder in, `.md` files (ZIP or folder) out. */
export function ImportExport({ store }: { store: NoteRepository }) {
  const filesId = useId();
  const folderId = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);

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
      if (files.length === 0) return { text: t("transfer.nothing"), details: [] };
      if (isDesktop()) {
        const done = await exportToFolder(files);
        return done
          ? {
              text: tn("transfer.exportedTo", done.written, { folder: done.folder }),
              details: [],
            }
          : null;
      }
      downloadFile("konspecter-conspects.zip", zipFiles(files));
      return {
        text: tn("transfer.exportedZip", files.length, { file: "konspecter-conspects.zip" }),
        details: [],
      };
    });
  }

  return (
    <section className="setting offline-storage" aria-labelledby="import-export">
      <h2 id="import-export" className="setting-heading">
        {t("transfer.title")}
      </h2>
      <p className="setting-hint">{rich("transfer.hint", { md: <code>.md</code> })}</p>
      <div className="actions">
        <label htmlFor={filesId} className="button">
          {t("transfer.importFiles")}
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
          {t("transfer.importFolder")}
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
          {isDesktop() ? t("transfer.exportFolder") : t("transfer.exportZip")}
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
      {failureText !== null && (
        <p role="alert" className="inline-error">
          {failureText}
        </p>
      )}
    </section>
  );
}
