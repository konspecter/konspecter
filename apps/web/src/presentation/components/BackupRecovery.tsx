import { useCallback, useState } from "react";
import type { NoteRepository } from "../../application/notes/note-repository";
import { downloadFile } from "../../infrastructure/files/files";
import { useAsync } from "../hooks/use-async";
import { useErrorMessage } from "../hooks/use-error-message";
import { t, tn } from "../i18n/i18n";

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
  const failureText = useErrorMessage(failure);

  function run(action: () => Promise<string>) {
    setMessage(null);
    setFailure(null);
    action().then(setMessage, setFailure);
  }

  const records = unreadable.status === "success" ? unreadable.value : [];

  return (
    <section className="setting-block" aria-labelledby="backup-recovery">
      <h3 id="backup-recovery" className="setting-heading">
        {t("backup.title")}
      </h3>
      <p className="setting-hint">{t("backup.hint")}</p>
      {store.rebuildIndexes && (
        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              run(async () => {
                await store.rebuildIndexes?.();
                const count = (await store.list()).length;
                return tn("backup.rebuilt", count);
              });
            }}
          >
            {t("backup.rebuild")}
          </button>
        </div>
      )}
      {records.length > 0 && (
        <div role="alert" className="recovery">
          <p>{tn("backup.unreadable", records.length)}</p>
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
              {t("backup.download")}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={!saved}
              title={saved ? undefined : t("backup.downloadFirst")}
              onClick={() => {
                run(async () => {
                  await store.removeUnreadable?.(records.map((record) => record.key));
                  unreadable.retry();
                  return t("backup.removed");
                });
              }}
            >
              {t("backup.remove")}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="setting-hint">
          {message}
        </p>
      )}
      {failureText !== null && (
        <p role="alert" className="inline-error">
          {failureText}
        </p>
      )}
    </section>
  );
}
