import { useCallback, useId, useState } from "react";
import type { ReadingPositionMode } from "../../domain/reading/reading";
import {
  FONT_SCALES,
  type EditingArea,
  type EditorMode,
  type Settings,
  type TagNames,
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
import { t, tn, type TextKey } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type SettingsPageProps = {
  settings: Settings;
  onChange: (settings: Settings) => Promise<void>;
  sync?: SyncEngine | undefined;
  library?: LibraryControls | undefined;
  /** Where imports go and exports come from; hidden when absent. */
  store?: NoteRepository | undefined;
};

type Option<T> = { readonly value: T; readonly label: string };

const FONT_LABELS: Record<number, TextKey> = {
  0.9: "settings.textSize.small",
  1: "settings.textSize.default",
  1.15: "settings.textSize.large",
  1.3: "settings.textSize.larger",
};

/** The choices, in the interface language (built when rendered). */
function options() {
  return {
    themes: [
      { value: "system", label: t("settings.theme.system") },
      { value: "light", label: t("settings.theme.light") },
      { value: "dark", label: t("settings.theme.dark") },
    ] satisfies Option<Theme>[],
    editors: [
      { value: "text", label: t("settings.editor.text") },
      { value: "markdown", label: t("settings.editor.markdown") },
    ] satisfies Option<EditorMode>[],
    scales: FONT_SCALES.map((value) => {
      const key = FONT_LABELS[value];
      return { value, label: key ? t(key) : String(value) };
    }) satisfies Option<number>[],
    tagNames: [
      { value: "capitalized", label: t("settings.tagNames.capitalized") },
      { value: "as-written", label: t("settings.tagNames.asWritten") },
    ] satisfies Option<TagNames>[],
    editingAreas: [
      { value: "highlighted", label: t("settings.editingArea.highlighted") },
      { value: "plain", label: t("settings.editingArea.plain") },
    ] satisfies Option<EditingArea>[],
    reading: [
      { value: "restore", label: t("settings.reading.restore") },
      { value: "ask", label: t("settings.reading.ask") },
      { value: "off", label: t("settings.reading.off") },
    ] satisfies Option<ReadingPositionMode>[],
  };
}

/** Changes apply and are saved immediately. */
export function SettingsPage({ settings, onChange, sync, library, store }: SettingsPageProps) {
  const [saveError, setSaveError] = useState<unknown>(null);
  const choices = options();

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSaveError(null);
    onChange({ ...settings, [key]: value }).catch((error: unknown) => {
      setSaveError(error);
    });
  }

  return (
    <>
      <title>{t("app.title", { title: t("settings.title") })}</title>
      <h1 className="page-title">{t("settings.title")}</h1>
      <form
        className="settings"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Choice
          legend={t("settings.theme")}
          options={choices.themes}
          value={settings.theme}
          onChange={(value) => {
            update("theme", value);
          }}
        />
        <Choice
          legend={t("settings.editor")}
          hint={t("settings.editor.hint")}
          options={choices.editors}
          value={settings.defaultEditor}
          onChange={(value) => {
            update("defaultEditor", value);
          }}
        />
        <Choice
          legend={t("settings.editingArea")}
          hint={t("settings.editingArea.hint")}
          options={choices.editingAreas}
          value={settings.editingArea}
          onChange={(value) => {
            update("editingArea", value);
          }}
        />
        <Choice
          legend={t("settings.textSize")}
          options={choices.scales}
          value={settings.fontScale}
          onChange={(value) => {
            update("fontScale", value);
          }}
        />
        <Choice
          legend={t("settings.tagNames")}
          hint={t("settings.tagNames.hint")}
          options={choices.tagNames}
          value={settings.tagNames}
          onChange={(value) => {
            update("tagNames", value);
          }}
        />
        <Choice
          legend={t("settings.reading")}
          options={choices.reading}
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
          {t("settings.shortcuts")}
        </h2>
        <ShortcutList />
      </section>
      {saveError !== null && (
        <p role="alert" className="inline-error">
          {t("settings.saveFailed", { error: errorMessage(saveError) })}
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

const STATUS_TEXT: Record<PersistenceStatus, TextKey> = {
  persistent: "settings.storage.persistent",
  "best-effort": "settings.storage.bestEffort",
  unsupported: "settings.storage.unsupported",
};

function OfflineStorage() {
  const load = useCallback(() => persistenceStatus(), []);
  const initial = useAsync(load);
  const [requested, setRequested] = useState<PersistenceStatus | null>(null);
  const status = requested ?? (initial.status === "success" ? initial.value : null);

  return (
    <section className="setting offline-storage" aria-labelledby="offline-storage">
      <h2 id="offline-storage" className="setting-heading">
        {t("settings.storage")}
      </h2>
      {status && <p className="setting-hint">{t(STATUS_TEXT[status])}</p>}
      {status === "best-effort" && (
        <button
          type="button"
          className="button"
          onClick={() => {
            void requestPersistence().then(setRequested);
          }}
        >
          {t("settings.storage.keep")}
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
        {t("settings.about")}
      </h2>
      {info.status !== "loading" && (
        <p className="setting-hint">
          {info.status === "success"
            ? t("settings.about.text", {
                name: info.value.name,
                version: info.value.version,
                os: info.value.os,
              })
            : t("settings.about.unavailable")}
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
        {t("settings.library")}
      </h2>
      {library.folder === null ? (
        <>
          <p className="setting-hint">{rich("settings.library.app", { md: <code>.md</code> })}</p>
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
            {t("settings.library.open")}
          </button>
        </>
      ) : (
        <>
          <p className="setting-hint">
            {rich("settings.library.folder", { folder: <strong>{library.folder}</strong> })}
          </p>
          <p className="setting-hint">{t("settings.library.folderSync")}</p>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                run(async () => {
                  const { imported: count } = await library.importFolder();
                  return count === 0
                    ? t("settings.library.nothingToImport")
                    : tn("settings.library.imported", count);
                });
              }}
            >
              {t("settings.library.import")}
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
              {t("settings.library.useApp")}
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
