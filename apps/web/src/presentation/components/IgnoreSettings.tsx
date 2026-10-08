import { useCallback, useId, useState } from "react";
import { DEFAULT_IGNORE, IGNORE_FILE } from "../../domain/note/ignore";
import type { FolderIgnore } from "../app/library";
import { useAsync } from "../hooks/use-async";
import { useErrorMessage } from "../hooks/use-error-message";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type IgnoreSettingsProps = {
  /** The rules as stored. */
  saved: string;
  onSave: (text: string) => Promise<void>;
  /** Whether the rules are the open folder's file (File Mode) rather than the app's. */
  inFolder: boolean;
};

/**
 * The `.konspecterignore` rules, edited as text: Save stores them (the app's
 * settings, or the folder's file), Restore default puts the default back in
 * the box to be saved.
 */
export function IgnoreSettings({ saved, onSave, inFolder }: IgnoreSettingsProps) {
  const id = useId();
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);
  const code = { file: <code>{IGNORE_FILE}</code> };

  function save() {
    setBusy(true);
    setDone(false);
    setFailure(null);
    onSave(draft).then(
      () => {
        setBusy(false);
        setDone(true);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(error);
      },
    );
  }

  return (
    <section className="setting-block" aria-labelledby="ignore-heading">
      <h3 id="ignore-heading" className="setting-heading">
        {t("ignore.title")}
      </h3>
      <p className="setting-hint">{inFolder ? rich("ignore.folder", code) : t("ignore.app")}</p>
      <p className="setting-hint">
        {rich("ignore.syntax", {
          hidden: <code>.*</code>,
          negate: <code>!</code>,
          comment: <code>#</code>,
        })}
      </p>
      <label htmlFor={id} className="setting-label ignore-label">
        {rich("ignore.label", code)}
      </label>
      <textarea
        id={id}
        className="ignore-rules"
        rows={7}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setDone(false);
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || draft === saved}
          onClick={save}
        >
          {t("ignore.save")}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || draft === DEFAULT_IGNORE}
          onClick={() => {
            setDraft(DEFAULT_IGNORE);
            setDone(false);
          }}
        >
          {t("ignore.default")}
        </button>
      </div>
      {done && (
        <p role="status" className="setting-hint">
          {t("ignore.saved")}
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

/** File Mode: the open folder's rules, read from its file. */
export function FolderIgnoreSettings({ ignore }: { ignore: FolderIgnore }) {
  const load = useCallback(() => ignore.read(), [ignore]);
  const rules = useAsync(load);
  const [saved, setSaved] = useState<string | null>(null);
  const failureText = useErrorMessage(rules.status === "error" ? rules.error : null);

  if (rules.status === "loading") return null;
  if (rules.status === "error") {
    return (
      <section className="setting-block" aria-labelledby="ignore-heading">
        <h3 id="ignore-heading" className="setting-heading">
          {t("ignore.title")}
        </h3>
        <p role="alert" className="inline-error">
          {failureText}
        </p>
      </section>
    );
  }
  return (
    <IgnoreSettings
      saved={saved ?? rules.value}
      inFolder
      onSave={async (text) => {
        await ignore.save(text);
        setSaved(text);
      }}
    />
  );
}
