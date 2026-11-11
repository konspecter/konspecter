import { useState } from "react";
import { FolderError } from "../../infrastructure/desktop/desktop";
import { folderLabel, type LibraryControls, type LibraryFolder } from "../app/library";
import { isMac } from "../app/shortcuts";
import { useErrorMessage } from "../hooks/use-error-message";
import { useLibraryFolders } from "../hooks/use-library-folders";
import { t, tn } from "../i18n/i18n";
import { rich } from "../i18n/rich";
import { AliasDialog } from "./AliasDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ReformatDialog } from "./ReformatPrompt";

/** "Show in Finder", "Show in Explorer" or "Show in Files", for the system it runs on. */
export function revealFolderLabel(): string {
  if (isMac()) return t("library.reveal.mac");
  return /win/i.test(navigator.platform) ? t("library.reveal.windows") : t("library.reveal.other");
}

/** What adding a folder failed with, in words; null for anything but a refused folder. */
export function addFolderRefusal(error: unknown): string | null {
  if (!(error instanceof FolderError)) return null;
  if (error.code === "folder_connected") return t("library.connected");
  if (error.code === "folder_overlaps") return t("library.overlaps");
  return null;
}

/**
 * A button that adds a folder (the system picker), and what went wrong
 * below it: a folder refused is said as it is, anything else as an error.
 */
export function AddFolderButton({
  library,
  label,
  primary = false,
}: {
  library: LibraryControls;
  label: string;
  primary?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);
  return (
    <>
      <button
        type="button"
        className={primary ? "button button-primary" : "button"}
        disabled={adding}
        onClick={() => {
          setAdding(true);
          setRefusal(null);
          setFailure(null);
          library.add().then(
            () => {
              setAdding(false);
            },
            (error: unknown) => {
              setAdding(false);
              const refused = addFolderRefusal(error);
              if (refused === null) setFailure(error);
              else setRefusal(refused);
            },
          );
        }}
      >
        {label}
      </button>
      {(refusal ?? failureText) !== null && (
        <p role="alert" className="inline-error">
          {refusal ?? failureText}
        </p>
      )}
    </>
  );
}

/** The date a folder was added, as people read it. */
function addedDate(folder: LibraryFolder): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(folder.addedMs);
}

/**
 * Settings → Library on the desktop: the connected folders in a table, each
 * shown in the file manager, named or removed (which only disconnects it),
 * and a folder added or the folders reformatted below.
 */
export function LibraryFolders({ library }: { library: LibraryControls }) {
  const folders = useLibraryFolders(library);
  const [busy, setBusy] = useState(false);
  /** How many files the reformat question is about, while it is asked. */
  const [asking, setAsking] = useState<number | null>(null);
  const [removing, setRemoving] = useState<LibraryFolder | null>(null);
  const [naming, setNaming] = useState<LibraryFolder | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);
  const open = folders.filter((folder) => folder.available).map((folder) => folder.id);

  function run(action: () => Promise<string | null>) {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    action().then(
      (result) => {
        setMessage(result);
        setBusy(false);
      },
      (error: unknown) => {
        // A folder refused is no failure of the app: it is said as it is.
        const refusal = addFolderRefusal(error);
        if (refusal === null) setFailure(error);
        else setMessage(refusal);
        setBusy(false);
      },
    );
  }

  // Every folder at once.
  const reformat = library.reformat();

  return (
    <section className="setting-block" aria-labelledby="library-heading">
      <h3 id="library-heading" className="setting-heading">
        {t("settings.library")}
      </h3>
      {folders.length === 0 ? (
        <p className="setting-hint">{rich("settings.library.empty", { md: <code>.md</code> })}</p>
      ) : (
        <>
          <p className="setting-hint">{t("settings.library.folder")}</p>
          <div className="library-table-frame">
            <table className="library-table">
              <thead>
                <tr>
                  <th scope="col">{t("settings.library.path")}</th>
                  <th scope="col">{t("settings.library.added")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t("settings.library.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => (
                  <tr key={folder.id}>
                    <td className="library-path">
                      {folder.alias && <strong className="library-alias">{folder.alias}</strong>}
                      <span>{folder.path}</span>
                      {!folder.available && (
                        <span className="library-missing">{t("settings.library.unavailable")}</span>
                      )}
                    </td>
                    <td className="library-added">{addedDate(folder)}</td>
                    <td className="library-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={!folder.available}
                        aria-label={`${revealFolderLabel()}: ${folderLabel(folder)}`}
                        onClick={() => {
                          run(async () => {
                            await library.reveal(folder.id);
                            return null;
                          });
                        }}
                      >
                        {revealFolderLabel()}
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-label={`${t("settings.library.alias")} ${folderLabel(folder)}`}
                        onClick={() => {
                          setNaming(folder);
                        }}
                      >
                        {t("settings.library.alias")}
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        aria-label={`${t("settings.library.remove")} ${folderLabel(folder)}`}
                        onClick={() => {
                          setRemoving(folder);
                        }}
                      >
                        {t("settings.library.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="setting-hint">{t("settings.library.folderSync")}</p>
          <p className="setting-hint">{t("settings.library.folders")}</p>
        </>
      )}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            run(async () => {
              await library.add();
              return null;
            });
          }}
        >
          {t("settings.library.add")}
        </button>
        {open.length > 0 && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              run(async () => {
                const { length: count } = await reformat.misplaced();
                if (count === 0) return t("settings.library.nothingToReformat");
                setAsking(count);
                return null;
              });
            }}
          >
            {t("settings.library.reformat")}
          </button>
        )}
      </div>
      {asking !== null && (
        <ReformatDialog
          count={asking}
          onAnswer={(yes) => {
            setAsking(null);
            if (yes) run(async () => tn("settings.library.reformatted", await reformat.apply()));
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t("settings.library.removeTitle", { folder: folderLabel(removing) })}
          message={t("settings.library.removeMessage", { path: removing.path })}
          confirmLabel={t("settings.library.remove")}
          onConfirm={() => {
            const { id } = removing;
            setRemoving(null);
            run(async () => {
              await library.remove(id);
              return null;
            });
          }}
          onCancel={() => {
            setRemoving(null);
          }}
        />
      )}
      {naming && (
        <AliasDialog
          folder={naming}
          onSave={async (alias) => {
            await library.setAlias(naming.id, alias);
            setNaming(null);
          }}
          onCancel={() => {
            setNaming(null);
          }}
        />
      )}
      {message && (
        <p role="status" className="setting-hint">
          {message}
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
