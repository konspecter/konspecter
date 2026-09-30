import { useId, useState, useSyncExternalStore, type SubmitEvent } from "react";
import { ApiError } from "../../infrastructure/http/api-client";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import { useErrorMessage } from "../hooks/use-error-message";
import { NoteDate } from "./NoteDate";
import { t, tn } from "../i18n/i18n";
import { rich } from "../i18n/rich";

export function syncSummary(status: SyncStatus): string {
  const parts = [t(`sync.state.${status.state}`)];
  if (status.pending > 0) parts.push(tn("sync.pending", status.pending));
  if (status.blocked > 0) parts.push(tn("sync.blocked", status.blocked));
  return parts.join(" · ");
}

export function SyncSettings({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  return (
    <section className="setting sync-settings" aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="setting-heading">
        {t("sync.title")}
      </h2>
      {status.state === "disabled" ? (
        <ConnectForm sync={sync} />
      ) : (
        <SyncState sync={sync} status={status} />
      )}
    </section>
  );
}

function SyncState({ sync, status }: { sync: SyncEngine; status: SyncStatus }) {
  const errorText = useErrorMessage(status.error);
  const tokenRejected = status.error instanceof ApiError && status.error.status === 401;
  return (
    <>
      <p className="setting-hint">
        {rich("sync.connectedTo", {
          server: <strong>{status.serverUrl}</strong>,
          account: <strong>{status.account?.email}</strong>,
        })}
      </p>
      <p role="status" className="sync-status">
        {syncSummary(status)}
        {status.lastSyncedAt && (
          <>
            {" · "}
            {rich("sync.lastSynced", { date: <NoteDate value={status.lastSyncedAt} /> })}
          </>
        )}
      </p>
      {errorText !== null && (
        <p className="inline-error">{tokenRejected ? t("sync.tokenRejected") : errorText}</p>
      )}
      {status.blocked > 0 && <p className="setting-hint">{t("sync.heldBack")}</p>}
      <div className="actions">
        <button type="button" className="button" onClick={() => void sync.syncNow()}>
          {t("sync.now")}
        </button>
        <button type="button" className="button" onClick={() => void sync.disconnect()}>
          {t("sync.disconnect")}
        </button>
      </div>
    </>
  );
}

function ConnectForm({ sync }: { sync: SyncEngine }) {
  const urlId = useId();
  const tokenId = useId();
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errorText = useErrorMessage(error);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      await sync.connect({ serverUrl, token });
    } catch (connectError) {
      setError(connectError);
      setConnecting(false);
    }
  }

  return (
    <form className="connect-form" onSubmit={(event) => void handleSubmit(event)}>
      <p className="setting-hint">{t("sync.intro")}</p>
      <label htmlFor={urlId}>{t("sync.serverUrl")}</label>
      <input
        id={urlId}
        type="url"
        required
        placeholder="https://notes.example.com"
        value={serverUrl}
        onChange={(event) => {
          setServerUrl(event.target.value);
        }}
      />
      <label htmlFor={tokenId}>{t("sync.token")}</label>
      <input
        id={tokenId}
        type="password"
        required
        autoComplete="off"
        placeholder="ksp_…"
        value={token}
        onChange={(event) => {
          setToken(event.target.value);
        }}
      />
      {errorText !== null && (
        <p role="alert" className="inline-error">
          {t("sync.connectFailed", { error: errorText })}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={connecting}>
          {t("sync.connect")}
        </button>
      </div>
    </form>
  );
}
