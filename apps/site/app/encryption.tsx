import {
  createKey,
  keyFromJson,
  keyToJson,
  MIN_PASSPHRASE_LENGTH,
  openWithPassphrase,
  openWithRecoveryKey,
  parseRecoveryKey,
  rewrap,
  WrongSecretError,
  type KeyRecord,
  type StoredKey,
} from "@konspecter/crypto";
import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import { Field } from "./auth-form";
import { useLocale, useT, type SiteTranslator } from "./i18n/i18n";
import { forgetKey, forgetKeyUnless, rememberKey, useRememberedKeyId } from "./remembered-key";

/**
 * The Encryption section of the settings page. It runs in the browser only:
 * the passphrase and the content key never leave it. The server gets (and
 * gives back) the key wrapped, through /api/keys with the session cookie.
 *
 * Wherever the passphrase or the recovery key opens the key here, this
 * browser remembers it, so its QR codes connect apps without the passphrase
 * (remembered-key.ts); it can be forgotten again.
 */

type TextKey = Parameters<SiteTranslator["t"]>[0];

/** Why an action failed, as a message key. */
class Problem extends Error {
  constructor(readonly text: TextKey) {
    super(text);
  }
}

async function keysRequest(method: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch("/api/keys", {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Problem("encryption.error.network");
  }
  if (response.status === 204) return null;
  const json = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return json;
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
  if (response.status === 401) throw new Problem("encryption.error.signedOut");
  if (code === "key_conflict") throw new Problem("encryption.error.conflict");
  if (code === "no_key") throw new Problem("encryption.error.gone");
  throw new Problem("encryption.error.failed");
}

/** The account's key, or null when encryption is not set up. */
async function loadKey(): Promise<StoredKey | null> {
  try {
    return keyFromJson(await keysRequest("GET"));
  } catch (error) {
    if (error instanceof Problem && error.text === "encryption.error.gone") return null;
    if (error instanceof TypeError) throw new Problem("encryption.error.failed");
    throw error;
  }
}

async function saveKey(record: KeyRecord, updatedAt?: string): Promise<StoredKey> {
  return keyFromJson(await keysRequest("PUT", keyToJson(record, updatedAt)));
}

/** A new passphrase and its repetition; a problem, or null when they will do. */
function passphraseProblem(passphrase: string, repeated: string): TextKey | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return "encryption.error.short";
  if (passphrase !== repeated) return "encryption.error.mismatch";
  return null;
}

function text(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly problem: TextKey }
  | { readonly kind: "off" }
  | {
      readonly kind: "recovery";
      readonly record: KeyRecord;
      readonly recoveryKey: string;
      readonly raw: Uint8Array<ArrayBuffer>;
    }
  | { readonly kind: "on"; readonly key: StoredKey };

/** Remembers the key `raw` opened, once the server has what was changed; then wipes it. */
async function rememberOpened(account: string, keyId: string, raw: Uint8Array<ArrayBuffer>) {
  try {
    await rememberKey(account, keyId, raw);
  } finally {
    raw.fill(0);
  }
}

