import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "react-router";
import type { NoteSummary } from "../../application/notes/note-catalog";
import type { PinKey } from "../../domain/document/document";
import { outlineTree, type OutlineNode } from "../../domain/document/outline";
import { tagTreeContains, type Tag, type TagNode } from "../../domain/tag/tags";
import {
  ChevronIcon,
  DocumentIcon,
  FolderIcon,
  FolderOpenIcon,
  HeadingIcon,
} from "@konspecter/ui/icons";
import { isMac } from "../app/shortcuts";
import { headingPath } from "./note-heading";
import { summaryTitle } from "./note-title";
import { t, tn } from "../i18n/i18n";

type TagTreeViewProps = {
  nodes: readonly TagNode[];
  /** The notes at the root, after the folders: those without a tag. */
  notes?: readonly NoteSummary[];
  /** The tag the note list is filtered by; its folders and the ones above them start open. */
  activeTag?: string | null;
  /** The note open in the main area; marked where it appears. */
  currentNoteId?: string | null;
  /** The notes list their headings under them (`NoteSummary.headings`). */
  headings?: boolean;
  /**
   * The notes inside a folder, from its `noteIds`. A new function means the
   * notes changed: open folders read them again.
   */
  loadNotes: (noteIds: readonly string[]) => Promise<readonly NoteSummary[]>;
  /** How deep the tree starts: 1 under a folder's root (several folders). */
  depth?: number;
  /** The root's name, when the tree is under one; ← goes there. */
  parent?: RefObject<HTMLElement | null>;
};

/** The note list filtered to the tag (a search for `#tag`). */
function tagPath(tag: Tag): string {
  return `/?q=${encodeURIComponent(`#${tag.name}`)}`;
}

/**
 * The tags as a project tree: each tag is a folder holding its child tags,
 * then its notes; a tag with several parents is a folder under each, holding
 * the notes whose chains lead there. A folder's name opens its filtered note
 * list. The notes without a tag are at the root, after the folders. With
 * `headings`, a note holds its outline: its headings, nested as in the text.
 */
export function TagTreeView({
  nodes,
  notes = [],
  activeTag = null,
  currentNoteId = null,
  headings = false,
  loadNotes,
  depth = 0,
  parent,
}: TagTreeViewProps) {
  const onNoteKey = parent
    ? (event: KeyboardEvent) => {
        toLabel(event, parent);
      }
    : undefined;
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TagFolder
          key={node.tag.name}
          node={node}
          chain={node.tag.name}
          depth={depth}
          parent={parent}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          headings={headings}
          loadNotes={loadNotes}
        />
      ))}
      {notes.map((note) => (
        <TreeDocument
          key={note.id}
          note={note}
          depth={depth}
          current={note.id === currentNoteId}
          headings={headings}
          {...(onNoteKey ? { onKeyDown: onNoteKey } : {})}
        />
      ))}
    </ul>
  );
}

type FolderRootProps = {
  /** The folder's id, on its row for the context menu. */
  id: string;
  /** Its alias, or its own name. */
  label: string;
  /** False while the folder cannot be opened: it has nothing under it. */
  available: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** What is under it: its tree, which ← brings back to `parent`. */
  children: (parent: RefObject<HTMLElement | null>) => ReactNode;
};

/**
 * A connected folder at the root of the tree, when there are several
 * (ADR-030): its tags and notes under it. Its name folds and unfolds it.
 */
export function FolderRoot({
  id,
  label,
  available,
  expanded,
  onExpandedChange,
  children,
}: FolderRootProps) {
  const name = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const open = expanded && available;
  const onRowKey = (event: KeyboardEvent) => {
    branchKeys(event, { expanded: open, setExpanded: onExpandedChange, label: name, group }, () => {
      // Nothing is above a root.
    });
  };
  const shown = available ? label : t("library.unavailable", { folder: label });
  return (
    <li>
      <div className="tree-row" style={indent(0)} onKeyDown={onRowKey}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={open}
          disabled={!available}
          aria-label={t(open ? "tree.collapseFolder" : "tree.expandFolder", { folder: label })}
          onClick={() => {
            onExpandedChange(!open);
          }}
        >
          <ChevronIcon />
          {open ? <FolderOpenIcon /> : <FolderIcon />}
        </button>
        <button
          ref={name}
          type="button"
          className="tree-label tree-root"
          data-folder-id={id}
          aria-expanded={open}
          onClick={() => {
            if (available) onExpandedChange(!open);
          }}
        >
          {shown}
        </button>
      </div>
      {open && (
        <div ref={group} className="tree-group" style={indent(1)}>
          {children(name)}
        </div>
      )}
    </li>
  );
}

type TagFolderProps = {
  node: TagNode;
  /** The tags from the root to this folder, as a chain: `java#collections`. */
  chain: string;
  depth: number;
  /** The name of the folder this one is in; ← goes there. */
  parent?: RefObject<HTMLElement | null> | undefined;
  activeTag: string | null;
  currentNoteId: string | null;
  headings: boolean;
  loadNotes: TagTreeViewProps["loadNotes"];
};

