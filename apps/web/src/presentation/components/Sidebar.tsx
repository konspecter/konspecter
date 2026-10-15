import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Link } from "react-router";
import { tagTree, type TagNode } from "../../domain/tag/tags";
import {
  notesInFolder,
  untaggedNotes,
  type NoteCatalog,
  type NoteSummary,
} from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import { recentWithPins, type NotePins } from "../../application/notes/note-pins";
import type { TagNames } from "../../domain/settings/settings";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { ChevronIcon, GearIcon, NewNoteIcon, SidebarIcon } from "@konspecter/ui/icons";
import { TagTreeView, TreeDocument } from "./TagTreeView";
import { useFold, type FoldEdge } from "../hooks/use-fold";
import { isNarrow } from "../hooks/use-narrow";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type SidebarProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  /** The notes pinned to Ctrl+1…0: at the top of Recent. */
  pins: NotePins;
  open: boolean;
  /** The note open in the main area, if any. */
  currentNoteId: string | null;
  /** The tag the note list is filtered by, if any. */
  activeTag: string | null;
  tagNames: TagNames;
  onToggle: () => void;
  /** Called when a link in the sidebar is followed (narrow screens close it). */
  onNavigate: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
  /** Receives the footer element where the open page shows its details. */
  detailsRef?: (element: HTMLDivElement | null) => void;
};

/** The rows of the panes: the tag folders and notes of the tree, then the recent notes. */
export const SIDEBAR_ROWS = "a.tree-label, a.tree-document, a.recent-link";

/** What ↑/↓ move between: the panes' headers and their rows. */
const MOVE_TARGETS = `.pane-toggle, ${SIDEBAR_ROWS}`;

/** Whether an element of the sidebar is in view: not inside a folded pane. */
export function inOpenPane(element: Element): boolean {
  return element.closest(".sidebar-pane-body[hidden]") === null;
}

/** The row an element belongs to (a folder's toggle belongs to its name). */
function rowOf(element: Element): HTMLElement | null {
  const row = element.closest<HTMLElement>(".tree-document, .recent-link, .tree-row, .pane-toggle");
  return row?.matches(".tree-document, .recent-link, .pane-toggle")
    ? row
    : (row?.querySelector<HTMLElement>("a.tree-label") ?? null);
}

/** ↑/↓: the previous or next header or visible row, all the panes as one flat list. */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element)) return;
  const row = rowOf(event.target);
  if (row === null) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(MOVE_TARGETS)].filter(
    inOpenPane,
  );
  const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
  event.preventDefault();
  next?.focus();
}

/**
 * A clicked header or row takes the focus, so ↑/↓ go on from there. Chromium
 * focuses a clicked link itself; WebKit (Safari, the macOS app) does not, and
 * the keys had no row to start from. A click shows no ring: only the keys do.
 */
function focusClickedRow(event: MouseEvent<HTMLElement>): void {
  if (!(event.target instanceof Element)) return;
  rowOf(event.target)?.focus({ focusVisible: false, preventScroll: true });
}

type PaneId = "tags" | "recent" | "details";

const PANES: readonly PaneId[] = ["tags", "recent", "details"];

const FOLDED_KEY = "konspecter.sidebar.folded";

/**
 * The panes folded on this device. Without a saved choice all are open, but
 * small screens keep the details behind their button.
 */
function initialFolded(): ReadonlySet<PaneId> {
  try {
    const saved = localStorage.getItem(FOLDED_KEY);
    if (saved !== null) {
      const ids: unknown = JSON.parse(saved);
      if (Array.isArray(ids)) return new Set(PANES.filter((pane) => ids.includes(pane)));
    }
  } catch {
    // Unreadable or no storage: the defaults.
  }
  return new Set(isNarrow() ? ["details"] : []);
}

function rememberFolded(folded: ReadonlySet<PaneId>): void {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
  } catch {
    // A per-device convenience; without storage every pane opens again.
  }
}

