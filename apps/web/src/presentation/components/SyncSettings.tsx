import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { WrongSecretError } from "@konspecter/crypto";
import { parseConnectLink, type ConnectLink } from "../../domain/sync/connect-link";
import { cameraAvailable } from "../../infrastructure/camera/qr-scanner";
import { appInfo, isDesktop, openInBrowser } from "../../infrastructure/desktop/desktop";
import { ApiError, type DeviceAuthorization } from "../../infrastructure/http/api-client";
import { isNativeMobile } from "../../infrastructure/mobile/mobile";
import {
  defaultServerUrl,
  describeDevice,
  DeviceLoginError,
} from "../../infrastructure/sync/device-login";
import {
  NoKeyError,
  type SyncEngine,
  type SyncStatus,
} from "../../infrastructure/sync/sync-engine";
import { useErrorMessage } from "../hooks/use-error-message";
import { NoteDate } from "./NoteDate";
import { QrScanDialog } from "./QrScanDialog";
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
      ) : status.state === "locked" ? (
        <Locked sync={sync} status={status} />
      ) : status.state === "unpaid" ? (
        <Unpaid sync={sync} status={status} />
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
      <AccessNote status={status} />
      {errorText !== null && <p className="inline-error">{errorText}</p>}
      {status.blocked > 0 && <p className="setting-hint">{t("sync.heldBack")}</p>}
      <div className="actions">
        <button type="button" className="button" onClick={() => void sync.syncNow()}>
          {t("sync.now")}
        </button>
        {status.access && status.access.state !== "free" && (
          <button
            type="button"
            className="button"
            onClick={() => void openInBrowser(subscriptionPage(status))}
          >
            {t("sync.manageSubscription")}
          </button>
        )}
        <button type="button" className="button" onClick={() => void sync.disconnect()}>
          {t("sync.disconnect")}
        </button>
      </div>
    </>
  );
}

/** Where the account's subscription is managed: its settings on the site. */
function subscriptionPage(status: SyncStatus): string {
  return `${status.serverUrl ?? ""}/settings#subscription`;
}

/** Paid sync: how long the account's time lasts (nothing where sync is free). */
function AccessNote({ status }: { status: SyncStatus }) {
  const access = status.access;
  if (access?.state === "active") return <p className="setting-hint">{t("sync.access.active")}</p>;
  if (!access?.until) return null;
  switch (access.state) {
    case "trialing":
    case "canceled":
    case "past_due":
      return (
        <p className="setting-hint">
          {rich(`sync.access.${access.state}`, { date: <NoteDate value={access.until} /> })}
        </p>
      );
    default:
      return null;
  }
}

/**
 * The server wants a subscription. Nothing is lost: the conspects are here
 * and on the server, and changes wait to be sent.
 */
function Unpaid({ sync, status }: { sync: SyncEngine; status: SyncStatus }) {
  return (
    <>
      <p className="setting-hint">
        {rich("sync.connectedTo", {
          server: <strong>{status.serverUrl}</strong>,
          account: <strong>{status.account?.email}</strong>,
        })}
      </p>
      <p role="status" className="sync-status">
        {status.access?.until ? t("sync.paused") : t("sync.unpaid")}
      </p>
      <p className="setting-hint">
        {status.pending > 0 ? tn("sync.unpaidPending", status.pending) : t("sync.unpaidKept")}
      </p>
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          onClick={() => void openInBrowser(subscriptionPage(status))}
        >
          {t("sync.subscribe")}
        </button>
        <button type="button" className="button" onClick={() => void sync.syncNow()}>
          {t("sync.checkAgain")}
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
        <ScanQrButton sync={sync} />
        <button type="button" className="button" onClick={() => void sync.disconnect()}>
          {t("sync.forget")}
        </button>
      </BrowserSignIn>
    </>
  );
}

/**
 * Connected, but the content key is not here: set up encryption on the site
 * first, or unlock it with the passphrase.
 */