/** `account` is the signed-in account's email: the key is remembered for it alone. */
export function Encryption({ account }: { account: string }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice, setNotice] = useState<TextKey | null>(null);

  useEffect(() => {
    let current = true;
    loadKey().then(
      (key) => {
        // A key remembered before a reset (or another account's) is no use.
        void forgetKeyUnless(account, key?.keyId ?? null);
        if (current) setState(key ? { kind: "on", key } : { kind: "off" });
      },
      (error: unknown) => {
        if (current) setState({ kind: "failed", problem: problemOf(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [account]);

  return (
    <div className="encryption">
      {notice && (
        <p className="form-notice" role="status">
          {t(notice)}
        </p>
      )}
      {state.kind === "loading" && (
        <>
          <p className="settings-text">{t("encryption.loading")}</p>
          <noscript>
            <p className="inline-error">{t("encryption.needsScript")}</p>
          </noscript>
        </>
      )}
      {state.kind === "failed" && <p className="inline-error">{t(state.problem)}</p>}
      {state.kind === "off" && (
        <SetUp
          onCreated={(record, recoveryKey, raw) => {
            setNotice(null);
            setState({ kind: "recovery", record, recoveryKey, raw });
          }}
        />
      )}
      {state.kind === "recovery" && (
        <SaveRecoveryKey
          record={state.record}
          recoveryKey={state.recoveryKey}
          onSaved={async (key) => {
            await rememberOpened(account, key.keyId, state.raw);
            setNotice("encryption.setUpDone");
            setState({ kind: "on", key });
          }}
        />
      )}
      {state.kind === "on" && (
        <KeyOn
          account={account}
          stored={state.key}
          onChanged={(key, done) => {
            setNotice(done);
            setState({ kind: "on", key });
          }}
          onReset={() => {
            setNotice("encryption.resetDone");
            setState({ kind: "off" });
          }}
        />
      )}
    </div>
  );
}

function problemOf(error: unknown): TextKey {
  if (error instanceof Problem) return error.text;
  console.error(error);
  return "encryption.error.failed";
}

/** A form whose submit runs `action`, shows "One moment…" and the problem it hits. */
function ActionForm({
  submit,
  danger = false,
  action,
  children,
}: {
  submit: string;
  danger?: boolean;
  action: (form: HTMLFormElement) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<TextKey | null>(null);

  async function handle(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setProblem(null);
    try {
      await action(form);
      // Done: clear the secrets out of the fields and fold the action away.
      form.reset();
      form.closest("details")?.removeAttribute("open");
    } catch (error) {
      setProblem(problemOf(error));
    }
    setBusy(false);
  }

  return (
    <form className="settings-form" onSubmit={(event) => void handle(event)}>
      {children}
      {problem && (
        <p className="inline-error" role="alert">
          {t(problem)}
        </p>
      )}
      <div className="actions">
        <button
          type="submit"
          className={danger ? "button button-danger" : "button button-primary"}
          disabled={busy}
        >
          {busy ? t("auth.working") : submit}
        </button>
      </div>
    </form>
  );
}

function NewPassphrase() {
  const { t } = useT();
  return (
    <>
      <Field
        label={t("encryption.newPassphrase")}
        hint={t("encryption.passphraseHint", { count: MIN_PASSPHRASE_LENGTH })}
        name="passphrase"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSPHRASE_LENGTH}
        required
      />
      <Field
        label={t("encryption.repeatPassphrase")}
        name="repeated"
        type="password"
        autoComplete="new-password"
        required
      />
    </>
  );
}

function newPassphrase(form: HTMLFormElement): string {
  const passphrase = text(form, "passphrase");
  const problem = passphraseProblem(passphrase, text(form, "repeated"));
  if (problem) throw new Problem(problem);
  return passphrase;
}

function SetUp({
  onCreated,
}: {
  onCreated: (record: KeyRecord, recoveryKey: string, raw: Uint8Array<ArrayBuffer>) => void;
}) {
  const { t } = useT();
  return (
    <>
      <p className="settings-callout">{t("encryption.offLead")}</p>
      <ActionForm
        submit={t("encryption.setUp")}
        action={async (form) => {
          const { record, recoveryKey, raw } = await createKey(newPassphrase(form));
          onCreated(record, recoveryKey, raw);
        }}
      >
        <NewPassphrase />
      </ActionForm>
    </>
  );
}

/** The recovery key, shown once; the key is stored only after it is typed back. */
function SaveRecoveryKey({
  record,
  recoveryKey,
  onSaved,
}: {
  record: KeyRecord;
  recoveryKey: string;
  onSaved: (key: StoredKey) => Promise<void>;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p className="settings-text">{t("encryption.recoveryLead")}</p>
      <div className="recovery-key">
        <p className="recovery-key-value" aria-label={t("encryption.recoveryKey")}>
          {recoveryKey}
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard.writeText(recoveryKey).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? t("encryption.copied") : t("encryption.copy")}
        </button>
      </div>
      <ActionForm
        submit={t("encryption.finishSetUp")}
        action={async (form) => {
          const typed = parseRecoveryKey(text(form, "recovery"));
          const shown = parseRecoveryKey(recoveryKey);
          if (!typed || !shown || typed.some((byte, i) => byte !== shown[i])) {
            throw new Problem("encryption.error.recoveryMismatch");
          }
          await onSaved(await saveKey(record));
        }}
      >
        <Field
          label={t("encryption.confirmRecovery")}
          name="recovery"
          autoComplete="off"
          spellCheck={false}
          required
          className="recovery-input"
        />
      </ActionForm>
    </>
  );
}

function KeyOn({
  account,
  stored,
  onChanged,
  onReset,
}: {
  account: string;
  stored: StoredKey;
  onChanged: (key: StoredKey, done: TextKey) => void;
  onReset: () => void;
}) {
  const { t } = useT();
  const locale = useLocale();
  const remembered = useRememberedKeyId(account);
  const since = new Date(stored.createdAt).toLocaleDateString(locale, { dateStyle: "long" });
  return (
    <>
      <p className="settings-text">{t("encryption.onLead", { date: since })}</p>
      {remembered === stored.keyId ? (
        <div className="encryption-remembered">
          <p className="settings-text">{t("encryption.remembered")}</p>
          <button
            type="button"
            className="button"
            onClick={() => {
              void forgetKey().then(() => {
                onChanged(stored, "encryption.forgotten");
              });
            }}
          >
            {t("encryption.forget")}
          </button>
        </div>
      ) : (
        remembered !== undefined && (
          <details className="encryption-action">
            <summary>{t("encryption.remember")}</summary>
            <p className="settings-text">{t("encryption.rememberLead")}</p>
            <ActionForm
              submit={t("encryption.rememberSubmit")}
              action={async (form) => {
                let raw;
                try {
                  raw = await openWithPassphrase(stored, text(form, "passphrase"));
                } catch (error) {
                  if (error instanceof WrongSecretError)
                    throw new Problem("encryption.error.wrongPassphrase");
                  throw error;
                }
                await rememberOpened(account, stored.keyId, raw);
                onChanged(stored, "encryption.rememberedNow");
              }}
            >
              <Field
                label={t("encryption.passphrase")}
                name="passphrase"
                type="password"
                autoComplete="current-password"
                required
              />
            </ActionForm>
          </details>
        )
      )}
      <details className="encryption-action">
        <summary>{t("encryption.change")}</summary>
        <ActionForm
          submit={t("encryption.changeSubmit")}
          action={async (form) => {
            const next = newPassphrase(form);
            let raw;
            try {
              raw = await openWithPassphrase(stored, text(form, "current"));
            } catch (error) {
              if (error instanceof WrongSecretError)
                throw new Problem("encryption.error.wrongCurrent");
              throw error;
            }
            const opened = raw.slice(); // rewrap wipes raw.
            const saved = await saveKey(await rewrap(stored, raw, next), stored.updatedAt);
            await rememberOpened(account, saved.keyId, opened);
            onChanged(saved, "encryption.changed");
          }}
        >
          <Field
            label={t("encryption.currentPassphrase")}
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
          <NewPassphrase />
        </ActionForm>
      </details>
      <details className="encryption-action">
        <summary>{t("encryption.recover")}</summary>
        <p className="settings-text">{t("encryption.recoverLead")}</p>
        <ActionForm
          submit={t("encryption.recoverSubmit")}
          action={async (form) => {
            const next = newPassphrase(form);
            let raw;
            try {
              raw = await openWithRecoveryKey(stored, text(form, "recovery"));
            } catch (error) {
              if (error instanceof WrongSecretError)
                throw new Problem("encryption.error.wrongRecovery");
              throw error;
            }
            const opened = raw.slice(); // rewrap wipes raw.
            const saved = await saveKey(await rewrap(stored, raw, next), stored.updatedAt);
            await rememberOpened(account, saved.keyId, opened);
            onChanged(saved, "encryption.changed");
          }}
        >
          <Field
            label={t("encryption.recoveryKey")}
            name="recovery"
            autoComplete="off"
            spellCheck={false}
            required
            className="recovery-input"
          />
          <NewPassphrase />
        </ActionForm>
      </details>
      <details className="encryption-action">
        <summary>{t("encryption.reset")}</summary>
        <p className="settings-text">{t("encryption.resetLead")}</p>
        <ActionForm
          submit={t("encryption.resetSubmit")}
          danger
          action={async () => {
            await keysRequest("DELETE");
            await forgetKey();
            onReset();
          }}
        >
          <label className="check">
            <input type="checkbox" name="understood" required />
            <span>{t("encryption.resetConfirm")}</span>
          </label>
        </ActionForm>
      </details>
    </>
  );
}