/** Tooltip text with the shortcut, e.g. "Settings (⌘,)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${formatKeys(keys)})`;
}

/**
 * The left panel: controls, then three foldable panes: the tag tree, the
 * recently edited notes and the open note's details (rendered there by the
 * note page). What is folded is remembered on the device.
 */
export const Sidebar = memo(function Sidebar({
  store,
  catalog,
  pins,
  open,
  currentNoteId,
  activeTag,
  tagNames,
  onToggle,
  onNavigate,
  toggleRef,
  detailsRef,
}: SidebarProps) {
  const library = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const notes = library.status === "ready" ? library.notes : null;
  const untagged = useMemo(() => untaggedNotes(notes ?? []), [notes]);
  const pinned = useSyncExternalStore(pins.subscribe, pins.getSnapshot);
  // Read again with every change to the notes, so the week moves on with them.
  const recent = useMemo(
    () => (notes ? recentWithPins(notes, pinned, new Date()) : null),
    [notes, pinned],
  );
  const recentCount = recent ? recent.pinned.length + recent.recent.length : 0;
  const [folded, setFolded] = useState(initialFolded);
  const toggle = (pane: PaneId) => {
    const next = new Set(folded);
    if (!next.delete(pane)) next.add(pane);
    rememberFolded(next);
    setFolded(next);
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a")) onNavigate();
  };

  return (
    <aside
      id="sidebar"
      className="sidebar"
      aria-label={t("sidebar.label")}
      hidden={!open}
      onClick={handleClick}
    >
      <div className="sidebar-bar" data-tauri-drag-region="">
        <button
          ref={toggleRef}
          type="button"
          className="icon-button"
          aria-label={t("sidebar.hide")}
          aria-expanded="true"
          aria-controls="sidebar"
          title={withShortcut(t("sidebar.hide"), SHORTCUTS.toggleSidebar.keys)}
          onClick={onToggle}
        >
          <SidebarIcon />
        </button>
        <span className="sidebar-bar-space" data-tauri-drag-region="" />
        <Link
          to="/settings"
          className="icon-button"
          aria-label={t("sidebar.settings")}
          title={withShortcut(t("sidebar.settings"), SHORTCUTS.settings.keys)}
        >
          <GearIcon />
        </Link>
        <Link
          to="/conspects/new"
          className="icon-button"
          aria-label={t("sidebar.newNote")}
          title={withShortcut(t("sidebar.newNote"), SHORTCUTS.newNote.keys)}
        >
          <NewNoteIcon />
        </Link>
      </div>
      <div
        className="sidebar-panes"
        data-recent={folded.has("recent") ? "folded" : "open"}
        onKeyDown={moveBetweenRows}
        onClick={focusClickedRow}
      >
        <SidebarTags
          store={store}
          library={library}
          untagged={untagged}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          tagNames={tagNames}
          open={!folded.has("tags")}
          onToggle={() => {
            toggle("tags");
          }}
        />
        <SidebarPane
          title={t("sidebar.recent")}
          className="recent-pane"
          landmark
          open={!folded.has("recent")}
          onToggle={() => {
            toggle("recent");
          }}
        >
          {notes && notes.length === 0 && <p className="sidebar-hint">{t("sidebar.noNotes")}</p>}
          {notes && notes.length > 0 && recentCount === 0 && (
            <p className="sidebar-hint">{t("sidebar.noRecent")}</p>
          )}
          {recent && recentCount > 0 && (
            <ul className="tree">
              {recent.pinned.map(({ key, note }) => (
                <TreeDocument
                  key={note.id}
                  note={note}
                  depth={0}
                  current={note.id === currentNoteId}
                  className="recent-link"
                  pin={key}
                />
              ))}
              {recent.recent.map((note) => (
                <TreeDocument
                  key={note.id}
                  note={note}
                  depth={0}
                  current={note.id === currentNoteId}
                  className="recent-link"
                />
              ))}
            </ul>
          )}
        </SidebarPane>
        <SidebarPane
          title={t("details.title")}
          className="details-pane"
          edge="bottom"
          bodyRef={detailsRef}
          open={!folded.has("details")}
          onToggle={() => {
            toggle("details");
          }}
        />
      </div>
    </aside>
  );
});