function Locked({ sync, status }: { sync: SyncEngine; status: SyncStatus }) {
  const siteSettings = `${status.serverUrl ?? ""}/settings#encryption`;
  const passphraseId = useId();
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const known = error instanceof WrongSecretError || error instanceof NoKeyError;
  const errorText = useErrorMessage(known ? null : error);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnlocking(true);
    setError(null);
    try {
      await sync.unlock(passphrase);
    } catch (unlockError) {
      setError(unlockError);
      setUnlocking(false);
    }
  }

  const openSite = (
    <button type="button" className="button" onClick={() => void openInBrowser(siteSettings)}>
      {t("sync.openEncryptionSettings")}
    </button>
  );

  return (
    <>
      <p className="setting-hint">
        {rich("sync.connectedTo", {
          server: <strong>{status.serverUrl}</strong>,
          account: <strong>{status.account?.email}</strong>,
        })}
      </p>
      {status.lock === "setup" ? (
        <>
          <p role="status" className="sync-status">
            {t("sync.lockedSetup")}
          </p>
          <div className="actions">
            {openSite}
            <button type="button" className="button" onClick={() => void sync.disconnect()}>
              {t("sync.disconnect")}
            </button>
          </div>
        </>
      ) : (
        <form className="connect-form" onSubmit={(event) => void handleSubmit(event)}>
          <p role="status" className="sync-status">
            {t("sync.lockedUnlock")}
          </p>
          <label htmlFor={passphraseId}>{t("sync.passphrase")}</label>
          <input
            id={passphraseId}
            type="password"
            required
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value);
            }}
          />
          {error !== null && (
            <p role="alert" className="inline-error">
              {error instanceof WrongSecretError
                ? t("sync.wrongPassphrase")
                : error instanceof NoKeyError
                  ? t("sync.lockedSetup")
                  : t("sync.unlockFailed", { error: errorText ?? "" })}
            </p>
          )}
          <p className="setting-hint">{t("sync.forgotPassphrase")}</p>
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={unlocking}>
              {unlocking ? t("sync.unlocking") : t("sync.unlock")}
            </button>
            {openSite}
            <button type="button" className="button" onClick={() => void sync.disconnect()}>
              {t("sync.disconnect")}
            </button>
          </div>
        </form>
      )}
      {status.pending > 0 && <p className="setting-hint">{tn("sync.pending", status.pending)}</p>}
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
      <BrowserSignIn sync={sync} serverUrl={serverUrl} label={t("sync.signInWithBrowser")}>
        <ScanQrButton sync={sync} />
      </BrowserSignIn>
      <details className="connect-advanced">
        <summary>{t("sync.linkSummary")}</summary>
        <LinkForm sync={sync} />
      </details>
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

/**
 * Connecting with a link from the account site: its QR code scanned, or the
 * link pasted. On success the sync status moves on and this unmounts.
 */
function useLinkSignIn(sync: SyncEngine) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generic = useErrorMessage(error);
  const errorText =
    error === null
      ? null
      : error instanceof ApiError && error.code === "invalid_connect_code"
        ? t("sync.invalidConnectCode")
        : error instanceof ApiError && error.code === "not_configured"
          ? t("sync.browserUnavailable")
          : t("sync.connectFailed", { error: generic ?? "" });

  async function connectWith(link: ConnectLink) {
    setConnecting(true);
    setError(null);
    try {
      await sync.connectWithLink(link, await thisDevice());
    } catch (connectError) {
      setError(connectError);
      setConnecting(false);
    }
  }
  const clearError = useCallback(() => {
    setError(null);
  }, []);
  return { connecting, errorText, connectWith, clearError };
}

/** The camera, for the site's QR code; not in the desktop app, which pastes the link. */
function ScanQrButton({ sync }: { sync: SyncEngine }) {
  const [open, setOpen] = useState(false);
  const { connecting, errorText, connectWith, clearError } = useLinkSignIn(sync);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  if (isDesktop() || !cameraAvailable()) return null;
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => {
          clearError();
          setOpen(true);
        }}
      >
        {t("sync.scanQr")}
      </button>
      {open && (
        <QrScanDialog
          onLink={(link) => void connectWith(link)}
          onRetry={clearError}
          onClose={close}
          connecting={connecting}
          error={errorText}
        />
      )}
    </>
  );
}

/** The site's connect link, pasted (an app without a camera). */
function LinkForm({ sync }: { sync: SyncEngine }) {
  const linkId = useId();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { connecting, errorText, connectWith } = useLinkSignIn(sync);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = parseConnectLink(text);
    setInvalid(link === null);
    if (link) void connectWith(link);
  }

  const problem = invalid ? t("sync.linkInvalid") : errorText;
  return (
    <form className="connect-form" onSubmit={handleSubmit}>
      <p className="setting-hint">{t("sync.linkHint")}</p>
      <label htmlFor={linkId}>{t("sync.link")}</label>
      <input
        id={linkId}
        type="url"
        required
        autoComplete="off"
        spellCheck={false}
        placeholder="https://notes.example.com/connect#ksc_…"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {problem !== null && (
        <p role="alert" className="inline-error">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={connecting}>
          {connecting ? t("sync.connecting") : t("sync.linkConnect")}
        </button>
      </div>
    </form>
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
