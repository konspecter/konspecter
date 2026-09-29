import { useCallback, useState } from "react";
import type { NoteRepository } from "../../application/notes/note-repository";
import { downloadFile } from "../../infrastructure/files/files";
import { useAsync } from "../hooks/use-async";
import { errorMessage } from "./ErrorState";

/**
 * Backups are the Markdown export. Recovery rebuilds derived indexes and deals
 * with stored records that cannot be read, without discarding anything unasked.
 */
export function BackupRecovery({ store }: { store: NoteRepository }) {
  const load = useCallback(
    () => (store.unreadableRecords ? store.unreadableRecords() : Promise.resolve([])),
    [store],
  );
  const unreadable = useAsync(load);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  function run(action: () => Promise<string>) {
    setMessage(null);
    setFailure(null);
    action().then(setMessage, setFailure);
  }

  const records = unreadable.status === "success" ? unreadable.value : [];

  return (
    <section className="setting offline-storage" aria-labelledby="backup-recovery">
      <h2 id="backup-recovery" className="setting-heading">
        Backup &amp; recovery
      </h2>
      <p className="setting-hint">
        To back up, export all notes: the files are plain Markdown and need nothing else to be read.
        Tag and search indexes are built from the notes and can always be rebuilt.
      </p>
      {store.rebuildIndexes && (
        <button
          type="button"
          className="button"
          onClick={() => {
            run(async () => {
              await store.rebuildIndexes?.();
              const count = (await store.list()).length;
              return `Indexes rebuilt from ${String(count)} ${count === 1 ? "note" : "notes"}.`;
            });
          }}
        >
          Rebuild indexes
        </button>
      )}
      {records.length > 0 && (
        <div role="alert" className="recovery">
          <p>
            {records.length === 1 ? "1 stored record" : `${String(records.length)} stored records`}{" "}
            could not be read as notes. They are kept as they are. Download them to inspect or
            restore by hand, then remove them.
          </p>
          <ul>
            {records.map((record) => (
              <li key={record.key}>
                <code>{record.key}</code>: {record.reason}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                const json = JSON.stringify(records, null, 2);
                downloadFile(
                  "konspecter-unreadable-records.json",
                  new Blob([json], { type: "application/json" }),
                );
                setSaved(true);
              }}
            >
              Download them (.json)
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={!saved}
              title={saved ? undefined : "Download them first"}
              onClick={() => {
                run(async () => {
                  await store.removeUnreadable?.(records.map((record) => record.key));
                  unreadable.retry();
                  return "Unreadable records removed.";
                });
              }}
            >
              Remove them
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="setting-hint">
          {message}
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="inline-error">
          {errorMessage(failure)}
        </p>
      )}
    </section>
  );
}
