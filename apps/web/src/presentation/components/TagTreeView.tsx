import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Link } from "react-router";
import type { NoteSummary } from "../../application/notes/note-catalog";
import { tagTreeContains, type Tag, type TagNode } from "../../domain/tag/tags";
import { ChevronIcon, DocumentIcon, FolderIcon, FolderOpenIcon } from "@konspecter/ui/icons";
import { summaryTitle } from "./note-title";
import { t, tn } from "../i18n/i18n";

type TagTreeViewProps = {
  nodes: readonly TagNode[];
  /** The tag the note list is filtered by; its folders and the ones above them start open. */
  activeTag?: string | null;
  /** The note open in the main area; marked where it appears. */
  currentNoteId?: string | null;
  /**
   * The notes inside a folder, from its `noteIds`. A new function means the
   * notes changed: open folders read them again.
   */
  loadNotes: (noteIds: readonly string[]) => Promise<readonly NoteSummary[]>;
};

/** The note list filtered to the tag (a search for `#tag`). */
function tagPath(tag: Tag): string {
  return `/?q=${encodeURIComponent(`#${tag.name}`)}`;
}

/**
 * The tags as a project tree: each tag is a folder holding its child tags,
 * then its notes; a tag with several parents is a folder under each, holding
 * the notes whose chains lead there. A folder's name opens its filtered note
 * list.
 */
export function TagTreeView({
  nodes,
  activeTag = null,
  currentNoteId = null,
  loadNotes,
}: TagTreeViewProps) {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TagFolder
          key={node.tag.name}
          node={node}
          depth={0}
          activeTag={activeTag}
          currentNoteId={currentNoteId}
          loadNotes={loadNotes}
        />
      ))}
    </ul>
  );
}

type TagFolderProps = {
  node: TagNode;
  depth: number;
  /** The name of the folder this one is in; ← goes there. */
  parent?: RefObject<HTMLAnchorElement | null>;
  activeTag: string | null;
  currentNoteId: string | null;
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

function TagFolder({ node, depth, parent, activeTag, currentNoteId, loadNotes }: TagFolderProps) {
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

  // → opens the folder, then goes to its first entry; ← closes it, then goes up.
  const onRowKey = (event: KeyboardEvent) => {
    const key = sideways(event);
    if (key === null) return;
    event.preventDefault();
    if (key === "right") {
      if (expanded) group.current?.querySelector<HTMLElement>("a")?.focus();
      else setExpanded(true);
    } else if (expanded) {
      setExpanded(false);
      label.current?.focus();
    } else {
      parent?.current?.focus();
    }
  };
  const onNoteKey = (event: KeyboardEvent) => {
    if (sideways(event) !== "left") return;
    event.preventDefault();
    label.current?.focus();
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
              depth={depth + 1}
              parent={label}
              activeTag={activeTag}
              currentNoteId={currentNoteId}
              loadNotes={loadNotes}
            />
          ))}
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                to={`/notes/${encodeURIComponent(note.id)}`}
                className="tree-row tree-document"
                style={indent(depth + 1)}
                {...(note.id === currentNoteId ? { "aria-current": "page" } : {})}
                onKeyDown={onNoteKey}
              >
                <DocumentIcon />
                <span className="tree-label">{summaryTitle(note)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
