import { useCallback, useId, useState } from "react";
import type { ReadingPositionMode } from "../../domain/reading/reading";
import {
  FONT_SCALES,
  type EditorMode,
  type Settings,
  type Theme,
} from "../../domain/settings/settings";
import {
  persistenceStatus,
  requestPersistence,
  type PersistenceStatus,
} from "../../infrastructure/storage/persistence";
import { appInfo, isDesktop } from "../../infrastructure/desktop/desktop";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import { errorMessage } from "../components/ErrorState";
import { SyncSettings } from "../components/SyncSettings";
import { ImportExport } from "../components/ImportExport";
import { BackupRecovery } from "../components/BackupRecovery";
import { ShortcutList } from "../components/ShortcutsDialog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { LibraryControls } from "../app/library";
import { useAsync } from "../hooks/use-async";

type SettingsPageProps = {
  settings: Settings;
  onChange: (settings: Settings) => Promise<void>;
  sync?: SyncEngine | undefined;
  library?: LibraryControls | undefined;
  /** Where imports go and exports come from; hidden when absent. */
  store?: NoteRepository | undefined;
};

type Option<T> = { readonly value: T; readonly label: string };

const THEMES: readonly Option<Theme>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const EDITORS: readonly Option<EditorMode>[] = [
  { value: "text", label: "Text" },
  { value: "markdown", label: "Markdown" },
];
const FONT_LABELS: Record<number, string> = {
  0.9: "Small",
  1: "Default",
  1.15: "Large",
  1.3: "Larger",
};
const SCALES: readonly Option<number>[] = FONT_SCALES.map((value) => ({
  value,
  label: FONT_LABELS[value] ?? String(value),
}));
const READING: readonly Option<ReadingPositionMode>[] = [
  { value: "restore", label: "Continue where I left off" },
  { value: "ask", label: "Ask before jumping" },
  { value: "off", label: "Always start at the top" },
];

/** Changes apply and are saved immediately. */
export function SettingsPage({ settings, onChange, sync, library, store }: SettingsPageProps) {
  const [saveError, setSaveError] = useState<unknown>(null);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaveError(null);
    onChange({ ...settings, [key]: value }).catch((error: unknown) => {
      setSaveError(error);
    });
  }

  return (
    <>
      <title>Settings · Konspecter</title>
      <h1 className="page-title">Settings</h1>
      <form
        className="settings"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Choice
          legend="Theme"
          options={THEMES}
          value={settings.theme}
          onChange={(value) => {
            update("theme", value);
          }}
        />
        <Choice
          legend="Default editor"
          hint="Notes the text editor cannot represent always open in Markdown."
          options={EDITORS}
          value={settings.defaultEditor}
          onChange={(value) => {
            update("defaultEditor", value);
          }}
        />
        <Choice
          legend="Text size"
          options={SCALES}
          value={settings.fontScale}
          onChange={(value) => {
            update("fontScale", value);
          }}
        />
        <Choice
          legend="Reading position"
          options={READING}
          value={settings.readingPosition}
          onChange={(value) => {
            update("readingPosition", value);
          }}
        />
      </form>
      {isDesktop() ? <DesktopAbout /> : <OfflineStorage />}
      {library && <LibrarySettings library={library} />}
      {store && library?.folder == null && <ImportExport store={store} />}
      {store && library?.folder == null && <BackupRecovery store={store} />}
      {sync && library?.folder == null && <SyncSettings sync={sync} />}
      <section className="setting offline-storage" aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="setting-heading">
          Keyboard shortcuts
        </h2>
        <ShortcutList />
      </section>
      {saveError !== null && (
        <p role="alert" className="inline-error">
          Could not save settings: {errorMessage(saveError)}. They apply until you reload.
        </p>
      )}
    </>
  );
}

type ChoiceProps<T> = {
  legend: string;
  hint?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

function Choice<T extends string | number>({
  legend,
  hint,
  options,
  value,
  onChange,
}: ChoiceProps<T>) {
  const name = useId();
  return (
    <fieldset className="setting">
      <legend>{legend}</legend>
      {hint && <p className="setting-hint">{hint}</p>}
      <div className="setting-options">
        {options.map((option) => (
          <label key={String(option.value)}>
            <input
              type="radio"
              name={name}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const STATUS_TEXT: Record<PersistenceStatus, string> = {
  persistent: "Your notes are stored persistently on this device and work offline.",
  "best-effort":
    "Your notes work offline, but the browser may clear them if the device runs low on space.",
  unsupported: "This browser does not report whether it may clear stored notes.",
};

function OfflineStorage() {
  const load = useCallback(() => persistenceStatus(), []);
  const initial = useAsync(load);
  const [requested, setRequested] = useState<PersistenceStatus | null>(null);
  const status = requested ?? (initial.status === "success" ? initial.value : null);

  return (
    <section className="setting offline-storage" aria-labelledby="offline-storage">
      <h2 id="offline-storage" className="setting-heading">
        Offline storage
      </h2>
      {status && <p className="setting-hint">{STATUS_TEXT[status]}</p>}
      {status === "best-effort" && (
        <button
          type="button"
          className="button"
          onClick={() => {
            void requestPersistence().then(setRequested);
          }}
        >
          Keep my notes on this device
        </button>
      )}
    </section>
  );
}

function DesktopAbout() {
  const load = useCallback(() => appInfo(), []);
  const info = useAsync(load);
  return (
    <section className="setting offline-storage" aria-labelledby="about-desktop">
      <h2 id="about-desktop" className="setting-heading">
        About
      </h2>
      {info.status !== "loading" && (
        <p className="setting-hint">
          {info.status === "success"
            ? `${info.value.name} ${info.value.version} for ${info.value.os}. Notes are stored in the app's local database.`
            : "Desktop details are unavailable."}
        </p>
      )}
    </section>
  );
}

function LibrarySettings({ library }: { library: LibraryControls }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

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
        setFailure(error);
        setBusy(false);
      },
    );
  }

  return (
    <section className="setting offline-storage" aria-labelledby="library-heading">
      <h2 id="library-heading" className="setting-heading">
        Library
      </h2>
      {library.folder === null ? (
        <>
          <p className="setting-hint">
            Notes are kept in the app's own library, which can sync with a server. You can instead
            work directly on a folder of <code>.md</code> files.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              run(async () => {
                await library.chooseFolder();
                return null;
              });
            }}
          >
            Open a Markdown folder…
          </button>
        </>
      ) : (
        <>
          <p className="setting-hint">
            Working on the Markdown files in <strong>{library.folder}</strong>. Changes are saved to
            the files; deleted notes go to the system trash.
          </p>
          <p className="setting-hint">
            Sync applies to the app library, which keeps syncing in the background. To have this
            folder on other devices, sync it with Git, iCloud Drive, Dropbox or Syncthing:
            Konspecter follows their changes, and edits made in two places at once are kept as
            conflict copies.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  const { imported: count } = await library.importFolder();
                  return count === 0
                    ? "Nothing to import: the library already has these notes."
                    : `Imported ${String(count)} ${count === 1 ? "note" : "notes"} into the app library.`;
                });
              }}
            >
              Import into the app library
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  await library.closeFolder();
                  return null;
                });
              }}
            >
              Use the app library
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="setting-hint">
          {message}
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="inline-error">
          {errorMessage(failure)}
        </p>
      )}
    </section>
  );
}
