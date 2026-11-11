import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { folderLabel, type LibraryFolder } from "../app/library";
import { useErrorMessage } from "../hooks/use-error-message";
import { t } from "../i18n/i18n";

/** Matches the native side's limit. */
const MAX_ALIAS = 100;

/**
 * Names a connected folder in the app. An empty field goes back to the
 * folder's own name. Escape and a click outside cancel; Enter saves.
 */
export function AliasDialog({
  folder,
  onSave,
  onCancel,
}: {
  folder: LibraryFolder;
  onSave: (alias: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [alias, setAlias] = useState(folder.alias ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);

  useEffect(() => {
    const previous = document.activeElement;
    field.current?.focus();
    field.current?.select();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog connect-form"
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setFailure(null);
          onSave(alias.trim() === "" ? null : alias.trim()).catch((error: unknown) => {
            setFailure(error);
            setSaving(false);
          });
        }}
      >
        <h2 id={titleId}>{t("settings.library.aliasTitle", { folder: folderLabel(folder) })}</h2>
        <label htmlFor={fieldId}>{t("settings.library.aliasLabel")}</label>
        <input
          ref={field}
          id={fieldId}
          type="text"
          maxLength={MAX_ALIAS}
          placeholder={folderLabel({ ...folder, alias: null })}
          aria-describedby={hintId}
          value={alias}
          onChange={(event) => {
            setAlias(event.target.value);
          }}
        />
        <p id={hintId} className="dialog-message">
          {t("settings.library.aliasHint")}
        </p>
        {failureText !== null && (
          <p role="alert" className="inline-error">
            {failureText}
          </p>
        )}
        <div className="actions dialog-actions">
          <button type="button" className="button" onClick={onCancel}>
            {t("app.cancel")}
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {t("settings.library.aliasSave")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
