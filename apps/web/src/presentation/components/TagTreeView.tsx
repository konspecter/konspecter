import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import type { NoteSummary } from "../../application/notes/note-catalog";
import type { Tag, TagNode } from "../../domain/tag/tags";
import { ChevronIcon, DocumentIcon, FolderIcon, FolderOpenIcon } from "./icons";
import { summaryTitle } from "./note-title";
import { t, tn } from "../i18n/i18n";

type TagTreeViewProps = {
  nodes: readonly TagNode[];
  /** The tag the note list is filtered by; its folder and the ones above it start open. */
  activeTag?: string | null;
  /** The note open in the main area; marked where it appears. */
  currentNoteId?: string | null;
  /**
   * The notes inside a tag (tagged with it exactly). A new function means the
   * notes changed: open folders read them again.
   */
  loadNotes: (tag: Tag) => Promise<readonly NoteSummary[]>;
};

/** The note list filtered to the tag and the tags below it (a search for `#tag`). */
function tagPath(tag: Tag): string {
  return `/?q=${encodeURIComponent(`#${tag.name}`)}`;
}

/**
 * The tags as a project tree: each tag is a folder holding its child tags,
 * then the notes tagged with it. A folder's name opens its filtered note list.
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
  activeTag: string | null;
  currentNoteId: string | null;
  loadNotes: TagTreeViewProps["loadNotes"];
};

/** The row's indentation level, read by the stylesheet. */
function indent(depth: number): CSSProperties {
  return { "--depth": depth } as CSSProperties;
}

function TagFolder({ node, depth, activeTag, currentNoteId, loadNotes }: TagFolderProps) {
  const { tag } = node;
  const [expanded, setExpanded] = useState(
    activeTag !== null && (activeTag === tag.name || activeTag.startsWith(`${tag.name}#`)),
  );
  const [notes, setNotes] = useState<readonly NoteSummary[]>([]);

  // Read while open; the old notes stay until the new ones arrive.
  useEffect(() => {
    if (!expanded) return;
    let current = true;
    loadNotes(tag).then(
      (next) => {
        if (current) setNotes(next);
      },
      () => undefined, // The tree is a convenience; the note list shows errors.
    );
    return () => {
      current = false;
    };
  }, [expanded, loadNotes, tag]);

  return (
    <li>
      <div className="tree-row" style={indent(depth)}>
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
        <ul className="tree-group" style={indent(depth + 1)}>
          {node.children.map((child) => (
            <TagFolder
              key={child.tag.name}
              node={child}
              depth={depth + 1}
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
