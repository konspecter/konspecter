import {
  memo,
  useCallback,
  useEffect,
  useId,
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
  type NoteCatalog,
  type NoteSummary,
} from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { TagNames } from "../../domain/settings/settings";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { ChevronIcon, GearIcon, NewNoteIcon, SidebarIcon } from "@konspecter/ui/icons";
import { summaryTitle } from "./note-title";
import { TagTreeView } from "./TagTreeView";
import { isNarrow } from "../hooks/use-narrow";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type SidebarProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
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
  detailsRef?: Ref<HTMLDivElement>;
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
      >
        <SidebarTags
          store={store}
          library={library}
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
          {notes && notes.length > 0 && (
            <ul className="recent-list">
              {notes.map((note) => (
                <RecentNote key={note.id} note={note} current={note.id === currentNoteId} />
              ))}
            </ul>
          )}
        </SidebarPane>
        <SidebarPane
          title={t("details.title")}
          className="details-pane"
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
  /** Receives the body element (pages render the details into it). */
  bodyRef?: Ref<HTMLDivElement> | undefined;
  children?: ReactNode;
};

/**
 * A foldable block of the sidebar, as in VS Code's side bar: a header that
 * folds or opens it, and a body that scrolls on its own. Any number are open.
 */
function SidebarPane({
  title,
  open,
  onToggle,
  landmark = false,
  className,
  bodyRef,
  children,
}: SidebarPaneProps) {
  const headingId = useId();
  const bodyId = useId();
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
      <div ref={bodyRef} id={bodyId} className="sidebar-pane-body" hidden={!open}>
        {children}
      </div>
    </Pane>
  );
}

const RecentNote = memo(function RecentNote({
  note,
  current,
}: {
  note: NoteSummary;
  current: boolean;
}) {
  return (
    <li>
      <Link
        to={`/conspects/${encodeURIComponent(note.id)}`}
        className="recent-link"
        {...(current ? { "aria-current": "page" } : {})}
      >
        {summaryTitle(note)}
      </Link>
    </li>
  );
});

type SidebarTagsProps = {
  store: NoteRepository;
  /** Changes whenever a note changes: the tags are read again then. */
  library: unknown;
  activeTag: string | null;
  currentNoteId: string | null;
  tagNames: TagNames;
  open: boolean;
  onToggle: () => void;
};

function SidebarTags({
  store,
  library,
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
      {tree.length === 0 ? (
        <p className="sidebar-hint">
          {rich("sidebar.tagsHint", { tag: <code>#tag</code>, nested: <code>#parent#child</code> })}
        </p>
      ) : (
        <TagTreeView
          nodes={tree}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          loadNotes={loadNotes}
        />
      )}
    </SidebarPane>
  );
}
