import { ChevronIcon } from "@konspecter/ui/icons";
import { useCallback, useId, useState, type ReactNode } from "react";
import { DEFAULT_IGNORE, IGNORE_FILE } from "../../domain/note/ignore";
import { folderLabel, type FolderIgnore, type LibraryControls } from "../app/library";
import { useLibraryFolders } from "../hooks/use-library-folders";
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
  /** With several folders: which folder's rules these are. */
  folderPicker?: ReactNode;
};

/**
 * The `.konspecterignore` rules, edited as text: Save stores them (the app's
 * settings, or the folder's file), Restore default puts the default back in
 * the box to be saved.
 */
export function IgnoreSettings({ saved, onSave, inFolder, folderPicker }: IgnoreSettingsProps) {
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
      {folderPicker}
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
export function FolderIgnoreSettings({
  ignore,
  folderPicker,
}: {
  ignore: FolderIgnore;
  folderPicker?: ReactNode;
}) {
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
      folderPicker={folderPicker}
      onSave={async (text) => {
        await ignore.save(text);
        setSaved(text);
      }}
    />
  );
}

/** The desktop: the rules of one open folder, chosen from a list when there are several. */
export function LibraryIgnoreSettings({ library }: { library: LibraryControls }) {
  const id = useId();
  const folders = useLibraryFolders(library).filter((folder) => folder.available);
  const [chosen, setChosen] = useState<string | null>(null);
  const folder = folders.find((f) => f.id === chosen) ?? folders[0];
  if (!folder) return null;
  const picker =
    folders.length > 1 ? (
      <div className="ignore-folder">
        <label htmlFor={id} className="setting-label ignore-label">
          {t("ignore.whichFolder")}
        </label>
        <span className="select">
          <select
            id={id}
            value={folder.id}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderLabel(f)}
              </option>
            ))}
          </select>
          <ChevronIcon />
        </span>
      </div>
    ) : null;
  return (
    <OneFolderIgnore key={folder.id} library={library} folder={folder.id} folderPicker={picker} />
  );
}

/** One folder's rules; a new folder is a new component (`key`), with its own rules. */
function OneFolderIgnore({
  library,
  folder,
  folderPicker,
}: {
  library: LibraryControls;
  folder: string;
  folderPicker: ReactNode;
}) {
  const [ignore] = useState(() => library.ignore(folder));
  return <FolderIgnoreSettings ignore={ignore} folderPicker={folderPicker} />;
}
