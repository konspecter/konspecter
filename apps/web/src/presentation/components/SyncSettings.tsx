import { useId, useState, useSyncExternalStore, type SubmitEvent } from "react";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import { errorMessage } from "./ErrorState";
import { NoteDate } from "./NoteDate";

const STATE_TEXT: Record<SyncStatus["state"], string> = {
  disabled: "Not connected",
  idle: "Up to date",
  syncing: "Syncing…",
  offline: "Offline — changes are kept and sent when you are back online",
  error: "Sync failed; retrying",
};

export function syncSummary(status: SyncStatus): string {
  const parts = [STATE_TEXT[status.state]];
  if (status.pending > 0) parts.push(`${String(status.pending)} waiting to upload`);
  if (status.blocked > 0) parts.push(`${String(status.blocked)} held back`);
  return parts.join(" · ");
}

export function SyncSettings({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  return (
    <section className="setting sync-settings" aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="setting-heading">
        Sync
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
  return (
    <>
      <p className="setting-hint">
        Connected to <strong>{status.serverUrl}</strong> as <strong>{status.account?.email}</strong>
        .
      </p>
      <p role="status" className="sync-status">
        {syncSummary(status)}
        {status.lastSyncedAt && (
          <>
            {" · last synced "}
            <NoteDate value={status.lastSyncedAt} />
          </>
        )}
      </p>
      {status.error && <p className="inline-error">{status.error}</p>}
      {status.blocked > 0 && (
        <p className="setting-hint">
          Notes changed on two devices at once are held back with both versions kept.
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" onClick={() => void sync.syncNow()}>
          Sync now
        </button>
        <button type="button" className="button" onClick={() => void sync.disconnect()}>
          Disconnect
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
      <p className="setting-hint">
        Notes stay on this device either way. Connecting keeps them in step with a Konspecter
        server.
      </p>
      <label htmlFor={urlId}>Server URL</label>
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
      <label htmlFor={tokenId}>Access token</label>
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
      {error !== null && (
        <p role="alert" className="inline-error">
          Could not connect: {errorMessage(error)}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={connecting}>
          Connect
        </button>
      </div>
    </form>
  );
}