/** The arrow key pressed alone, if it is ← or →. */
function sideways(event: KeyboardEvent): "left" | "right" | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === "ArrowLeft") return "left";
  return event.key === "ArrowRight" ? "right" : null;
}

/** The row's indentation level, read by the stylesheet. */
function indent(depth: number): CSSProperties {
  return { "--depth": depth } as CSSProperties;
}

/** A row that opens to show more rows: a folder, a note's outline, a heading's sub-headings. */
type Branch = {
  readonly expanded: boolean;
  readonly setExpanded: (expanded: boolean) => void;
  /** The row's name, a link (or a button: a folder's root). */
  readonly label: RefObject<HTMLElement | null>;
  /** Its rows, while open. */
  readonly group: RefObject<HTMLElement | null>;
};

/**
 * The keys on a branch's row: → opens it, then goes to its first entry; ←
 * closes it, then goes `up` (to the branch it is in).
 */
function branchKeys(event: KeyboardEvent, branch: Branch, up: (event: KeyboardEvent) => void) {
  const key = sideways(event);
  if (key === null) return;
  if (key === "left" && !branch.expanded) {
    up(event);
    return;
  }
  event.preventDefault();
  if (key === "right") {
    if (branch.expanded) branch.group.current?.querySelector<HTMLElement>("a")?.focus();
    else branch.setExpanded(true);
  } else {
    branch.setExpanded(false);
    branch.label.current?.focus();
  }
}

/** ← on a row inside a branch: to the branch's name. */
function toLabel(event: KeyboardEvent, label: RefObject<HTMLElement | null>) {
  if (sideways(event) !== "left") return;
  event.preventDefault();
  label.current?.focus();
}

