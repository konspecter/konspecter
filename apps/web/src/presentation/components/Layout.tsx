import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useHistorySteps } from "../hooks/use-history-steps";
import { useShortcuts } from "../hooks/use-shortcuts";
import { useSwipe } from "../hooks/use-swipe";
import { Antenna } from "./Antenna";
import { DetailsSlot } from "./details-slot";
import { IslandSlot } from "./island-slot";
import { GearIcon, ListIcon, NewNoteIcon, SearchIcon, SidebarIcon } from "./icons";
import { NO_FIND, NoteFindContext, type NoteFind, type NoteFindChannel } from "./note-find";
import { SearchBox } from "./SearchBox";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar, SIDEBAR_ROWS, withShortcut } from "./Sidebar";
import { SyncIndicator } from "./SyncIndicator";
import { ModeToggle, ThemeToggle, useDarkTheme } from "./TopBarControls";
import { UpdateBanner } from "./UpdateBanner";
import { t } from "../i18n/i18n";
import { isNarrow, useNarrow } from "../hooks/use-narrow";
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

const SIDEBAR_KEY = "konspecter.sidebar";

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
 * (search, theme, editor mode, activity) over the page content. On small
 * screens the sidebar covers the screen, and the island at the bottom holds
 * the sidebar, the list, the search, the editor's tools, new note and settings.
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
  const [islandSlot, setIslandSlot] = useState<HTMLSpanElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const barToggleRef = useRef<HTMLButtonElement>(null);
  const dark = useDarkTheme(theme);
  const narrow = useNarrow();
  const historySteps = useHistorySteps();
  // The island's search: opened by its button, shown too while the list has a query.
  const [islandSearch, setIslandSearch] = useState(false);
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
  const islandSearchShown = islandSearch || query !== "";
  // Opened, the island's field takes the focus (and brings up the keyboard).
  useLayoutEffect(() => {
    if (islandSearch) searchRef.current?.focus();
  }, [islandSearch]);
  // A note opened from the results (the field let go of the focus) ends the search.
  useEffect(() => {
    if (onNote && document.activeElement !== searchRef.current) setIslandSearch(false);
  }, [onNote, location.pathname]);
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
  // On touch screens a sideways swipe shows (to the right) or hides (to the left) the sidebar.
  useSwipe((direction) => {
    if ((direction === "right") !== sidebarOpen) toggleSidebar();
  });
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

  const focusSearch = () => {
    if (isNarrow()) setIslandSearch(true);
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const openSearch = () => {
    // An open note stays until something is typed.
    if (location.pathname !== "/" && !onNote) void navigate("/");
    setLibraryScope(onNote);
    focusSearch();
  };
  const openFind = () => {
    setLibraryScope(false);
    focusSearch();
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
    // Only within the app's own history: never back out of it.
    back: () => {
      if (historySteps.back) void navigate(-1);
    },
    forward: () => {
      if (historySteps.forward) void navigate(1);
    },
    help: () => {
      setShowShortcuts(true);
    },
  });

  const searchBox = (onClose?: () => void) => (
    <SearchBox
      inputRef={searchRef}
      history={narrow ? null : historySteps}
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
      {...(onClose ? { onClose } : {})}
    />
  );

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
      <div className="main">
        <header className="topbar" data-tauri-drag-region="">
          <div className="topbar-start" data-tauri-drag-region="">
            {!narrow && !sidebarOpen && (
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
            {!narrow && (
              <Link
                to="/"
                className="icon-button topbar-list"
                aria-label={t("sidebar.allNotes")}
                title={withShortcut(t("sidebar.allNotes"), SHORTCUTS.allNotes.keys)}
              >
                <ListIcon />
              </Link>
            )}
          </div>
          {!narrow && searchBox()}
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
            <IslandSlot value={islandSlot}>
              <NoteFindContext value={findChannel}>
                <Outlet />
              </NoteFindContext>
            </IslandSlot>
          </DetailsSlot>
        </main>
      </div>
      {narrow && (
        <nav className="island" aria-label={t("topbar.actions")}>
          {islandSearchShown ? (
            searchBox(() => {
              setIslandSearch(false);
            })
          ) : (
            <>
              <button
                type="button"
                className="island-button"
                aria-label={sidebarOpen ? t("sidebar.hide") : t("sidebar.show")}
                aria-expanded={sidebarOpen}
                aria-controls="sidebar"
                onClick={toggleSidebar}
              >
                <SidebarIcon />
              </button>
              <Link
                to="/"
                className="island-button"
                aria-label={t("sidebar.allNotes")}
                onClick={closeSidebarOnNarrow}
              >
                <ListIcon />
              </Link>
              <button
                type="button"
                className="island-button"
                aria-label={onNote ? t("topbar.find") : t("topbar.search")}
                onClick={() => {
                  closeSidebarOnNarrow();
                  setLibraryScope(false);
                  setIslandSearch(true);
                }}
              >
                <SearchIcon />
              </button>
              {/* The open editor's tools, when it has any. */}
              <span ref={setIslandSlot} className="island-slot" />
              <Link
                to="/notes/new"
                className="island-button"
                aria-label={t("sidebar.newNote")}
                onClick={closeSidebarOnNarrow}
              >
                <NewNoteIcon />
              </Link>
              <Link
                to="/settings"
                className="island-button island-settings"
                aria-label={t("sidebar.settings")}
                onClick={closeSidebarOnNarrow}
              >
                <GearIcon />
              </Link>
            </>
          )}
        </nav>
      )}
      {showShortcuts && <ShortcutsDialog onClose={closeShortcuts} />}
    </div>
  );
}
