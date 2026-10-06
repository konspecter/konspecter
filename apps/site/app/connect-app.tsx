import { useEffect, useState } from "react";
import { Form, Link, useRevalidator } from "react-router";
import { FormMessage, Submit, type FormError } from "./auth-form";
import type { Device } from "./devices";
import { useT } from "./i18n/i18n";
import { QrCode } from "./qr-code";

/**
 * Connecting an app by QR code, on the settings page. "Show QR code" posts
 * to the page's action, which asks the API for a connect code; the code's
 * link shows as a QR code to scan with the app, and as text to paste into
 * an app without a camera. With the page's script, the device list is
 * checked every few seconds while the code shows: a new device replaces the
 * code with a notice, and the code is put away when it expires.
 */

/** A connect code as the action returns it. */
export interface ConnectCode {
  readonly url: string;
  readonly expiresIn: number;
}

/** The API's answer to POST /api/devices/connect-codes, or null. */
export function parseConnectCode(value: unknown): ConnectCode | null {
  if (typeof value !== "object" || value === null) return null;
  const { url, expires_in: expiresIn } = value as Record<string, unknown>;
  if (typeof url !== "string" || typeof expiresIn !== "number") return null;
  return { url, expiresIn };
}

const CHECK_EVERY_MS = 3_000;

export function ConnectApp({
  code,
  error,
  devices,
}: {
  code: ConnectCode | null;
  error: FormError | null;
  devices: readonly Device[];
}) {
  const { t } = useT();
  const { revalidate } = useRevalidator();
  // The code stays here once the action gave it: checking the devices
  // (a revalidation) clears the action's data. With it, the devices there
  // were when it appeared: any other is the one that scanned it.
  const [shown, setShown] = useState<{ code: ConnectCode; ids: ReadonlySet<string> } | null>(null);
  if (code && code.url !== shown?.code.url) {
    setShown({ code, ids: new Set(devices.map((device) => device.id)) });
  }
  const [expired, setExpired] = useState<string | null>(null);
  const current = shown?.code ?? null;
  const connected = shown ? devices.find((device) => !shown.ids.has(device.id)) : undefined;
  const showing = current !== null && expired !== current.url && connected === undefined;

  useEffect(() => {
    if (!showing) return;
    const check = setInterval(() => {
      void revalidate();
    }, CHECK_EVERY_MS);
    const expire = setTimeout(() => {
      setExpired(current.url);
    }, current.expiresIn * 1000);
    return () => {
      clearInterval(check);
      clearTimeout(expire);
    };
  }, [showing, current, revalidate]);

  const minutes = Math.max(1, Math.round((current?.expiresIn ?? 300) / 60));
  return (
    <>
      {connected && (
        <p className="form-notice" role="status">
          {t("settings.connect.connected", { name: connected.name })}
        </p>
      )}
      {current !== null && expired === current.url && !connected && (
        <p className="form-notice" role="status">
          {t("settings.connect.expired")}
        </p>
      )}
      {showing && (
        <div className="connect-code">
          <QrCode value={current.url} label={t("settings.connect.qrLabel")} />
          <div className="connect-code-about">
            <p className="settings-text">{t("settings.connect.scan")}</p>
            <p className="settings-text">{t("settings.connect.expires", { minutes })}</p>
            <ConnectLink url={current.url} />
          </div>
        </div>
      )}
      <Form method="post" className="settings-form">
        <FormMessage error={error} />
        <div className="actions">
          <Submit intent="connect" primary={!showing}>
            {current ? t("settings.connect.again") : t("settings.connect.show")}
          </Submit>
          {showing && (
            <Link
              to="/settings"
              className="button"
              preventScrollReset
              onClick={() => {
                setShown(null);
              }}
            >
              {t("settings.connect.done")}
            </Link>
          )}
        </div>
      </Form>
    </>
  );
}

/** The code's link, to paste into an app without a camera; copied with one click. */
function ConnectLink({ url }: { url: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="field connect-link">
      <label htmlFor="connect-link">{t("settings.connect.link")}</label>
      <div className="connect-link-row">
        <input
          id="connect-link"
          readOnly
          value={url}
          spellCheck={false}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? t("encryption.copied") : t("encryption.copy")}
        </button>
      </div>
    </div>
  );
}
