import {
  memo,
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { Link } from "react-router";
import { tagTree, type Tag, type TagNode } from "../../domain/tag/tags";
import {
  notesInTag,
  type NoteCatalog,
  type NoteSummary,
} from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import type { TagNames } from "../../domain/settings/settings";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { ChevronIcon, GearIcon, NewNoteIcon, SidebarIcon } from "./icons";
import { summaryTitle } from "./note-title";
import { TagTreeView } from "./TagTreeView";
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

/** The rows ↑/↓ move between: the tag folders and notes of the tree, then the recent notes. */
export const SIDEBAR_ROWS = "a.tree-label, a.tree-document, a.recent-link";

/** The row an element belongs to (a folder's toggle belongs to its name). */
function rowOf(element: Element): HTMLElement | null {
  const row = element.closest<HTMLElement>(".tree-document, .recent-link, .tree-row");
  return row?.matches(".tree-document, .recent-link")
    ? row
    : (row?.querySelector<HTMLElement>("a.tree-label") ?? null);
}

/** ↑/↓: the previous or next visible row, the tree and the recent list as one flat list. */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element)) return;
  const row = rowOf(event.target);
  if (row === null) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(SIDEBAR_ROWS)];
  const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
  event.preventDefault();
  next?.focus();
}

/** Tooltip text with the shortcut, e.g. "Settings (⌘,)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${formatKeys(keys)})`;
}

/**
 * The left panel: controls, the tag tree and the recently edited notes, and
 * at the bottom the open note's details (rendered there by the note page).
 * Small screens show the details only after their button is pressed.
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
  const detailsId = useId();
  const [detailsShown, setDetailsShown] = useState(false);

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
          to="/notes/new"
          className="icon-button"
          aria-label={t("sidebar.newNote")}
          title={withShortcut(t("sidebar.newNote"), SHORTCUTS.newNote.keys)}
        >
          <NewNoteIcon />
        </Link>
      </div>
      <div className="sidebar-scroll" onKeyDown={moveBetweenRows}>
        <SidebarTags
          store={store}
          library={library}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          tagNames={tagNames}
        />
        <nav className="sidebar-section" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="sidebar-heading">
            {t("sidebar.recent")}
          </h2>
          {notes && notes.length === 0 && <p className="sidebar-hint">{t("sidebar.noNotes")}</p>}
          {notes && notes.length > 0 && (
            <ul className="recent-list">
              {notes.map((note) => (
                <RecentNote key={note.id} note={note} current={note.id === currentNoteId} />
              ))}
            </ul>
          )}
        </nav>
      </div>
      <div className="sidebar-footer" data-details={detailsShown ? "shown" : "hidden"}>
        <button
          type="button"
          className="sidebar-details-toggle"
          aria-expanded={detailsShown}
          aria-controls={detailsId}
          onClick={() => {
            setDetailsShown(!detailsShown);
          }}
        >
          {t("details.title")}
          <ChevronIcon />
        </button>
        <div ref={detailsRef} id={detailsId} className="sidebar-details" />
      </div>
    </aside>
  );
});

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
        to={`/notes/${encodeURIComponent(note.id)}`}
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
};

function SidebarTags({ store, library, activeTag, currentNoteId, tagNames }: SidebarTagsProps) {
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  // A new loader for every change, so open folders read their notes again.
  const loadNotes = useCallback(
    (tag: Tag) => notesInTag(store, tag),
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
    <nav className="sidebar-section" aria-labelledby="tags-heading">
      <h2 id="tags-heading" className="sidebar-heading">
        {t("sidebar.tags")}
      </h2>
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
    </nav>
  );
}
