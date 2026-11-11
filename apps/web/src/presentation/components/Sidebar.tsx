import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Link, useNavigate } from "react-router";
import { tagTree, type TagNode } from "../../domain/tag/tags";
import {
  notesInFolder,
  untaggedNotes,
  type NoteCatalog,
  type NoteSummary,
} from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import { savesSettled } from "../../application/notes/autosave";
import { recentWithPins } from "../../application/notes/note-pins";
import type { TagNames, TreeHeadings } from "../../domain/settings/settings";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import {
  AddFolderIcon,
  ChevronIcon,
  GearIcon,
  NewNoteIcon,
  SidebarIcon,
} from "@konspecter/ui/icons";
import { folderLabel, type LibraryControls, type LibraryFolder } from "../app/library";
import { reportError } from "../app/errors";
import { addFolderRefusal, revealFolderLabel } from "./LibraryFolders";
import { useLibraryFolders } from "../hooks/use-library-folders";
import type { NewNoteState } from "./new-note";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { summaryTitle } from "./note-title";
import { FolderRoot, TagTreeView, TreeDocument } from "./TagTreeView";
import { TagListView } from "./TagListView";
import { useFold, type FoldEdge } from "../hooks/use-fold";
import { isNarrow, useNarrow } from "../hooks/use-narrow";
import { useSlide } from "../hooks/use-slide";
import { useErrorMessage } from "../hooks/use-error-message";
import { t } from "../i18n/i18n";
import { rich } from "../i18n/rich";

type SidebarProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  /** Desktop: the connected folders; several are the tree's roots. */
  library?: LibraryControls | undefined;
  open: boolean;
  /** The note open in the main area, if any. */
  currentNoteId: string | null;
  /** The tag the note list is filtered by, if any. */
  activeTag: string | null;
  /** What a new note starts with (the filter's tag), if anything. */
  newNote?: NewNoteState | undefined;
  tagNames: TagNames;
  treeHeadings?: TreeHeadings;
  onToggle: () => void;
  /** Called when a link in the sidebar is followed (narrow screens close it). */
  onNavigate: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
  /** Receives the footer element where the open page shows its details. */
  detailsRef?: (element: HTMLDivElement | null) => void;
};

/**
 * The rows of the panes: the folders' roots (several folders), the tag
 * folders and notes of the tree (or of the list, on a small screen: its
 * folders are buttons), then the recent notes.
 */
export const SIDEBAR_ROWS = "button.tree-root, a.tree-label, .tree-document, a.recent-link";

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
    : (row?.querySelector<HTMLElement>("button.tree-root, a.tree-label") ?? null);
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

/** A row's context menu: where it opened and the row it acts on. */
type RowMenu = {
  x: number;
  y: number;
  row: HTMLElement;
  /** The note the row is (`data-note-id`); null for a folder or a heading. */
  noteId: string | null;
  /** The connected folder the row is the root of (`data-folder-id`), if it is one. */
  folderId: string | null;
};

/**
 * The context menu asked for on a row (a right click, a long press, the menu
 * key): the app's own, not the browser's. Null off the rows.
 */
function rowMenuAt(event: MouseEvent<HTMLElement>): RowMenu | null {
  if (!(event.target instanceof Element)) return null;
  const row = rowOf(event.target);
  if (row === null || row.matches(".pane-toggle")) return null;
  let { clientX: x, clientY: y } = event;
  if (x === 0 && y === 0) {
    // From the keyboard, without a pointer: under the row.
    const box = row.getBoundingClientRect();
    x = box.left;
    y = box.bottom;
  }
  return { x, y, row, noteId: row.dataset.noteId ?? null, folderId: row.dataset.folderId ?? null };
}

/** The row's name, as its menu is named. */
function rowName(row: HTMLElement): string {
  const label = row.matches(".tree-label") ? row : row.querySelector(".tree-label");
  return (label ?? row).textContent.trim();
}

/**
 * Deletes notes from the sidebar. The open note is left first, for the note
 * list: its editor hands its last changes over as the page goes, and the note
 * is deleted once no save of it is running, so nothing brings it back.
 */
function useNoteDeletion(store: NoteRepository, currentNoteId: string | null) {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<unknown>(null);
  const leaving = useRef<string | null>(null);

  const remove = useCallback(
    (id: string) => {
      void savesSettled(store, id)
        .then(() => store.delete(id))
        .catch(setFailure);
    },
    [store],
  );

  // The open note's page is gone, and with it its editor's last save began.
  useEffect(() => {
    const id = leaving.current;
    if (id === null || id === currentNoteId) return;
    leaving.current = null;
    remove(id);
  }, [currentNoteId, remove]);

  const deleteNote = (id: string) => {
    setFailure(null);
    if (id !== currentNoteId) {
      remove(id);
      return;
    }
    leaving.current = id;
    void navigate("/", { replace: true });
  };
  return { deleteNote, failure };
}

type PaneId = "recent" | "details";