type SidebarPaneProps = {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** A navigation landmark named by the title (the tags, the recent notes). */
  landmark?: boolean;
  className: string;
  /** The edge its body keeps to as it folds and opens: the bottom for the pane at the foot. */
  edge?: FoldEdge;
  /** Receives the body element (pages render the details into it). */
  bodyRef?: ((element: HTMLDivElement | null) => void) | undefined;
  children?: ReactNode;
};

/**
 * A foldable block of the sidebar, as in VS Code's side bar: a header that
 * folds or opens it, and a body that scrolls on its own. Any number are open.
 * Folding and opening are animated (`useFold`).
 */
function SidebarPane({
  title,
  open,
  onToggle,
  landmark = false,
  className,
  edge = "top",
  bodyRef,
  children,
}: SidebarPaneProps) {
  const headingId = useId();
  const bodyId = useId();
  const [body, setBodyElement] = useState<HTMLDivElement | null>(null);
  const shown = useFold(body, open, edge);
  const setBody = useCallback(
    (element: HTMLDivElement | null) => {
      setBodyElement(element);
      bodyRef?.(element);
    },
    [bodyRef],
  );
  const Pane = landmark ? "nav" : "div";
  return (
    <Pane
      className={`sidebar-pane ${className}`}
      {...(landmark ? { "aria-labelledby": headingId } : {})}
    >
      <h2 id={headingId} className="sidebar-heading">
        <button
          type="button"
          className="pane-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <ChevronIcon />
          {title}
        </button>
      </h2>
      <div ref={setBody} id={bodyId} className="sidebar-pane-body" hidden={!shown}>
        {children}
      </div>
    </Pane>
  );
}

type SidebarTagsProps = {
  store: NoteRepository;
  /** Changes whenever a note changes: the tags are read again then. */
  library: unknown;
  /** The notes without a tag, by title: at the tree's root. */
  untagged: readonly NoteSummary[];
  activeTag: string | null;
  currentNoteId: string | null;
  tagNames: TagNames;
  open: boolean;
  onToggle: () => void;
};

function SidebarTags({
  store,
  library,
  untagged,
  activeTag,
  currentNoteId,
  tagNames,
  open,
  onToggle,
}: SidebarTagsProps) {
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  // A new loader for every change, so open folders read their notes again.
  const loadNotes = useCallback(
    (noteIds: readonly string[]) => notesInFolder(store, noteIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- library marks the change
    [store, library],
  );
  // Read again whenever a note changes; the old tree stays until then.
  useEffect(() => {
    let current = true;
    store
      .tags()
      .then((counts) => tagTree(counts, { capitalize: tagNames === "capitalized" }))
      .then(
        (next) => {
          if (current) setTree(next);
        },
        () => undefined, // The tree is a convenience; the note list shows errors.
      );
    return () => {
      current = false;
    };
  }, [store, library, tagNames]);

  if (tree === null) return null;
  return (
    <SidebarPane
      title={t("sidebar.tags")}
      className="tags-pane"
      landmark
      open={open}
      onToggle={onToggle}
    >
      {tree.length === 0 && (
        <p className="sidebar-hint">
          {rich("sidebar.tagsHint", { tag: <code>#tag</code>, nested: <code>#parent#child</code> })}
        </p>
      )}
      {(tree.length > 0 || untagged.length > 0) && (
        <TagTreeView
          nodes={tree}
          notes={untagged}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          loadNotes={loadNotes}
        />
      )}
    </SidebarPane>
  );
}
