// First: sets the interface language before any other module runs.
import { applyLanguage, t } from "./presentation/i18n/setup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import type { NoteRepository } from "./application/notes/note-repository";
import {
  closeFolder,
  currentFolder,
  folderBridge,
  isDesktop,
  keychainCredentials,
  onWindowClose,
  pickFolder,
} from "./infrastructure/desktop/desktop";
import { FolderStore } from "./infrastructure/folder/folder-store";
import { FolderSync } from "./infrastructure/folder/folder-sync";
import { isNativeMobile } from "./infrastructure/mobile/mobile";
import { openNoteStore } from "./infrastructure/storage/note-store";
import { SyncEngine } from "./infrastructure/sync/sync-engine";
import { App } from "./presentation/app/App";
import { flushBeforeClosing } from "./presentation/app/closing";
import { factoryReset, type FactoryReset } from "./presentation/app/factory-reset";
import { reportError } from "./presentation/app/errors";
import { restoreLocation } from "./presentation/app/last-location";
import type { LibraryControls } from "./presentation/app/library";
import type { UpdateSource } from "./presentation/app/updates";
import { isMac } from "./presentation/app/shortcuts";
import { ErrorState } from "./presentation/components/ErrorState";
import "@konspecter/ui/fonts.css";
import "@konspecter/ui/tokens.css";
import "@konspecter/ui/base.css";
import "@konspecter/ui/controls.css";
import "./presentation/app/app.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root is missing from index.html");
}
const root = createRoot(rootElement);

// On macOS the desktop window draws its content under the title bar
// (tauri.conf.json); the window buttons then sit in the sidebar's top bar.
if (isDesktop() && isMac()) document.documentElement.dataset.titlebar = "overlay";

// The service worker precaches the app so it works offline, and reports when
// a new version is waiting.
// The desktop and mobile apps ship their files inside the app: no service worker.
let updateWaiting = false;
let onUpdate: (() => void) | null = null;
const updateServiceWorker =
  isDesktop() || isNativeMobile()
    ? () => Promise.resolve()
    : registerSW({
        onNeedRefresh() {
          updateWaiting = true;
          onUpdate?.();
        },
      });
const updates: UpdateSource = {
  subscribe(listener) {
    onUpdate = listener;
    if (updateWaiting) listener();
    return () => {
      onUpdate = null;
    };
  },
  apply() {
    void updateServiceWorker(true);
  },
};

try {
  const store = await openNoteStore();
  const settings = await store.loadSettings();
  applyLanguage(settings.language);

  // On the desktop the library is a folder of Markdown files, ~/Konspecter
  // unless another was chosen (ADR-024); elsewhere it is the app library (IndexedDB).
  const folder = isDesktop() ? await currentFolder() : null;
  const folderStore = folder
    ? new FolderStore(folderBridge, store, { followTitles: settings.fileNames === "title" })
    : null;
  const repository: NoteRepository = folderStore ?? store;
  // Sync covers the folder: links tie its files to the synced notes.
  const folderSync =
    folderStore && folder ? await FolderSync.open(folderStore, store, folder) : null;
  // Notes from before the desktop kept everything in the folder move into it, once.
  await folderSync?.moveLibrary().catch(reportError);
  // Follow changes other programs make to the files.
  void folderStore?.watch();
  const library: LibraryControls | undefined = isDesktop()
    ? {
        folder,
        async chooseFolder() {
          if (await pickFolder()) window.location.reload();
        },
        reformat: folderStore
          ? { misplaced: () => folderStore.misplaced(), apply: () => folderStore.reformat() }
          : undefined,
        ignore: folderStore
          ? { read: () => folderStore.ignoreText(), save: (text) => folderStore.setIgnore(text) }
          : undefined,
      }
    : undefined;

  // Closing the desktop window waits for the open note's pending writes.
  if (isDesktop()) void onWindowClose(flushBeforeClosing);

  // Back to where the app was last time, before the router reads the address.
  await restoreLocation(async (id) => (await repository.get(id)) !== undefined);

  // Sync runs in the background for the app library; the UI never waits for it.
  // On the desktop the access token lives in the OS keychain.
  const sync = new SyncEngine(
    folderSync ?? store,
    isDesktop() ? { credentials: keychainCredentials } : {},
  );
  void sync.start();
  // Clears what the app keeps, never the folder's files.
  const reset: FactoryReset = {
    appNotes: async () => (await store.list()).length,
    async run() {
      await factoryReset({
        sync,
        closeFolder: folder ? closeFolder : undefined,
        store,
        storage: localStorage,
      });
      window.location.replace("/");
    },
  };
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App
          store={repository}
          initialSettings={settings}
          saveSettings={(next) => {
            folderStore?.followTitles(next.fileNames === "title");
            return store.saveSettings(next);
          }}
          library={library}
          updates={updates}
          sync={sync}
          reset={reset}
        />
      </BrowserRouter>
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <StrictMode>
      <main className="content">
        <ErrorState title={t("app.storageFailed")} error={error} />
      </main>
    </StrictMode>,
  );
}
