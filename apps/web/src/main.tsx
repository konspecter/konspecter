// First: sets the interface language before any other module runs.
import { applyLanguage, t } from "./presentation/i18n/setup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import type { NoteRepository } from "./application/notes/note-repository";
import type { UpdateCheck } from "./domain/settings/settings";
import {
  addFolder,
  appInfo,
  folderBridge,
  isDesktop,
  keychainCredentials,
  libraryFolders,
  onWindowClose,
  openInBrowser,
  removeFolder,
  resetFolders,
  revealFolder,
  setFolderAlias,
} from "./infrastructure/desktop/desktop";
import { watchReleases } from "./infrastructure/desktop/releases";
import { FolderLibrary } from "./infrastructure/folder/folder-library";
import { FolderStore } from "./infrastructure/folder/folder-store";
import { FolderSync } from "./infrastructure/folder/folder-sync";
import { isNativeMobile, nativeBackButton } from "./infrastructure/mobile/mobile";
import { openNoteStore } from "./infrastructure/storage/note-store";
import { SyncEngine } from "./infrastructure/sync/sync-engine";
import { App } from "./presentation/app/App";
import { flushBeforeClosing } from "./presentation/app/closing";
import {
  factoryReset,
  sendWipeReceipt,
  takeWipedNotice,
  wipe,
  type FactoryReset,
} from "./presentation/app/factory-reset";
import { reportError } from "./presentation/app/errors";
import { moveLastLocation, restoreLocation } from "./presentation/app/last-location";
import type { LibraryControls } from "./presentation/app/library";
import type { CheckForRelease, Update, UpdateSource } from "./presentation/app/updates";
import { followKeyboard } from "./presentation/app/keyboard";
import { isMac } from "./presentation/app/shortcuts";
import { applyStyles, hideSplash, showStage } from "./presentation/app/splash";
import { ErrorState } from "./presentation/components/ErrorState";
import { stopFocusZoom } from "@konspecter/ui/viewport";
import "@konspecter/ui/fonts.css";
import "@konspecter/ui/tokens.css";
import "@konspecter/ui/base.css";
import "@konspecter/ui/controls.css";
import "./presentation/app/app.css";

showStage("scripts");
const styles = applyStyles();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root is missing from index.html");
}
const root = createRoot(rootElement);

// On macOS the desktop window draws its content under the title bar
// (tauri.conf.json); the window buttons then sit in the sidebar's top bar.
if (isDesktop() && isMac()) document.documentElement.dataset.titlebar = "overlay";
// iOS Safari would zoom in on every field and stay zoomed.
stopFocusZoom();
// The island stays above an on-screen keyboard that covers the page (iOS Safari).
followKeyboard();

// The service worker precaches the app so it works offline, and reports when
// a new version is waiting.
// The desktop and mobile apps ship their files inside the app: no service worker.
// The desktop app asks GitHub for a newer release instead, unless the setting
// says not to (off until the settings are read).
let updateCheck: UpdateCheck = "off";
let checkReleasesNow: CheckForRelease | null = null;
let updateWaiting: Update | null = null;
let onUpdate: ((update: Update) => void) | null = null;
const announceUpdate = (update: Update) => {
  updateWaiting = update;
  onUpdate?.(update);
};
let releasePage: string | null = null;
if (isDesktop()) {
  void appInfo()
    .then(({ version }) => {
      checkReleasesNow = watchReleases({
        current: version,
        enabled: () => updateCheck === "daily",
        onNewer(release) {
          releasePage = release.url;
          announceUpdate({ kind: "download", version: release.version });
        },
      });
    })
    .catch(reportError);
}
const updateServiceWorker =
  isDesktop() || isNativeMobile()
    ? () => Promise.resolve()
    : registerSW({
        onNeedRefresh() {
          announceUpdate({ kind: "reload" });
        },
      });
// Settings → New versions → Check now, whatever the setting says.
const checkForRelease: CheckForRelease | undefined = isDesktop()
  ? () => checkReleasesNow?.() ?? Promise.reject(new Error("The app's version is not known yet"))
  : undefined;
const updates: UpdateSource = {
  subscribe(listener) {
    onUpdate = listener;
    if (updateWaiting) listener(updateWaiting);
    return () => {
      onUpdate = null;
    };
  },
  apply() {
    if (releasePage) void openInBrowser(releasePage).catch(reportError);
    else void updateServiceWorker(true);
  },
};

