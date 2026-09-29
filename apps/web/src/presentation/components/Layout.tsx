import { useCallback, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { parseQuery } from "../../domain/search/query";
import type { EditorMode, Theme } from "../../domain/settings/settings";
import type { NoteCatalog } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import type { Activity } from "../app/activity";
import { SHORTCUTS } from "../app/shortcuts";
import type { UpdateSource } from "../app/updates";
import { useShortcuts } from "../hooks/use-shortcuts";
import { Antenna } from "./Antenna";
import { NewNoteIcon, SidebarIcon } from "./icons";
import { SearchBox } from "./SearchBox";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar, withShortcut } from "./Sidebar";
import { SyncIndicator } from "./SyncIndicator";
import { ModeToggle, ThemeToggle, useDarkTheme } from "./TopBarControls";
import { UpdateBanner } from "./UpdateBanner";

type LayoutProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  activity: Activity;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  updates?: UpdateSource | undefined;
  sync?: SyncEngine | undefined;
};

const NARROW = "(max-width: 760px)";
const SIDEBAR_KEY = "konspecter.sidebar";

function isNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

/** Narrow screens start with the sidebar closed; wide ones remember the choice. */
function initialSidebarOpen(): boolean {
  if (isNarrow()) return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

function rememberSidebar(open: boolean): void {
  if (isNarrow()) return;
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
  } catch {
    // A per-device convenience; without storage the sidebar simply opens.
  }
}

/**
 * The whole window: the sidebar on the left, and on the right a top bar
 * (search, theme, editor mode, activity) over the page content.
 */
export function Layout({
  store,
  catalog,
  activity,
  theme,
  onThemeChange,
  mode,
  onModeChange,
  updates,
  sync,
}: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const noteMatch = useMatch("/notes/:id");
  const matchedId = noteMatch?.params.id;
  const currentNoteId = matchedId === undefined || matchedId === "new" ? null : matchedId;
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const barToggleRef = useRef<HTMLButtonElement>(null);
  const dark = useDarkTheme(theme);

  const query = location.pathname === "/" ? (searchParams.get("q") ?? "") : "";
  const activeTag = useMemo(() => {
    const parsed = parseQuery(query);
    return parsed.words.length === 0 && parsed.tags.length === 1
      ? (parsed.tags[0]?.name ?? null)
      : null;
  }, [query]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      rememberSidebar(!open);
      return !open;
    });
    // The button just used disappears; keep the focus on its counterpart.
    requestAnimationFrame(() => {
      (sidebarToggleRef.current?.offsetParent
        ? sidebarToggleRef.current
        : barToggleRef.current
      )?.focus();
    });
  }, []);
  const closeSidebarOnNarrow = useCallback(() => {
    if (isNarrow()) setSidebarOpen(false);
  }, []);
  const closeShortcuts = useCallback(() => {
    setShowShortcuts(false);
  }, []);

  const openSearch = () => {
    if (location.pathname !== "/") void navigate("/");
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const newNote = () => void navigate("/notes/new");
  useShortcuts({
    search: openSearch,
    quickSearch: openSearch,
    newNote,
    quickNewNote: newNote,
    settings: () => void navigate("/settings"),
    help: () => {
      setShowShortcuts(true);
    },
  });

  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <Sidebar
        store={store}
        catalog={catalog}
        open={sidebarOpen}
        currentNoteId={currentNoteId}
        activeTag={activeTag}
        onToggle={toggleSidebar}
        onNavigate={closeSidebarOnNarrow}
        toggleRef={sidebarToggleRef}
      />
      {sidebarOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={closeSidebarOnNarrow} />
      )}
      <div className="main">
        <header className="topbar" data-tauri-drag-region="">
          <div className="topbar-start" data-tauri-drag-region="">
            {!sidebarOpen && (
              <>
                <button
                  ref={barToggleRef}
                  type="button"
                  className="icon-button"
                  aria-label="Show sidebar"
                  aria-expanded="false"
                  aria-controls="sidebar"
                  title="Show sidebar"
                  onClick={toggleSidebar}
                >
                  <SidebarIcon />
                </button>
                <Link
                  to="/notes/new"
                  className="icon-button topbar-new"
                  aria-label="New note"
                  title={withShortcut("New note", SHORTCUTS.newNote.keys)}
                >
                  <NewNoteIcon />
                </Link>
              </>
            )}
          </div>
          <SearchBox inputRef={searchRef} />
          <div className="topbar-end" data-tauri-drag-region="">
            <ThemeToggle
              dark={dark}
              onToggle={() => {
                onThemeChange(dark ? "light" : "dark");
              }}
            />
            <ModeToggle mode={mode} onChange={onModeChange} />
            <span className="topbar-space" data-tauri-drag-region="" />
            {sync && <SyncIndicator sync={sync} />}
            <Antenna activity={activity} sync={sync} />
          </div>
        </header>
        {updates && <UpdateBanner updates={updates} />}
        <main id="content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {showShortcuts && <ShortcutsDialog onClose={closeShortcuts} />}
    </div>
  );
}
