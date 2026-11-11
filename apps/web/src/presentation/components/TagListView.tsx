import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { NoteSummary } from "../../application/notes/note-catalog";
import type { TagNode } from "../../domain/tag/tags";
import { ChevronIcon, FolderIcon, FolderOpenIcon } from "@konspecter/ui/icons";
import { indent, tagPath, TreeDocument } from "./TagTreeView";
import { t, tn } from "../i18n/i18n";

type TagListViewProps = {
  nodes: readonly TagNode[];
  /** The notes at the root, after the folders: those without a tag. */
  notes?: readonly NoteSummary[];
  /** The tag the note list is filtered by: its folder's name is marked. */
  activeTag?: string | null;
  /** The note open in the main area; marked where it appears. */
  currentNoteId?: string | null;
  /** The notes inside a folder, from its `noteIds`. A new function means the notes changed. */
  loadNotes: (noteIds: readonly string[]) => Promise<readonly NoteSummary[]>;
  /** How deep the list starts: 1 under a folder's root (several folders). */
  depth?: number;
  /** What the top level is called, for the back row: the folder's root, or the tags pane. */
  rootName?: string;
};

/** A folder below the open one, with the notes in it, `level` folders down. */
type Group = { readonly node: TagNode; readonly chain: string; readonly level: number };

/** The folders the path goes through, from the root; it stops where a name is gone. */
function trail(nodes: readonly TagNode[], path: readonly string[]): TagNode[] {
  const found: TagNode[] = [];
  let level = nodes;
  for (const name of path) {
    const next = level.find((node) => node.tag.name === name);
    if (!next) break;
    found.push(next);
    level = next.children;
  }
  return found;
}

/** Every folder below `node`, depth first, as the tree would show them open. */
function groupsBelow(node: TagNode, chain: string, level = 1): Group[] {
  return node.children.flatMap((child) => {
    const childChain = `${chain}#${child.tag.name}`;
    return [
      { node: child, chain: childChain, level },
      ...groupsBelow(child, childChain, level + 1),
    ];
  });
}

/** A folder's row as read out: its name, then how many notes it holds. */
function folderName(node: TagNode): string {
  return `${node.label}, ${tn("tree.notes", node.count)}`;
}

/**
 * The tags on a small screen, where a tree's chevrons are too small to tap:
 * one folder at a time. A folder's row opens it in place of the list; there,
 * a row goes back up, the folder's name opens its filtered note list, and
 * under its folders and notes come the notes of every folder below it,
 * grouped by tag under a thin line with the tag's name, each level a little
 * further in. At the root: the top folders and the notes without a tag.
 */
export function TagListView({
  nodes,
  notes = [],
  activeTag = null,
  currentNoteId = null,
  loadNotes,
  depth = 0,
  rootName = t("sidebar.tags"),
}: TagListViewProps) {
  // The folders gone into, by name: it stays as the tags are read again.
  const [path, setPath] = useState<readonly string[]>([]);

  const folders = trail(nodes, path);
  // Where the list is: the path up to a folder no longer there (its tag went).
  const here = folders.map((folder) => folder.tag.name);
  const open = folders.at(-1) ?? null;
  const chain = here.join("#");
  const groups = open ? groupsBelow(open, chain) : [];

  // The open folder's notes and those below it, read together; the old stay until then.
  const [loaded, setLoaded] = useState<ReadonlyMap<string, NoteSummary>>(new Map());
  useEffect(() => {
    if (!open) return;
    const below = groupsBelow(open, "").flatMap((group) => group.node.noteIds);
    const ids = new Set([...open.noteIds, ...below]);
    let current = true;
    loadNotes([...ids]).then(
      (next) => {
        if (current) setLoaded(new Map(next.map((note) => [note.id, note])));
      },
      () => undefined, // The list is a convenience; the note list shows errors.
    );
    return () => {
      current = false;
    };
  }, [open, loadNotes]);
  // By title, as `loadNotes` sorts them.
  const notesOf = (node: TagNode) => {
    const ids = new Set(node.noteIds);
    return [...loaded.values()].filter((note) => ids.has(note.id));
  };

  // Going in or out starts at the top, with the focus on the row that brought it there.
  const list = useRef<HTMLUListElement>(null);
  // The folder left (its row takes the focus), or null for one gone into (the back row does).
  const focusAfter = useRef<{ readonly left: string | null } | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    const target = focusAfter.current;
    if (!element || target === null) return;
    focusAfter.current = null;
    const scroller = element.closest(".sidebar-pane-body");
    // Under a folder's root (several folders), the root's row comes to the top, not the pane's.
    const root = element.closest(".tree-group")?.previousElementSibling;
    if (scroller && root) {
      const above = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (above < 0) scroller.scrollTop += above;
    } else if (scroller) {
      scroller.scrollTop = 0;
    }
    const row =
      target.left === null
        ? element.querySelector<HTMLElement>(".tag-list-back")
        : [...element.querySelectorAll<HTMLElement>(".tag-list-folder")].find(
            (each) => each.dataset.tag === target.left,
          );
    row?.focus({ focusVisible: false, preventScroll: true });
  }, [path]);
  const go = (next: readonly string[], left: string | null) => {
    focusAfter.current = { left };
    setPath(next);
  };

  // As a phone's back button: the name of where it goes.
  const upName = folders.at(-2)?.label ?? rootName;
  return (
    <ul ref={list} className="tree tag-list">
      {open && (
        <>
          <li>
            <button
              type="button"
              className="tree-row tree-document tag-list-back"
              style={indent(depth)}
              aria-label={t("tree.back", { folder: upName })}
              onClick={() => {
                go(here.slice(0, -1), open.tag.name);
              }}
            >
              <ChevronIcon />
              <span className="tree-label">{upName}</span>
            </button>
          </li>
          <li>
            <Link
              to={tagPath(open.tag)}
              // A new note made from the list it opens starts with this chain (`new-note.ts`).
              state={{ tagChain: chain }}
              className="tree-row tree-document tag-list-open"
              style={indent(depth)}
              aria-label={folderName(open)}
              {...(activeTag === open.tag.name ? { "aria-current": "page" } : {})}
            >
              <FolderOpenIcon />
              <span className="tree-label">{open.label}</span>
              <span className="tree-count" aria-hidden="true">
                {open.count}
              </span>
            </Link>
          </li>
        </>
      )}
      {(open ? open.children : nodes).map((node) => (
        <li key={node.tag.name}>
          <button
            type="button"
            className="tree-row tree-document tag-list-folder"
            style={indent(depth)}
            data-tag={node.tag.name}
            aria-label={folderName(node)}
            onClick={() => {
              go([...here, node.tag.name], null);
            }}
          >
            <FolderIcon />
            <span className="tree-label">{node.label}</span>
            <span className="tree-count" aria-hidden="true">
              {node.count}
            </span>
            <ChevronIcon />
          </button>
        </li>
      ))}
      {(open ? notesOf(open) : notes).map((note) => (
        <TreeDocument key={note.id} note={note} depth={depth} current={note.id === currentNoteId} />
      ))}
      {groups.map((group) => (
        <li key={group.chain} className="tag-list-group">
          {/* Its list is named by the tag: the line is for the eye. */}
          <div
            className="tag-list-divider"
            style={indent(depth + group.level - 1)}
            aria-hidden="true"
          >
            <span>{group.node.label}</span>
          </div>
          <ul className="tag-list-notes" aria-label={group.node.label}>
            {notesOf(group.node).map((note) => (
              <TreeDocument
                key={note.id}
                note={note}
                depth={depth + group.level}
                current={note.id === currentNoteId}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
