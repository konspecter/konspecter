import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { parseQuery } from "../../domain/search/query";
import type { EditorMode, TagNames, Theme } from "../../domain/settings/settings";
import type { NoteCatalog } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import type { Activity } from "../app/activity";
import { rememberLocation } from "../app/last-location";
import { SHORTCUTS } from "../app/shortcuts";
import type { UpdateSource } from "../app/updates";
import { useShortcuts } from "../hooks/use-shortcuts";
import { Antenna } from "./Antenna";
import { DetailsSlot } from "./details-slot";
import { ListIcon, NewNoteIcon, SidebarIcon } from "./icons";
import { NO_FIND, NoteFindContext, type NoteFind, type NoteFindChannel } from "./note-find";
import { SearchBox } from "./SearchBox";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar, SIDEBAR_ROWS, withShortcut } from "./Sidebar";
import { SyncIndicator } from "./SyncIndicator";
import { ModeToggle, ThemeToggle, useDarkTheme } from "./TopBarControls";
import { UpdateBanner } from "./UpdateBanner";
import { t } from "../i18n/i18n";
import { useScrollbarGutter } from "../hooks/use-scrollbar-gutter";

type LayoutProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  activity: Activity;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  tagNames: TagNames;
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

/** Where Mod+\ enters the sidebar: the open note, else what is current there, else the first row. */
function sidebarEntry(): HTMLElement | null {
  const sidebar = document.getElementById("sidebar");
  return (
    sidebar?.querySelector<HTMLElement>(".recent-link[aria-current]") ??
    sidebar?.querySelector<HTMLElement>(".sidebar-scroll [aria-current]") ??
    sidebar?.querySelector<HTMLElement>(SIDEBAR_ROWS) ??
    null
  );
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
  tagNames,
  updates,
  sync,
}: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const noteMatch = useMatch("/notes/:id");
  const matchedId = noteMatch?.params.id;
  const currentNoteId = matchedId === undefined || matchedId === "new" ? null : matchedId;
  const onNote = noteMatch !== null;
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [detailsSlot, setDetailsSlot] = useState<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const barToggleRef = useRef<HTMLButtonElement>(null);
  const dark = useDarkTheme(theme);
  // On the note page the search box searches the note, unless it was opened
  // for the library (Mod+P); that lasts until the box loses the focus.
  const [find, setFind] = useState<NoteFind>(NO_FIND);
  const [findCount, setFindCount] = useState(0);
  const [libraryScope, setLibraryScope] = useState(false);
  const selected = findCount === 0 ? 0 : Math.min(find.selected, findCount - 1);
  const shownFind = useMemo(() => ({ ...find, selected }), [find, selected]);
  const closeFind = useCallback(() => {
    setFind(NO_FIND);
    setFindCount(0);
  }, []);
  const findChannel = useMemo<NoteFindChannel>(
    () => ({ find: shownFind, onCount: setFindCount, onClose: closeFind }),
    [shownFind, closeFind],
  );
  useScrollbarGutter();
  // The app opens where it was last time.
  useEffect(() => {
    rememberLocation(location.pathname + location.search);
  }, [location.pathname, location.search]);

  const query = location.pathname === "/" ? (searchParams.get("q") ?? "") : "";
  const activeTag = useMemo(() => {
    const parsed = parseQuery(query);
    return parsed.words.length === 0 && parsed.tags.length === 1
      ? (parsed.tags[0]?.name ?? null)
      : null;
  }, [query]);

  const toggleSidebar = useCallback(() => {
    // The focus moves only if it would disappear with the sidebar or with the
    // button just used; from the editor (the shortcut), it stays where it is.
    const active = document.activeElement;
    const moveFocus =
      active instanceof Element &&
      (active === barToggleRef.current || active.closest("#sidebar") !== null);
    setSidebarOpen((open) => {
      rememberSidebar(!open);
      return !open;
    });
    if (!moveFocus) return;
    requestAnimationFrame(() => {
      (sidebarToggleRef.current?.offsetParent
        ? sidebarToggleRef.current
        : barToggleRef.current
      )?.focus();
    });
  }, []);
  // Mod+\ that shows the sidebar also goes into it, to the open note; hiding
  // it from there gives the focus back to where it was (the editor's caret).
  const returnFocus = useRef<HTMLElement | null>(null);
  const [sidebarEntered, setSidebarEntered] = useState(0);
  useEffect(() => {
    if (sidebarEntered > 0) sidebarEntry()?.focus();
  }, [sidebarEntered]);
  const toggleSidebarByKey = () => {
    if (!sidebarOpen) {
      const active = document.activeElement;
      returnFocus.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
      toggleSidebar();
      setSidebarEntered((count) => count + 1);
      return;
    }
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected && document.activeElement?.closest("#sidebar")) {
      back.focus({ preventScroll: true });
    }
    toggleSidebar();
  };
  const closeSidebarOnNarrow = useCallback(() => {
    if (isNarrow()) setSidebarOpen(false);
  }, []);
  const closeShortcuts = useCallback(() => {
    setShowShortcuts(false);
  }, []);

  const openSearch = () => {
    // An open note stays until something is typed.
    if (location.pathname !== "/" && !onNote) void navigate("/");
    setLibraryScope(onNote);
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const openFind = () => {
    setLibraryScope(false);
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const newNote = () => void navigate("/notes/new");
  useShortcuts({
    search: openSearch,
    quickSearch: openSearch,
    // Elsewhere Mod+F stays the browser's.
    ...(onNote ? { find: openFind } : {}),
    allNotes: () => void navigate("/"),
    newNote,
    quickNewNote: newNote,
    settings: () => void navigate("/settings"),
    toggleSidebar: toggleSidebarByKey,
    editorMode: () => {
      onModeChange(mode === "markdown" ? "text" : "markdown");
    },
    help: () => {
      setShowShortcuts(true);
    },
  });

  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <a className="skip-link" href="#content">
        {t("app.skipToContent")}
      </a>
      <Sidebar
        store={store}
        catalog={catalog}
        open={sidebarOpen}
        currentNoteId={currentNoteId}
        activeTag={activeTag}
        tagNames={tagNames}
        onToggle={toggleSidebar}
        onNavigate={closeSidebarOnNarrow}
        toggleRef={sidebarToggleRef}
        detailsRef={setDetailsSlot}
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
                  aria-label={t("sidebar.show")}
                  aria-expanded="false"
                  aria-controls="sidebar"
                  title={withShortcut(t("sidebar.show"), SHORTCUTS.toggleSidebar.keys)}
                  onClick={toggleSidebar}
                >
                  <SidebarIcon />
                </button>
                <Link
                  to="/notes/new"
                  className="icon-button"
                  aria-label={t("sidebar.newNote")}
                  title={withShortcut(t("sidebar.newNote"), SHORTCUTS.newNote.keys)}
                >
                  <NewNoteIcon />
                </Link>
              </>
            )}
            {/* Always here, right before the search: the list is what the search filters. */}
            <Link
              to="/"
              className="icon-button topbar-list"
              aria-label={t("sidebar.allNotes")}
              title={withShortcut(t("sidebar.allNotes"), SHORTCUTS.allNotes.keys)}
            >
              <ListIcon />
            </Link>
          </div>
          <SearchBox
            inputRef={searchRef}
            find={
              onNote && !libraryScope
                ? {
                    query: find.query,
                    count: findCount,
                    selected,
                    onQuery: (query) => {
                      setFind((current) => ({ query, selected: 0, reveal: current.reveal + 1 }));
                    },
                    onStep: (step) => {
                      if (findCount === 0) return;
                      setFind((current) => ({
                        query: current.query,
                        selected: (selected + step + findCount) % findCount,
                        reveal: current.reveal + 1,
                      }));
                    },
                  }
                : null
            }
            onLeave={() => {
              setLibraryScope(false);
            }}
          />
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
          <DetailsSlot value={detailsSlot}>
            <NoteFindContext value={findChannel}>
              <Outlet />
            </NoteFindContext>
          </DetailsSlot>
        </main>
      </div>
      {showShortcuts && <ShortcutsDialog onClose={closeShortcuts} />}
    </div>
  );
}
