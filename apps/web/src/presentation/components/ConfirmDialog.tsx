import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/i18n";

type ConfirmDialogProps = {
  title: string;
  message: string;
  /** The button that goes ahead, e.g. "Delete". */
  confirmLabel: string;
  /** The button that does not go ahead; "Cancel" by default. */
  cancelLabel?: string;
  /** Styles the confirming button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before something that cannot be undone. The app's own dialog, not the
 * browser's `confirm()`, which the desktop and mobile web views do not all
 * show. Cancel has the focus, so Enter does not destroy anything by accident;
 * Escape and a click outside cancel. Focus stays inside while it is open.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = t("app.cancel"),
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Tab") {
      // Two buttons: Tab and Shift+Tab move between them.
      event.preventDefault();
      (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="dialog"
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={messageId} className="dialog-message">
          {message}
        </p>
        <div className="actions dialog-actions">
          <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? "button button-danger" : "button button-primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