const PANES: readonly PaneId[] = ["recent", "details"];

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
 * The left panel: controls, the tag tree (always open, without a header), then
 * two foldable panes: the recently edited notes and the open note's details
 * (rendered there by the note page). What is folded is remembered on the device.
 */
export const Sidebar = memo(function Sidebar({
  store,
  catalog,
  library: folderLibrary,
  open,
  currentNoteId,
  activeTag,
  newNote,
  tagNames,
  treeHeadings = "hidden",
  onToggle,
  onNavigate,
  toggleRef,
  detailsRef,
}: SidebarProps) {
  const library = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const notes = library.status === "ready" ? library.notes : null;
  const untagged = useMemo(() => untaggedNotes(notes ?? []), [notes]);
  // Read again with every change to the notes, so the week moves on with them;
  // the pins, at its top, are the notes' own (`pin` in the frontmatter).
  const recent = useMemo(() => (notes ? recentWithPins(notes, new Date()) : null), [notes]);
  const recentCount = recent ? recent.pinned.length + recent.recent.length : 0;
  const [folded, setFolded] = useState(initialFolded);
  // On small screens the full-screen sidebar slides in from the left and out again.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const shown = useSlide(panel, open, useNarrow());
  const toggle = (pane: PaneId) => {
    const next = new Set(folded);
    if (!next.delete(pane)) next.add(pane);
    rememberFolded(next);
    setFolded(next);
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a")) onNavigate();
  };

  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [confirming, setConfirming] = useState<NoteSummary | null>(null);
  const { deleteNote, failure } = useNoteDeletion(store, currentNoteId);
  const failureText = useErrorMessage(failure);
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    const next = rowMenuAt(event);
    if (next === null) return;
    event.preventDefault();
    setMenu(next);
  };
  const [addError, setAddError] = useState<unknown>(null);
  const addErrorText = useErrorMessage(addError);
  const addRefusal = addFolderRefusal(addError);
  const menuItems = (target: RowMenu): ContextMenuItem[] => {
    const { folderId } = target;
    if (folderId !== null && folderLibrary) {
      return [
        {
          label: revealFolderLabel(),
          onSelect: () => {
            folderLibrary.reveal(folderId).catch(reportError);
          },
        },
      ];
    }
    const items: ContextMenuItem[] = [
      {
        label: t("sidebar.open"),
        // As a click on the row: it opens, a folder unfolds, a narrow sidebar closes.
        onSelect: () => {
          target.row.click();
        },
      },
    ];
    const note = target.noteId === null ? undefined : notes?.find((n) => n.id === target.noteId);
    if (note) {
      items.push({
        label: t("sidebar.delete"),
        danger: true,
        onSelect: () => {
          setConfirming(note);
        },
      });
    }
    return items;
  };

  return (
    <aside
      ref={setPanel}
      id="sidebar"
      className="sidebar"
      aria-label={t("sidebar.label")}
      hidden={!shown}
      // Sliding out, it is no longer there to tap or to focus.
      inert={!open}
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
        {folderLibrary && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("sidebar.addFolder")}
            title={t("sidebar.addFolder")}
            onClick={() => {
              setAddError(null);
              folderLibrary.add().catch(setAddError);
            }}
          >
            <AddFolderIcon />
          </button>
        )}
        <Link
          to="/conspects/new"
          state={newNote}
          className="icon-button"
          aria-label={t("sidebar.newNote")}
          title={withShortcut(t("sidebar.newNote"), SHORTCUTS.newNote.keys)}
        >
          <NewNoteIcon />
        </Link>
      </div>
      {failureText !== null && (
        <p role="alert" className="inline-error sidebar-error">
          {t("details.deleteFailed", { error: failureText })}
        </p>
      )}
      {addError !== null && (
        <p role="alert" className="inline-error sidebar-error">
          {addRefusal ?? addErrorText}
        </p>
      )}
      <div
        className="sidebar-panes"
        data-recent={folded.has("recent") ? "folded" : "open"}
        onKeyDown={moveBetweenRows}
        onClick={focusClickedRow}
        onContextMenu={openMenu}
      >
        <SidebarTags
          store={store}
          folderLibrary={folderLibrary}
          library={library}
          untagged={untagged}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          tagNames={tagNames}
          headings={treeHeadings === "shown"}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={rowName(menu.row)}
          items={menuItems(menu)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={t("details.deleteTitle")}
          message={t(store.reveal ? "details.confirmDeleteFile" : "details.confirmDelete", {
            title: summaryTitle(confirming),
          })}
          confirmLabel={t("sidebar.delete")}
          danger
          onConfirm={() => {
            setConfirming(null);
            deleteNote(confirming.id);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
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
  /** Desktop: the connected folders; with several, each is a root. */
  folderLibrary?: LibraryControls | undefined;
  /** Changes whenever a note changes: the tags are read again then. */
  library: unknown;
  /** The notes without a tag, by title: at the tree's root. */
  untagged: readonly NoteSummary[];
  activeTag: string | null;
  currentNoteId: string | null;
  tagNames: TagNames;
  /** The notes list their headings. */
  headings: boolean;
};

const ROOTS_KEY = "konspecter.sidebar.roots";

/** The folders' roots folded on this device. */
function foldedRoots(): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(ROOTS_KEY) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberFoldedRoots(folded: ReadonlySet<string>): void {
  try {
    localStorage.setItem(ROOTS_KEY, JSON.stringify([...folded]));
  } catch {
    // A per-device convenience; without storage every root opens again.
  }
}

/**
 * The tag tree: not a pane, so neither folded nor titled; it scrolls on its
 * own. With several folders, each is a root holding its own tree (ADR-030).
 */
function SidebarTags(props: SidebarTagsProps) {
  const folders = useLibraryFolders(props.folderLibrary);
  const [folded, setFolded] = useState(foldedRoots);
  const { folderLibrary } = props;
  if (!folderLibrary || folders.length < 2) return <SingleTree {...props} />;
  const toggle = (id: string, expanded: boolean) => {
    const next = new Set(folded);
    if (expanded) next.delete(id);
    else next.add(id);
    rememberFoldedRoots(next);
    setFolded(next);
  };
  return (
    <nav className="sidebar-pane tags-pane" aria-label={t("sidebar.tags")}>
      <div className="sidebar-pane-body">
        <ul className="tree">
          {folders.map((folder) => (
            <FolderRoot
              key={folder.id}
              id={folder.id}
              label={folderLabel(folder)}
              available={folder.available}
              expanded={!folded.has(folder.id)}
              onExpandedChange={(expanded) => {
                toggle(folder.id, expanded);
              }}
            >
              {(parent) => (
                <FolderTree
                  {...props}
                  folderLibrary={folderLibrary}
                  folder={folder}
                  parent={parent}
                />
              )}
            </FolderRoot>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** One folder's tags and notes, under its root. */
function FolderTree({
  store,
  folderLibrary,
  folder,
  parent,
  library,
  untagged,
  activeTag,
  currentNoteId,
  tagNames,
  headings,
}: SidebarTagsProps & {
  folderLibrary: LibraryControls;
  folder: LibraryFolder;
  parent: RefObject<HTMLElement | null>;
}) {
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  // A small screen lists one folder at a time: a tree's chevrons are too small to tap.
  const narrow = useNarrow();
  const loadNotes = useCallback(
    // The list on a small screen shows no headings: they are not read for it.
    (noteIds: readonly string[]) =>
      notesInFolder(store, noteIds, { headings: headings && !narrow }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- library marks the change
    [store, library, headings, narrow],
  );
  const notes = useMemo(
    () => untagged.filter((note) => folderLibrary.folderOf(note.id) === folder.id),
    [untagged, folderLibrary, folder.id],
  );
  useEffect(() => {
    let current = true;
    folderLibrary
      .tags(folder.id)
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
  }, [folderLibrary, folder.id, library, tagNames]);

  if (tree === null) return null;
  return narrow ? (
    <TagListView
      nodes={tree}
      notes={notes}
      activeTag={activeTag}
      currentNoteId={currentNoteId}
      loadNotes={loadNotes}
      depth={1}
      rootName={folderLabel(folder)}
    />
  ) : (
    <TagTreeView
      nodes={tree}
      notes={notes}
      activeTag={activeTag}
      currentNoteId={currentNoteId}
      headings={headings}
      loadNotes={loadNotes}
      depth={1}
      parent={parent}
    />
  );
}

/** One folder, or the app library: the tags at the root. */
function SingleTree({
  store,
  library,
  untagged,
  activeTag,
  currentNoteId,
  tagNames,
  headings,
}: SidebarTagsProps) {
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  // A small screen lists one folder at a time: a tree's chevrons are too small to tap.
  const narrow = useNarrow();
  // A new loader for every change, so open folders read their notes again.
  const loadNotes = useCallback(
    // The list on a small screen shows no headings: they are not read for it.
    (noteIds: readonly string[]) =>
      notesInFolder(store, noteIds, { headings: headings && !narrow }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- library marks the change
    [store, library, headings, narrow],
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
    <nav className="sidebar-pane tags-pane" aria-label={t("sidebar.tags")}>
      <div className="sidebar-pane-body">
        {/* The hint is for an empty library only: tagged or not, any note is listed instead. */}
        {tree.length === 0 && untagged.length === 0 ? (
          <p className="sidebar-hint">
            {rich("sidebar.tagsHint", {
              tag: <code>#tag</code>,
              nested: <code>#parent#child</code>,
            })}
          </p>
        ) : narrow ? (
          <TagListView
            nodes={tree}
            notes={untagged}
            activeTag={activeTag}
            currentNoteId={currentNoteId}
            loadNotes={loadNotes}
          />
        ) : (
          <TagTreeView
            nodes={tree}
            notes={untagged}
            activeTag={activeTag}
            currentNoteId={currentNoteId}
            headings={headings}
            loadNotes={loadNotes}
          />
        )}
      </div>
    </nav>
  );
}
