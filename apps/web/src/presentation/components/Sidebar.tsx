import { memo, useEffect, useState, useSyncExternalStore, type MouseEvent, type Ref } from "react";
import { Link } from "react-router";
import { tagTree, type TagNode } from "../../domain/tag/tags";
import type { NoteCatalog, NoteSummary } from "../../application/notes/note-catalog";
import type { NoteRepository } from "../../application/notes/note-repository";
import { formatKeys, SHORTCUTS } from "../app/shortcuts";
import { GearIcon, NewNoteIcon, SidebarIcon } from "./icons";
import { summaryTitle } from "./note-title";
import { TagTreeView } from "./TagTreeView";

type SidebarProps = {
  store: NoteRepository;
  catalog: NoteCatalog;
  open: boolean;
  /** The note open in the main area, if any. */
  currentNoteId: string | null;
  /** The tag the note list is filtered by, if any. */
  activeTag: string | null;
  onToggle: () => void;
  /** Called when a link in the sidebar is followed (narrow screens close it). */
  onNavigate: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
};

/** Tooltip text with the shortcut, e.g. "Settings (⌘,)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${formatKeys(keys)})`;
}

/** The left panel: controls, the tag tree and the recently edited notes. */
export const Sidebar = memo(function Sidebar({
  store,
  catalog,
  open,
  currentNoteId,
  activeTag,
  onToggle,
  onNavigate,
  toggleRef,
}: SidebarProps) {
  const library = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const notes = library.status === "ready" ? library.notes : null;

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a")) onNavigate();
  };

  return (
    <aside
      id="sidebar"
      className="sidebar"
      aria-label="Sidebar"
      hidden={!open}
      onClick={handleClick}
    >
      <div className="sidebar-bar" data-tauri-drag-region="">
        <button
          ref={toggleRef}
          type="button"
          className="icon-button"
          aria-label="Hide sidebar"
          aria-expanded="true"
          aria-controls="sidebar"
          title="Hide sidebar"
          onClick={onToggle}
        >
          <SidebarIcon />
        </button>
        <span className="sidebar-bar-space" data-tauri-drag-region="" />
        <Link
          to="/settings"
          className="icon-button"
          aria-label="Settings"
          title={withShortcut("Settings", SHORTCUTS.settings.keys)}
        >
          <GearIcon />
        </Link>
        <Link
          to="/notes/new"
          className="icon-button"
          aria-label="New note"
          title={withShortcut("New note", SHORTCUTS.newNote.keys)}
        >
          <NewNoteIcon />
        </Link>
      </div>
      <div className="sidebar-scroll">
        <SidebarTags store={store} library={library} activeTag={activeTag} />
        <nav className="sidebar-section" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="sidebar-heading">
            Recent
          </h2>
          {notes && notes.length === 0 && <p className="sidebar-hint">No notes yet.</p>}
          {notes && notes.length > 0 && (
            <ul className="recent-list">
              {notes.map((note) => (
                <RecentNote key={note.id} note={note} current={note.id === currentNoteId} />
              ))}
            </ul>
          )}
        </nav>
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
};

function SidebarTags({ store, library, activeTag }: SidebarTagsProps) {
  const [tree, setTree] = useState<readonly TagNode[] | null>(null);
  // Read again whenever a note changes; the old tree stays until then.
  useEffect(() => {
    let current = true;
    store
      .tags()
      .then(tagTree)
      .then(
        (next) => {
          if (current) setTree(next);
        },
        () => undefined, // The tree is a convenience; the note list shows errors.
      );
    return () => {
      current = false;
    };
  }, [store, library]);

  if (tree === null) return null;
  return (
    <nav className="sidebar-section" aria-labelledby="tags-heading">
      <h2 id="tags-heading" className="sidebar-heading">
        Tags
      </h2>
      {tree.length === 0 ? (
        <p className="sidebar-hint">
          Write <code>#tag</code> or <code>#parent#child</code> in a note.
        </p>
      ) : (
        <TagTreeView nodes={tree} activeTag={activeTag} />
      )}
    </nav>
  );
}