function TagFolder({
  node,
  chain,
  depth,
  parent,
  activeTag,
  currentNoteId,
  headings,
  loadNotes,
}: TagFolderProps) {
  const { tag, noteIds } = node;
  const label = useRef<HTMLAnchorElement>(null);
  const group = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(
    activeTag !== null && (activeTag === tag.name || tagTreeContains(node, activeTag)),
  );
  const [notes, setNotes] = useState<readonly NoteSummary[]>([]);

  // Read while open; the old notes stay until the new ones arrive.
  useEffect(() => {
    if (!expanded) return;
    let current = true;
    loadNotes(noteIds).then(
      (next) => {
        if (current) setNotes(next);
      },
      () => undefined, // The tree is a convenience; the note list shows errors.
    );
    return () => {
      current = false;
    };
  }, [expanded, loadNotes, noteIds]);

  const onRowKey = (event: KeyboardEvent) => {
    branchKeys(event, { expanded, setExpanded, label, group }, (up) => {
      up.preventDefault();
      parent?.current?.focus();
    });
  };
  const onNoteKey = (event: KeyboardEvent) => {
    toLabel(event, label);
  };

  return (
    <li>
      <div className="tree-row" style={indent(depth)} onKeyDown={onRowKey}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={expanded}
          aria-label={t(expanded ? "tree.collapse" : "tree.expand", { tag: tag.name })}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          <ChevronIcon />
          {expanded ? <FolderOpenIcon /> : <FolderIcon />}
        </button>
        <Link
          ref={label}
          to={tagPath(tag)}
          // A new note made from the list it opens starts with this chain (`new-note.ts`).
          state={{ tagChain: chain }}
          className="tree-label"
          {...(activeTag === tag.name ? { "aria-current": "page" } : {})}
          onClick={() => {
            setExpanded(true);
          }}
        >
          {node.label}
        </Link>
        <span className="tree-count" aria-label={tn("tree.notes", node.count)}>
          {node.count}
        </span>
      </div>
      {expanded && (
        <ul ref={group} className="tree-group" style={indent(depth + 1)}>
          {node.children.map((child) => (
            <TagFolder
              key={child.tag.name}
              node={child}
              chain={`${chain}#${child.tag.name}`}
              depth={depth + 1}
              parent={label}
              activeTag={activeTag}
              currentNoteId={currentNoteId}
              headings={headings}
              loadNotes={loadNotes}
            />
          ))}
          {notes.map((note) => (
            <TreeDocument
              key={note.id}
              note={note}
              depth={depth + 1}
              current={note.id === currentNoteId}
              headings={headings}
              onKeyDown={onNoteKey}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A note in the tree, and in the recent notes: its icon and title, opening it.
 * A pinned note (Recent) shows its key as a keycap before the icon, where a
 * folder has its chevron. With `headings`, a note that has some opens like a
 * folder to show them (`OutlinedDocument`).
 */
export const TreeDocument = memo(function TreeDocument({
  note,
  depth,
  current,
  className,
  pin,
  headings = false,
  onKeyDown,
}: {
  note: NoteSummary;
  depth: number;
  current: boolean;
  /** Another class for the row (`recent-link`). */
  className?: string;
  /** The key the note is pinned to (Mod+Alt+1…0 pins it, Mod+1…0 opens it). */
  pin?: PinKey;
  /** The note lists its headings under it. */
  headings?: boolean;
  /** ← in a folder goes to the folder's name. */
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  const outline = useMemo(
    () => (headings ? outlineTree(note.headings) : []),
    [headings, note.headings],
  );
  if (outline.length > 0) {
    return (
      <OutlinedDocument
        note={note}
        depth={depth}
        current={current}
        outline={outline}
        {...(onKeyDown ? { onKeyDown } : {})}
      />
    );
  }
  return (
    <li>
      <Link
        to={`/conspects/${encodeURIComponent(note.id)}`}
        // The sidebar's context menu offers to delete the note (`Sidebar.tsx`).
        data-note-id={note.id}
        className={className ? `tree-row tree-document ${className}` : "tree-row tree-document"}
        style={indent(depth)}
        {...(current ? { "aria-current": "page" } : {})}
        {...(onKeyDown ? { onKeyDown } : {})}
        {...(pin === undefined
          ? {}
          : { "aria-keyshortcuts": `${isMac() ? "Meta" : "Control"}+${pin}` })}
      >
        {pin !== undefined && (
          <span className="tree-pin" aria-hidden="true">
            {pin}
          </span>
        )}
        <DocumentIcon />
        <span className="tree-label">{summaryTitle(note)}</span>
      </Link>
    </li>
  );
});

type OutlinedDocumentProps = {
  note: NoteSummary;
  depth: number;
  current: boolean;
  outline: readonly OutlineNode[];
  /** ← on the folded note: to the folder's name. */
  onKeyDown?: (event: KeyboardEvent) => void;
};

/**
 * A note with headings: a chevron before its icon, and its outline under it
 * while open. Folded, except the open note: it opens whenever it becomes the
 * open one, so the tree shows where the text is.
 */
function OutlinedDocument({ note, depth, current, outline, onKeyDown }: OutlinedDocumentProps) {
  const label = useRef<HTMLAnchorElement>(null);
  const group = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(current);
  const [wasCurrent, setWasCurrent] = useState(current);
  if (current !== wasCurrent) {
    setWasCurrent(current);
    if (current) setExpanded(true);
  }
  const title = summaryTitle(note);
  const onRowKey = (event: KeyboardEvent) => {
    branchKeys(event, { expanded, setExpanded, label, group }, (up) => onKeyDown?.(up));
  };

  return (
    <li>
      <div className="tree-row" style={indent(depth)} onKeyDown={onRowKey}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={expanded}
          aria-label={t(expanded ? "tree.collapseHeadings" : "tree.expandHeadings", { title })}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          <ChevronIcon />
          <DocumentIcon />
        </button>
        <Link
          ref={label}
          to={`/conspects/${encodeURIComponent(note.id)}`}
          data-note-id={note.id}
          className="tree-label"
          {...(current ? { "aria-current": "page" } : {})}
        >
          {title}
        </Link>
      </div>
      {expanded && (
        <ul ref={group} className="tree-group" style={indent(depth + 1)}>
          {outline.map((node) => (
            <OutlineEntry
              key={node.heading.index}
              node={node}
              noteId={note.id}
              depth={depth + 1}
              parent={label}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type OutlineEntryProps = {
  node: OutlineNode;
  noteId: string;
  depth: number;
  /** The name of the note or heading it is under; ← goes there. */
  parent: RefObject<HTMLAnchorElement | null>;
};

/**
 * A heading in a note's outline, opening the note scrolled to it. One with
 * sub-headings folds like a folder, open to begin with.
 */
function OutlineEntry({ node, noteId, depth, parent }: OutlineEntryProps) {
  const { heading, children } = node;
  const label = useRef<HTMLAnchorElement>(null);
  const group = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(true);
  const to = headingPath(noteId, heading.index);

  if (children.length === 0) {
    return (
      <li>
        <Link
          to={to}
          className="tree-row tree-document tree-heading"
          style={indent(depth)}
          onKeyDown={(event) => {
            toLabel(event, parent);
          }}
        >
          <HeadingIcon />
          <span className="tree-label">{heading.text}</span>
        </Link>
      </li>
    );
  }
  const onRowKey = (event: KeyboardEvent) => {
    branchKeys(event, { expanded, setExpanded, label, group }, (up) => {
      toLabel(up, parent);
    });
  };
  return (
    <li>
      <div className="tree-row tree-heading" style={indent(depth)} onKeyDown={onRowKey}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={expanded}
          aria-label={t(expanded ? "tree.collapseHeading" : "tree.expandHeading", {
            heading: heading.text,
          })}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          <ChevronIcon />
          <HeadingIcon />
        </button>
        <Link ref={label} to={to} className="tree-label">
          {heading.text}
        </Link>
      </div>
      {expanded && (
        <ul ref={group} className="tree-group" style={indent(depth + 1)}>
          {children.map((child) => (
            <OutlineEntry
              key={child.heading.index}
              node={child}
              noteId={noteId}
              depth={depth + 1}
              parent={label}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
