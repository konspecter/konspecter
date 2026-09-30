// First: sets the interface language before any other module runs.
import { applyLanguage, t } from "./presentation/i18n/setup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import { importFolder } from "./application/library/import-folder";
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
import { isNativeMobile } from "./infrastructure/mobile/mobile";
import { openNoteStore } from "./infrastructure/storage/note-store";
import { SyncEngine } from "./infrastructure/sync/sync-engine";
import { App } from "./presentation/app/App";
import { flushBeforeClosing } from "./presentation/app/closing";
import { restoreLocation } from "./presentation/app/last-location";
import type { LibraryControls } from "./presentation/app/library";
import type { UpdateSource } from "./presentation/app/updates";
import { isMac } from "./presentation/app/shortcuts";
import { ErrorState } from "./presentation/components/ErrorState";
import "./presentation/app/fonts.css";
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

  // On the desktop the library can be a folder of Markdown files (File Mode),
  // a separate backend; the app library (IndexedDB, synced) is the default.
  const folder = isDesktop() ? await currentFolder() : null;
  const folderStore = folder
    ? new FolderStore(folderBridge, store, { followTitles: settings.fileNames === "title" })
    : null;
  const repository: NoteRepository = folderStore ?? store;
  // Follow changes other programs make to the files.
  void folderStore?.watch();
  const library: LibraryControls | undefined = isDesktop()
    ? {
        folder,
        async chooseFolder() {
          if (await pickFolder()) window.location.reload();
        },
        async closeFolder() {
          await closeFolder();
          window.location.reload();
        },
        importFolder: () => importFolder(folderBridge, store),
      }
    : undefined;

  // Closing the desktop window waits for the open note's pending writes.
  if (isDesktop()) void onWindowClose(flushBeforeClosing);

  // Back to where the app was last time, before the router reads the address.
  await restoreLocation(async (id) => (await repository.get(id)) !== undefined);

  // Sync runs in the background for the app library; the UI never waits for it.
  // On the desktop the access token lives in the OS keychain.
  const sync = new SyncEngine(store, isDesktop() ? { credentials: keychainCredentials } : {});
  void sync.start();
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
          sync={folder ? undefined : sync}
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