try {
  const store = await openNoteStore();
  const settings = await store.loadSettings();
  applyLanguage(settings.language);
  showStage("storage");
  updateCheck = settings.updateCheck;

  // On the desktop the library is the connected folders of Markdown files,
  // ~/Konspecter at first (ADR-024, ADR-030); elsewhere it is the app library (IndexedDB).
  const folderLibrary = isDesktop()
    ? new FolderLibrary(
        (await libraryFolders()).map((folder) => ({
          folder,
          store: folder.available
            ? new FolderStore(folderBridge(folder.id), store, {
                followTitles: settings.fileNames === "title",
                readingPrefix: `file:${folder.id}/`,
              })
            : null,
        })),
        { setAlias: setFolderAlias },
      )
    : null;
  const repository: NoteRepository = folderLibrary ?? store;
  // Sync covers the folders: links tie their files to the synced notes.
  const folderSync = folderLibrary ? await FolderSync.open(folderLibrary, store) : null;
  // The one folder of an earlier version: its notes' ids gained the folder's.
  const upgradedTo = folderSync?.upgradedTo;
  if (upgradedTo) moveLastLocation((id) => `${upgradedTo}/${id}`);
  // Notes from before the desktop kept everything in a folder move into the first, once.
  await folderSync?.moveLibrary().catch(reportError);
  // Follow changes other programs make to the files.
  void folderLibrary?.watch();
  // Adding or removing a folder starts the app again on the new set of folders.
  // Pending saves are written first, while their folder is still connected.
  const library: LibraryControls | undefined = folderLibrary
    ? {
        folders: {
          subscribe: (listener) => folderLibrary.subscribeFolders(listener),
          getSnapshot: () => folderLibrary.folders(),
        },
        folderOf: (noteId) => folderLibrary.folderOf(noteId),
        tags: (folder) => folderLibrary.folderTags(folder),
        async add() {
          await flushBeforeClosing();
          if (await addFolder()) window.location.reload();
        },
        async remove(folder) {
          await flushBeforeClosing();
          await removeFolder(folder);
          window.location.reload();
        },
        setAlias: (folder, alias) => folderLibrary.setAlias(folder, alias),
        reveal: revealFolder,
        reformat: (folder) => ({
          misplaced: () => folderLibrary.misplaced(folder),
          apply: () => folderLibrary.reformat(folder),
        }),
        ignore: (folder) => ({
          read: () => folderLibrary.ignoreText(folder),
          save: (text) => folderLibrary.setIgnore(folder, text),
        }),
      }
    : undefined;

  // Closing the desktop window waits for the open note's pending writes.
  if (isDesktop()) void onWindowClose(flushBeforeClosing);

  // Back to where the app was last time, before the router reads the address.
  await restoreLocation(async (id) => (await repository.get(id)) !== undefined);
  showStage("library");

  // Sync runs in the background for the app library; the UI never waits for it.
  // On the desktop the access token lives in the OS keychain.
  // Disconnected on the site to be wiped, the device erases the notes it
  // holds (on the desktop, the files sync covers) and what the app keeps.
  // A wipe that fails is reported and tried again at the next start.
  const sync: SyncEngine = new SyncEngine(folderSync ?? store, {
    ...(isDesktop() ? { credentials: keychainCredentials } : {}),
    async onWiped(receipt) {
      await wipe({
        deleteFiles: folderSync ? () => folderSync.wipeFiles() : undefined,
        store,
        forgetFolders: folderLibrary ? resetFolders : undefined,
        sync,
        storage: localStorage,
        receipt,
        report: reportError,
      });
      window.location.replace("/");
    },
  });
  void sync.start();
  // The start that follows a wipe says so, once, and tells the server it is done.
  const wiped = takeWipedNotice(localStorage);
  void sendWipeReceipt(localStorage, (receipt) => sync.confirmWiped(receipt)).catch(reportError);
  // Clears what the app keeps, never the folder's files.
  const reset: FactoryReset = {
    appNotes: async () => (await store.list()).length,
    async run() {
      await factoryReset({
        sync,
        forgetFolders: folderLibrary ? resetFolders : undefined,
        store,
        storage: localStorage,
      });
      window.location.replace("/");
    },
  };
  await styles;
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App
          store={repository}
          initialSettings={settings}
          saveSettings={(next) => {
            folderLibrary?.followTitles(next.fileNames === "title");
            const turnedOn = updateCheck === "off" && next.updateCheck === "daily";
            updateCheck = next.updateCheck;
            if (turnedOn) checkReleasesNow?.().catch(() => undefined);
            return store.saveSettings(next);
          }}
          library={library}
          updates={updates}
          checkForRelease={checkForRelease}
          sync={sync}
          reset={reset}
          wiped={wiped}
          desktop={isDesktop()}
          backButton={isNativeMobile() ? nativeBackButton : undefined}
        />
      </BrowserRouter>
    </StrictMode>,
  );
} catch (error) {
  await styles;
  root.render(
    <StrictMode>
      <main className="content">
        <ErrorState title={t("app.storageFailed")} error={error} />
      </main>
    </StrictMode>,
  );
}
// React commits the render while the bookmark fills the rest and the splash fades.
hideSplash();
