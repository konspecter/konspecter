import { Fragment, useEffect, useRef } from "react";
import { formatKeys, shortcutGroups } from "../app/shortcuts";
import { t } from "../i18n/i18n";
import { CloseIcon } from "@konspecter/ui/icons";

/** The shortcut registry as a definition list, one row per action (the dialog and Settings). */
export function ShortcutList() {
  return (
    <dl className="shortcuts">
      {shortcutGroups().map(({ keys, label }) => (
        <div key={label}>
          <dt>
            {keys.map((key, index) => (
              <Fragment key={key}>
                {index > 0 && <span className="shortcut-or">{t("shortcuts.or")}</span>}
                <kbd>{formatKeys(key)}</kbd>
              </Fragment>
            ))}
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
        <div className="dialog-header">
          <h2 id="shortcuts-title">{t("shortcuts.title")}</h2>
          <button
            ref={close}
            type="button"
            className="icon-button"
            aria-label={t("app.close")}
            title={t("app.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <ShortcutList />
      </div>
    </div>
  );
}
