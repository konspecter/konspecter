import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import { parseQuery } from "../../domain/search/query";
import type { EditorMode, TagNames, Theme, TreeHeadings } from "../../domain/settings/settings";
import type { NoteCatalog } from "../../application/notes/note-catalog";
import { pinsOf, recentWithPins } from "../../application/notes/note-pins";
import {
  noteOpened,
  startSwitch,
  switchStep,
  type NoteSwitch,
} from "../../application/notes/note-switch";
import type { NoteRepository } from "../../application/notes/note-repository";
import { tagSuggester } from "../../application/notes/tag-suggester";
import type { BackButton } from "../../infrastructure/mobile/mobile";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import type { Activity } from "../app/activity";
import { rememberLocation } from "../app/last-location";
import { pinKeyOf, SHORTCUTS } from "../app/shortcuts";
import type { UpdateSource } from "../app/updates";
import { stepsAway, useHistorySteps } from "../hooks/use-history-steps";
import { useIslandStretch } from "../hooks/use-island-stretch";
import { useShortcuts } from "../hooks/use-shortcuts";
import { slideIn } from "../hooks/use-slide";
import { useSwipe } from "../hooks/use-swipe";
import { Antenna } from "./Antenna";
import { DetailsSlot } from "./details-slot";
import { IslandSlot } from "./island-slot";
import type { LibraryControls } from "../app/library";
import { newNoteState } from "./new-note";
import {
  GearIcon,
  ListIcon,
  NewNoteIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
} from "@konspecter/ui/icons";
import { NO_FIND, NoteFindContext, type NoteFind, type NoteFindChannel } from "./note-find";
import { SearchBox } from "./SearchBox";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { inOpenPane, Sidebar, SIDEBAR_ROWS, withShortcut } from "./Sidebar";
import { SyncIndicator } from "./SyncIndicator";
import { TagSuggestContext } from "./tag-suggest";
import { ModeToggle, ThemeToggle, useDarkTheme } from "./TopBarControls";
import { UpdateBanner } from "./UpdateBanner";
import { WipedBanner } from "./WipedBanner";
import { t } from "../i18n/i18n";
import { isNarrow, useNarrow } from "../hooks/use-narrow";
import { useScrollbarGutter } from "../hooks/use-scrollbar-gutter";

const SETTINGS_PATH = "/settings";
/** Settings is gone through, not gone back or forward to by a swipe. */
const passedBy = (path: string) => path === SETTINGS_PATH;

type LayoutProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  /** Desktop: the connected folders. */
  library?: LibraryControls | undefined;
  activity: Activity;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  tagNames: TagNames;
  /** Whether the tree's notes list their headings (hidden unless set otherwise). */
  treeHeadings?: TreeHeadings;
  updates?: UpdateSource | undefined;
  /** The device was wiped from the site just before this start. */
  wiped?: boolean;
  sync?: SyncEngine | undefined;
  /** The desktop app: the sidebar follows the window as it is made narrow or wide. */
  desktop?: boolean;
  /** The mobile app: the system's back button, taken over by the app. */
  backButton?: BackButton | undefined;
};

const SIDEBAR_KEY = "konspecter.sidebar";

/** Whether the sidebar was left shown on a wide screen (where the choice is remembered). */
function rememberedSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

