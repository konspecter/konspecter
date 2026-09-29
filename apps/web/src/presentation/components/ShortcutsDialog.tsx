import { useEffect, useRef } from "react";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { t } from "../i18n/i18n";

/** The shortcut registry as a definition list (the dialog and Settings). */
export function ShortcutList() {
  return (
    <dl className="shortcuts">
      {Object.values(SHORTCUTS).map(({ keys, label }) => (
        <div key={keys}>
          <dt>
            <kbd>{formatKeys(keys)}</kbd>
          </dt>
          <dd>{t(label)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id="shortcuts-title">{t("shortcuts.title")}</h2>
        <ShortcutList />
        <button ref={close} type="button" className="button" onClick={onClose}>
          {t("app.close")}
        </button>
      </div>
    </div>
  );
}
