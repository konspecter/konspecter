import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import {
  DEFAULT_SETTINGS,
  type EditorMode,
  type Settings,
  type Theme,
} from "../../domain/settings/settings";
import { NoteCatalog } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import { Layout } from "../components/Layout";
import { ReformatPrompt } from "../components/ReformatPrompt";
import { preloadEditor } from "../editors/LazyNoteEditor";
import { preloadReader } from "../markdown/LazyMarkdownView";
import { NotFoundPage } from "../pages/NotFoundPage";
import { NotePage } from "../pages/NotePage";
import { NotesPage } from "../pages/NotesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { applyLanguage } from "../i18n/setup";
import { Activity } from "./activity";
import type { FactoryReset } from "./factory-reset";
import type { LibraryControls } from "./library";
import type { UpdateSource } from "./updates";

type AppProps = {
  store: NoteRepository;
  initialSettings?: Settings;
  /** Persists settings; without it, changes last for the session. */
  saveSettings?: (settings: Settings) => Promise<void>;
  /** Desktop File Mode controls for Settings; absent in the browser. */
  library?: LibraryControls | undefined;
  /** Service worker updates; absent in tests and development. */
  updates?: UpdateSource;
  /** Background sync with a server; absent when not wired up (tests). */
  sync?: SyncEngine | undefined;
  /** Reset to factory settings in Settings; absent in tests. */
  reset?: FactoryReset | undefined;
};

/** Runs `task` once the browser has nothing more urgent to do. */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 2000 });
    return () => {
      cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(task, 200);
  return () => {
    clearTimeout(handle);
  };
}

export function App({
  store,
  initialSettings = DEFAULT_SETTINGS,
  saveSettings: persistSettings,
  library,
  updates,
  sync,
  reset,
}: AppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [catalog] = useState(() => new NoteCatalog(store));
  const [activity] = useState(() => new Activity());

  // Theme and font scale apply to the whole document, outside React's tree.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--font-scale", String(settings.fontScale));
    root.dataset.editingArea = settings.editingArea;
  }, [settings.theme, settings.fontScale, settings.editingArea]);

  useEffect(() => catalog.start(), [catalog]);

  // Nothing waits for these; they only make the first note (rich text or
  // rendered) and the first search immediate.
  useEffect(
    () =>
      whenIdle(() => {
        preloadEditor()
          .then(preloadReader)
          .catch(() => undefined);
        store.search({ words: [], tags: [] }).catch(() => undefined);
      }),
    [store],
  );

  const saveSettings = useCallback(
    async (next: Settings) => {
      // Before the re-render, so that it is in the new language.
      if (next.language !== settings.language) applyLanguage(next.language);
      setSettings(next);
      await persistSettings?.(next);
    },
    [persistSettings, settings.language],
  );
  // The top bar's toggles change settings too; a failed save keeps the change
  // for the session (Settings reports such failures).
  const setTheme = useCallback(
    (theme: Theme) => {
      saveSettings({ ...settings, theme }).catch(() => undefined);
    },
    [saveSettings, settings],
  );
  const setMode = useCallback(
    (defaultEditor: EditorMode) => {
      saveSettings({ ...settings, defaultEditor }).catch(() => undefined);
    },
    [saveSettings, settings],
  );

  const notePage = (
    <NotePage
      store={store}
      mode={settings.defaultEditor}
      activity={activity}
      readingPosition={settings.readingPosition}
    />
  );
  // A new language renders everything again: labels are looked up when
  // rendering, and memoized parts would otherwise keep the old ones.
  return (
    <>
      {library?.folder != null && library.reformat && (
        <ReformatPrompt folder={library.folder} reformat={library.reformat} />
      )}
      <Routes key={settings.language}>
        <Route
          element={
            <Layout
              store={store}
              catalog={catalog}
              activity={activity}
              theme={settings.theme}
              onThemeChange={setTheme}
              mode={settings.defaultEditor}
              onModeChange={setMode}
              tagNames={settings.tagNames}
              updates={updates}
              sync={sync}
            />
          }
        >
          <Route index element={<NotesPage store={store} catalog={catalog} />} />
          {/* The same element for both, so a new note keeps its editor once saved. */}
          <Route path="conspects/new" element={notePage} />
          <Route path="conspects/:id" element={notePage} />
          <Route path="notes/*" element={<OldNotePath />} />
          <Route
            path="settings"
            element={
              <SettingsPage
                settings={settings}
                onChange={saveSettings}
                sync={sync}
                library={library}
                store={store}
                reset={reset}
              />
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

/** A link from before conspects had their own paths: /notes/… is now /conspects/…. */
function OldNotePath() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={pathname.replace(/^\/notes\//, "/conspects/") + search + hash} replace />;
}