/** Narrow screens start with the sidebar closed; wide ones remember the choice. */
function initialSidebarOpen(): boolean {
  return !isNarrow() && rememberedSidebarOpen();
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
 * Where Mod+\ enters the sidebar, in the open panes: the open note, else what
 * is current there, else the first row; with every pane folded, the first header.
 */
function sidebarEntry(): HTMLElement | null {
  const sidebar = document.getElementById("sidebar");
  const first = (selector: string) =>
    [...(sidebar?.querySelectorAll<HTMLElement>(selector) ?? [])].find(inOpenPane);
  return (
    first(".recent-link[aria-current]") ??
    first("nav.sidebar-pane [aria-current]") ??
    first(SIDEBAR_ROWS) ??
    first(".pane-toggle") ??
    null
  );
}

/**
 * The whole window: the sidebar on the left, and on the right a top bar
 * (search, theme, editor mode, activity) over the page content. On small
 * screens the sidebar covers the screen, and the island at the bottom holds
 * the sidebar, the list, the search, the editor's tools, new note and settings;
 * the search opens in a panel above it.
 */
export function Layout({
  store,
  catalog,
  library,
  activity,
  theme,
  onThemeChange,
  mode,
  onModeChange,
  tagNames,
  treeHeadings = "hidden",
  updates,
  wiped = false,
  sync,
  desktop = false,
  backButton,
}: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const noteMatch = useMatch("/conspects/:id");
  const matchedId = noteMatch?.params.id;
  const currentNoteId = matchedId === undefined || matchedId === "new" ? null : matchedId;
  const onNote = noteMatch !== null;
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [detailsSlot, setDetailsSlot] = useState<HTMLDivElement | null>(null);
  const [islandSlot, setIslandSlot] = useState<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeIslandSearch = useRef<() => void>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const barToggleRef = useRef<HTMLButtonElement>(null);
  const dark = useDarkTheme(theme);
  const narrow = useNarrow();
  // In the desktop app a window made narrow hides the sidebar, which would
  // cover it; made wide again, the sidebar is as it was left there: shown
  // again, or still hidden if it was hidden.
  const [wasNarrow, setWasNarrow] = useState(narrow);
  if (desktop && narrow !== wasNarrow) {
    setWasNarrow(narrow);
    setSidebarOpen(!narrow && rememberedSidebarOpen());
  }
  const historySteps = useHistorySteps();
  // The island's search: opened by its button, shown too while the list has a query.
  const [islandSearch, setIslandSearch] = useState(false);
  const islandSearchId = useId();
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
  const startFind = useCallback((query: string) => {
    setFind((current) => ({ query, selected: 0, reveal: current.reveal + 1 }));
  }, []);
  const findChannel = useMemo<NoteFindChannel>(
    () => ({ find: shownFind, onCount: setFindCount, onClose: closeFind, onFind: startFind }),
    [shownFind, closeFind, startFind],
  );
  // The library's tags, offered while one is typed in the search box or a note.
  const suggestTags = useMemo(() => tagSuggester(catalog), [catalog]);
  useScrollbarGutter();
  // The app opens where it was last time.
  useEffect(() => {
    rememberLocation(location.pathname + location.search);
  }, [location.pathname, location.search]);

  const query = location.pathname === "/" ? (searchParams.get("q") ?? "") : "";
  const islandSearchShown = islandSearch || query !== "";
  // It stretches open and shrinks back (`hooks/use-island-stretch.ts`), staying while it shrinks.
  const dockRef = useRef<HTMLDivElement>(null);
  const islandSearchRef = useRef<HTMLDivElement>(null);
  const islandSearchRendered = useIslandStretch(
    islandSearchShown,
    narrow,
    dockRef,
    islandSearchRef,
    islandSlot,
  );
  // Opened, the island's field takes the focus (and brings up the keyboard).
  useLayoutEffect(() => {
    if (islandSearch) searchRef.current?.focus();
  }, [islandSearch]);
  // Ends the island's search as its × does: the query emptied, the panel gone.
  const endIslandSearch = () => {
    if (closeIslandSearch.current) closeIslandSearch.current();
    else setIslandSearch(false);
  };
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
  // A new note starts with the tag the list is filtered by, as its tree folder's chain.
  const newNote = useMemo(
    () =>
      newNoteState(
        activeTag,
        location.state,
        currentNoteId === null ? null : (library?.folderOf(currentNoteId) ?? null),
      ),
    [activeTag, location.state, currentNoteId, library],
  );

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
  const openNewNote = () => void navigate("/conspects/new", { state: newNote });
  const openRecent = (step: 1 | -1) => {
    const library = catalog.getSnapshot();
    if (library.status !== "ready") return;
    const { pinned, recent } = recentWithPins(library.notes, new Date());
    const id = recentStep(
      [...pinned.map(({ note }) => note.id), ...recent.map((note) => note.id)],
      currentNoteId,
      step,
    );
    if (id !== null) void navigate(`/conspects/${encodeURIComponent(id)}`);
  };
  // Ctrl+Tab: the notes in the order they were opened. While Ctrl is held the
  // order stays as it was at the first Tab; letting go puts the note reached first.
  const opened = useRef<string[]>([]);
  const switching = useRef<NoteSwitch | null>(null);
  useEffect(() => {
    if (currentNoteId !== null && switching.current === null) {
      opened.current = noteOpened(opened.current, currentNoteId);
    }
  }, [currentNoteId]);
  useEffect(() => {
    const settle = (event: Event) => {
      const held = switching.current;
      if (held === null || (event instanceof KeyboardEvent && event.key !== "Control")) return;
      switching.current = null;
      const id = held.order[held.index];
      if (id !== undefined) opened.current = noteOpened(opened.current, id);
    };
    window.addEventListener("keyup", settle, { capture: true });
    window.addEventListener("blur", settle);
    return () => {
      window.removeEventListener("keyup", settle, { capture: true });
      window.removeEventListener("blur", settle);
    };
  }, []);
  const switchNote = (direction: 1 | -1): false | undefined => {
    const library = catalog.getSnapshot();
    const held =
      switching.current ??
      (library.status === "ready"
        ? startSwitch(opened.current, library.notes, currentNoteId, new Date())
        : null);
    const step = held && switchStep(held, direction);
    if (!step) return false;
    switching.current = step.next;
    void navigate(`/conspects/${encodeURIComponent(step.id)}`);
    return undefined;
  };
  // The note on the key. A key with no note (or one that is gone) stays the browser's.
  const openPinned = (event: KeyboardEvent): false | undefined => {
    const key = pinKeyOf(event);
    const library = catalog.getSnapshot();
    if (key === null || library.status !== "ready") return false;
    const id = pinsOf(library.notes)[key];
    if (id === undefined) return false;
    if (id !== currentNoteId) void navigate(`/conspects/${encodeURIComponent(id)}`);
    return undefined;
  };
  // On a small screen the page gone to by a swipe (or the back button) slides
  // in from that side as it first shows.
  const contentRef = useRef<HTMLElement>(null);
  const slideFrom = useRef<"left" | "right" | null>(null);
  useLayoutEffect(() => {
    const from = slideFrom.current;
    slideFrom.current = null;
    if (from && contentRef.current) slideIn(contentRef.current, from);
  }, [location.key]);
  // Back or forward, but never into Settings (past it); with nothing further
  // back in the app's history, back is to the list (if not there yet), in
  // place of the page left when `replace` is set.
  // Whether it went anywhere.
  const goPastSettings = (direction: -1 | 1, replace = false): boolean => {
    const delta = stepsAway(historySteps.steps, direction, passedBy);
    const toList = direction === -1 && !(location.pathname === "/" && location.search === "");
    if (delta === null && !toList) return false;
    slideFrom.current = narrow ? (direction === -1 ? "left" : "right") : null;
    if (delta === null) void navigate("/", { replace });
    else void navigate(delta);
    return true;
  };
  // On touch screens a sideways swipe goes through the history: to the
  // right back, to the left forward. On a narrow screen the
  // sidebar, which covers the page, closes to show where it went.
  useSwipe((direction) => {
    if (goPastSettings(direction === "right" ? -1 : 1)) closeSidebarOnNarrow();
  });
  // The mobile app's back button first closes what is open over the page: a
  // dialog (as its Escape does), the island's search (as its × does), the
  // sidebar covering the screen. Then it goes back as a swipe does, and on
  // the list, with nowhere further back, it does nothing (the app goes to
  // the background). The list comes in place of the page left, so the next
  // back does not return to it.
  const goBack = (): boolean => {
    if (showShortcuts) {
      setShowShortcuts(false);
      return true;
    }
    // A page's own dialog gets Escape on itself: a confirmation (an
    // alertdialog) listens on its own element, the others on the window it
    // bubbles up to.
    const dialog = document.querySelector("[role='dialog'], [role='alertdialog']");
    if (dialog) {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    if (narrow && islandSearchShown) {
      endIslandSearch();
      return true;
    }
    if (narrow && sidebarOpen) {
      setSidebarOpen(false);
      return true;
    }
    return goPastSettings(-1, true);
  };
  const latestGoBack = useRef(goBack);
  useEffect(() => {
    latestGoBack.current = goBack;
  });
  useEffect(() => backButton?.(() => latestGoBack.current()), [backButton]);
  useShortcuts({
    search: openSearch,
    quickSearch: openSearch,
    // Elsewhere Mod+F stays the browser's.
    ...(onNote ? { find: openFind } : {}),
    newNote: openNewNote,
    quickNewNote: openNewNote,
    settings: () => void navigate(SETTINGS_PATH),
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
    previousRecent: () => {
      openRecent(-1);
    },
    nextRecent: () => {
      openRecent(1);
    },
    switchNote: () => switchNote(1),
    switchNoteBack: () => switchNote(-1),
    // Mod+Alt+1…0 (pinning) is the note page's: it edits the note.
    openPinned,
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
      closeRef={closeIslandSearch}
      {...(onClose ? { onClose } : {})}
    />
  );

  return (
    <TagSuggestContext value={suggestTags}>
      <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
        <a className="skip-link" href="#content">
          {t("app.skipToContent")}
        </a>
        <Sidebar
          store={store}
          catalog={catalog}
          library={library}
          open={sidebarOpen}
          currentNoteId={currentNoteId}
          activeTag={activeTag}
          newNote={newNote}
          tagNames={tagNames}
          treeHeadings={treeHeadings}
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
                    to="/conspects/new"
                    state={newNote}
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
                  title={t("sidebar.allNotes")}
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
          {wiped && <WipedBanner />}
          <main ref={contentRef} id="content" className="content" tabIndex={-1}>
            <DetailsSlot value={detailsSlot}>
              <IslandSlot value={islandSlot}>
                <NoteFindContext value={findChannel}>
                  <Outlet />
                </NoteFindContext>
              </IslandSlot>
            </DetailsSlot>
          </main>
        </div>
        {/*
          The island at the bottom, and the row just above it: the island's
          search, and the open editor's tools in a bar of their own over Settings.
        */}
        {narrow && (
          <div ref={dockRef} className="island-dock">
            {islandSearchRendered && (
              <div
                ref={islandSearchRef}
                id={islandSearchId}
                className="island-search"
                inert={!islandSearchShown}
              >
                {searchBox(() => {
                  setIslandSearch(false);
                })}
              </div>
            )}
            <div ref={setIslandSlot} className="island-editor-slot" />
            <nav className="island" aria-label={t("topbar.actions")}>
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
              {/* New note: the big round button in the middle. */}
              <Link
                to="/conspects/new"
                state={newNote}
                className="island-button island-new"
                aria-label={t("sidebar.newNote")}
                onClick={closeSidebarOnNarrow}
              >
                <PlusIcon />
              </Link>
              <button
                type="button"
                className="island-button"
                aria-label={onNote ? t("topbar.find") : t("topbar.search")}
                aria-expanded={islandSearchShown}
                aria-controls={islandSearchId}
                onClick={() => {
                  if (islandSearchShown) {
                    endIslandSearch();
                    return;
                  }
                  closeSidebarOnNarrow();
                  setLibraryScope(false);
                  setIslandSearch(true);
                }}
              >
                <SearchIcon />
              </button>
              <Link
                to={SETTINGS_PATH}
                className="island-button island-settings"
                aria-label={t("sidebar.settings")}
                onClick={closeSidebarOnNarrow}
              >
                <GearIcon />
              </Link>
            </nav>
          </div>
        )}
        {showShortcuts && <ShortcutsDialog onClose={closeShortcuts} />}
      </div>
    </TagSuggestContext>
  );
}

/**
 * The note `step` from `current` in Recent (the pins, then newest first), round
 * from the last to the first and back. Away from a note, the next is the
 * first and the previous the last. Null when there is none to go to.
 */
export function recentStep(
  ids: readonly string[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  const next =
    index === -1 ? (step === 1 ? 0 : ids.length - 1) : (index + step + ids.length) % ids.length;
  const id = ids[next] ?? null;
  return id === current ? null : id;
}
