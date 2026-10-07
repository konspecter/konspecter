import { useEffect, useState, type SubmitEvent } from "react";
import { Form, Link, useRevalidator, useSubmit } from "react-router";
import { FormMessage, Submit, type FormError } from "./auth-form";
import type { Device } from "./devices";
import { useT } from "./i18n/i18n";
import { QrCode } from "./qr-code";
import { sealRememberedKey, useRememberedKeyId } from "./remembered-key";

/**
 * Connecting an app by QR code, on the settings page. "Show QR code" posts
 * to the page's action, which asks the API for a connect code; the code's
 * link shows as a QR code to scan with the app, and as text to paste into
 * an app without a camera. With the page's script, the device list is
 * checked every few seconds while the code shows: a new device replaces the
 * code with a notice, and the code is put away when it expires.
 *
 * When this browser remembers the encryption key (remembered-key.ts), the
 * request carries the key sealed with a new secret, and the secret is added
 * to the link's fragment here: it never reaches the server, and the app
 * that scans the code needs no passphrase (ADR-025).
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

/** `account` is the signed-in account's email, whose remembered key the codes may carry. */
export function ConnectApp({
  account,
  code,
  error,
  devices,
}: {
  account: string;
  code: ConnectCode | null;
  error: FormError | null;
  devices: readonly Device[];
}) {
  const { t } = useT();
  const { revalidate } = useRevalidator();
  const submit = useSubmit();
  const remembered = useRememberedKeyId(account);
  // The secret of the key sent with the code being asked for (null: none).
  const [secret, setSecret] = useState<string | null>(null);
  // The code stays here once the action gave it: checking the devices
  // (a revalidation) clears the action's data. With it, the devices there
  // were when it appeared (any other is the one that scanned it), and the
  // secret that opens the key it carries.
  const [shown, setShown] = useState<{
    code: ConnectCode;
    ids: ReadonlySet<string>;
    secret: string | null;
  } | null>(null);
  if (code && code.url !== shown?.code.url) {
    setShown({ code, ids: new Set(devices.map((device) => device.id)), secret });
  }
  const [expired, setExpired] = useState<string | null>(null);
  const current = shown?.code ?? null;
  const link = current && shown?.secret ? `${current.url}.${shown.secret}` : current?.url;
  const connected = shown ? devices.find((device) => !shown.ids.has(device.id)) : undefined;
  const showing = current !== null && expired !== current.url && connected === undefined;

  // With a remembered key, the request carries it sealed; the secret stays here.
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    setSecret(null);
    if (!remembered) return;
    event.preventDefault();
    void sealRememberedKey(account).then((sealed) => {
      const data = new FormData();
      data.set("intent", "connect");
      if (sealed) {
        data.set("key_id", sealed.keyId);
        data.set("sealed_key", sealed.sealedKey);
        setSecret(sealed.secret);
      }
      return submit(data, { method: "post" });
    });
  }

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
          {t(shown?.secret ? "settings.connect.connectedWithKey" : "settings.connect.connected", {
            name: connected.name,
          })}
        </p>
      )}
      {current !== null && expired === current.url && !connected && (
        <p className="form-notice" role="status">
          {t("settings.connect.expired")}
        </p>
      )}
      {showing && (
        <div className="connect-code">
          <QrCode value={link ?? current.url} label={t("settings.connect.qrLabel")} />
          <div className="connect-code-about">
            <p className="settings-text">
              {t(shown?.secret ? "settings.connect.scanWithKey" : "settings.connect.scan")}
            </p>
            <p className="settings-text">{t("settings.connect.expires", { minutes })}</p>
            <ConnectLink url={link ?? current.url} />
          </div>
        </div>
      )}
      {!showing && remembered !== undefined && (
        <p className="settings-text">
          {remembered ? (
            t("settings.connect.withKey")
          ) : (
            <>
              {t("settings.connect.withoutKey")}{" "}
              <a href="#encryption">{t("settings.connect.rememberLink")}</a>
            </>
          )}
        </p>
      )}
      <Form method="post" className="settings-form" onSubmit={handleSubmit}>
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
