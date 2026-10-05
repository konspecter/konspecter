import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { appInfo, isDesktop, openInBrowser } from "../../infrastructure/desktop/desktop";
import { ApiError, type DeviceAuthorization } from "../../infrastructure/http/api-client";
import { isNativeMobile } from "../../infrastructure/mobile/mobile";
import {
  defaultServerUrl,
  describeDevice,
  DeviceLoginError,
} from "../../infrastructure/sync/device-login";
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
      ) : status.state === "disconnected" ? (
        <Disconnected sync={sync} status={status} />
      ) : (
        <SyncState sync={sync} status={status} />
      )}
    </section>
  );
}

function SyncState({ sync, status }: { sync: SyncEngine; status: SyncStatus }) {
  const errorText = useErrorMessage(status.error);
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
      {errorText !== null && <p className="inline-error">{errorText}</p>}
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

/** The server let this device go; its conspects are all still here. */
function Disconnected({ sync, status }: { sync: SyncEngine; status: SyncStatus }) {
  const revoked = status.error instanceof ApiError && status.error.code === "device_revoked";
  return (
    <>
      <p role="status" className="sync-status">
        {rich(revoked ? "sync.disconnectedBySite" : "sync.disconnectedByServer", {
          server: <strong>{status.serverUrl}</strong>,
          account: <strong>{status.account?.email}</strong>,
        })}
      </p>
      <p className="setting-hint">
        {status.pending > 0
          ? tn("sync.disconnectedPending", status.pending)
          : t("sync.disconnectedKept")}
      </p>
      <BrowserSignIn sync={sync} serverUrl={status.serverUrl ?? ""} label={t("sync.signInAgain")}>
        <button type="button" className="button" onClick={() => void sync.disconnect()}>
          {t("sync.forget")}
        </button>
      </BrowserSignIn>
    </>
  );
}

function ConnectForm({ sync }: { sync: SyncEngine }) {
  const urlId = useId();
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  return (
    <div className="connect-form">
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
      <BrowserSignIn sync={sync} serverUrl={serverUrl} label={t("sync.signInWithBrowser")} />
      <details className="connect-advanced">
        <summary>{t("sync.advanced")}</summary>
        <TokenForm sync={sync} serverUrl={serverUrl} />
      </details>
    </div>
  );
}

/** How this app introduces itself to the server (the site's device list). */
async function thisDevice() {
  const desktopOs = isDesktop() ? (await appInfo()).os : null;
  return describeDevice({ desktopOs, mobile: isNativeMobile(), userAgent: navigator.userAgent });
}

/**
 * Sign in with browser: the server gives a code, the approval page opens in
 * the browser, and the owner approves the code there while this waits.
 */
function BrowserSignIn({
  sync,
  serverUrl,
  label,
  children,
}: {
  sync: SyncEngine;
  serverUrl: string;
  label: string;
  children?: ReactNode;
}) {
  const [waiting, setWaiting] = useState<DeviceAuthorization | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancel = useRef<AbortController | null>(null);
  const errorText = useErrorMessage(error instanceof DeviceLoginError ? null : error);

  // Leaving the page (or the form) stops the wait.
  useEffect(() => () => cancel.current?.abort(), []);

  async function start() {
    const controller = new AbortController();
    cancel.current = controller;
    setBusy(true);
    setError(null);
    try {
      await sync.signInWithBrowser(
        serverUrl,
        await thisDevice(),
        (authorization) => {
          setWaiting(authorization);
          void openInBrowser(authorization.verificationUriComplete).catch(() => undefined);
        },
        controller.signal,
      );
    } catch (signInError) {
      if (!controller.signal.aborted) setError(signInError);
    }
    if (cancel.current === controller) cancel.current = null;
    if (!controller.signal.aborted) {
      setWaiting(null);
      setBusy(false);
    }
  }

  function stop() {
    cancel.current?.abort();
    cancel.current = null;
    setWaiting(null);
    setBusy(false);
  }

  if (waiting) {
    return (
      <div className="device-login" role="status">
        <p className="setting-hint">{t("sync.enterCode")}</p>
        <p className="device-login-code">{waiting.userCode}</p>
        <p className="setting-hint">{t("sync.waitingForApproval")}</p>
        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => void openInBrowser(waiting.verificationUriComplete)}
          >
            {t("sync.openPageAgain")}
          </button>
          <button type="button" className="button" onClick={stop}>
            {t("sync.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {error !== null && (
        <p role="alert" className="inline-error">
          {error instanceof DeviceLoginError
            ? t(error.reason === "denied" ? "sync.browserDenied" : "sync.browserExpired")
            : error instanceof ApiError && error.code === "not_configured"
              ? t("sync.browserUnavailable")
              : t("sync.connectFailed", { error: errorText ?? "" })}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || serverUrl.trim() === ""}
          onClick={() => void start()}
        >
          {label}
        </button>
        {children}
      </div>
    </>
  );
}

/** Connecting with an access token issued from the server's command line. */
function TokenForm({ sync, serverUrl }: { sync: SyncEngine; serverUrl: string }) {
  const tokenId = useId();
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
      <p className="setting-hint">{t("sync.tokenHint")}</p>
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
        <button type="submit" className="button" disabled={connecting || serverUrl.trim() === ""}>
          {t("sync.connect")}
        </button>
      </div>
    </form>
  );
}
