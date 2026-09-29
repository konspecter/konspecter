import { useState } from "react";
import { tagLabel, type TagNode } from "../../domain/tag/tags";
import { ChevronIcon } from "./icons";
import { TagLink } from "./TagLink";

type TagTreeViewProps = {
  nodes: readonly TagNode[];
  /** The tag the note list is filtered by; its branch starts expanded. */
  activeTag?: string | null;
};

/** Nested tag hierarchy with collapsible branches; each tag links to its notes. */
export function TagTreeView({ nodes, activeTag = null }: TagTreeViewProps) {
  return (
    <ul className="tag-tree">
      {nodes.map((node) => (
        <TagTreeItem key={node.tag.name} node={node} activeTag={activeTag} />
      ))}
    </ul>
  );
}

function TagTreeItem({ node, activeTag }: { node: TagNode; activeTag: string | null }) {
  const name = node.tag.name;
  const [expanded, setExpanded] = useState(activeTag !== null && activeTag.startsWith(`${name}#`));
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="tag-row">
        {hasChildren ? (
          <button
            type="button"
            className="tag-toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} #${name}`}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            <ChevronIcon />
          </button>
        ) : (
          <span className="tag-toggle" aria-hidden="true" />
        )}
        <TagLink tag={node.tag} label={`#${tagLabel(node.tag)}`} current={activeTag === name} />
        <span className="tag-count" aria-label={`${String(node.count)} notes`}>
          {node.count}
        </span>
      </div>
      {hasChildren && expanded && <TagTreeView nodes={node.children} activeTag={activeTag} />}
    </li>
  );
}
