import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FolderIcon } from "@konspecter/ui/icons";
import { folderLabel, type LibraryFolder } from "../app/library";
import { t } from "../i18n/i18n";

/**
 * Asks which folder a new conspect goes into (the "ask each time" setting,
 * with several folders). The open conspect's folder, if any, has the focus,
 * so Enter keeps to it; Escape and a click outside cancel.
 */
export function FolderChooser({
  folders,
  suggested,
  onChoose,
  onCancel,
}: {
  folders: readonly LibraryFolder[];
  suggested: string | null;
  onChoose: (folder: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("[data-folder]");
    const first = [...(buttons ?? [])].find((b) => b.dataset.folder === suggested) ?? buttons?.[0];
    first?.focus();
  }, [suggested]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Tab") return;
    // The choices and Cancel, in a ring.
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
    event.preventDefault();
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog folder-chooser"
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id={titleId}>{t("newNote.chooseTitle")}</h2>
        <ul className="folder-choices">
          {folders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                className="folder-choice"
                data-folder={folder.id}
                onClick={() => {
                  onChoose(folder.id);
                }}
              >
                <FolderIcon />
                <span className="folder-choice-name">{folderLabel(folder)}</span>
                <span className="folder-choice-path">{folder.path}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="actions dialog-actions">
          <button type="button" className="button" onClick={onCancel}>
            {t("app.cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
