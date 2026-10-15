import { Fragment, type Node, type ResolvedPos } from "prosemirror-model";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";

/**
 * Moving rows with ⌥↑/⌥↓ (Alt elsewhere), as the Markdown editor moves lines.
 * A row is a text block, or the list item it starts (with its nested items),
 * so a list item moves among its list's items; the rows the selection covers
 * move together, past the row above or below them in the same parent. In a
 * code block, the lines of its code move instead. Nothing moves past the
 * first or the last row (the key is then not taken).
 */
export function moveRow(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
    const tr =
      $from.parent.type.spec.code && $from.sameParent($to)
        ? moveCodeLines(state, direction)
        : moveBlocks(state, direction);
    if (!tr) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** The depth of the row around `$pos`: its text block, or the list item that text block starts. */
function rowDepth($pos: ResolvedPos): number {
  const depth = $pos.depth;
  const above = $pos.node(depth - 1);
  return depth > 1 && above.type.name === "list_item" && $pos.index(depth - 1) === 0
    ? depth - 1
    : depth;
}

/** The rows the selection covers: their parent's depth and their indexes in it. */
function selectedRows(state: EditorState): { depth: number; start: number; end: number } | null {
  const { $from, $to } = state.selection;
  const from = rowDepth($from);
  const to = rowDepth($to);
  if (from === to && $from.node(from - 1) === $to.node(to - 1)) {
    return { depth: from - 1, start: $from.index(from - 1), end: $to.index(to - 1) + 1 };
  }
  // Rows in different parents: the blocks around both that share one.
  const range = $from.blockRange($to);
  return range && { depth: range.depth, start: range.startIndex, end: range.endIndex };
}

function moveBlocks(state: EditorState, direction: -1 | 1): Transaction | null {
  const rows = selectedRows(state);
  if (!rows) return null;
  const { $from } = state.selection;
  const parent = $from.node(rows.depth);
  const neighbour = direction < 0 ? rows.start - 1 : rows.end;
  if (neighbour < 0 || neighbour >= parent.childCount) return null;
  const other = parent.child(neighbour);

  let from = $from.start(rows.depth);
  for (let index = 0; index < rows.start; index++) from += parent.child(index).nodeSize;
  const moved: Node[] = [];
  for (let index = rows.start; index < rows.end; index++) moved.push(parent.child(index));
  const to = from + moved.reduce((size, node) => size + node.nodeSize, 0);

  const swapped = Fragment.from(direction < 0 ? [...moved, other] : [other, ...moved]);
  const first = Math.min(rows.start, neighbour);
  // Only where the parent allows the new order (a list item starts with its text).
  if (!parent.canReplace(first, first + moved.length + 1, swapped)) return null;
  const tr = state.tr.replaceWith(
    direction < 0 ? from - other.nodeSize : from,
    direction < 0 ? to : to + other.nodeSize,
    swapped,
  );
  return withSelectionMoved(tr, state, direction * other.nodeSize);
}

function moveCodeLines(state: EditorState, direction: -1 | 1): Transaction | null {
  const { $from, $to } = state.selection;
  const block = $from.parent;
  const lines = block.textContent.split("\n");
  const lineAt = (offset: number) => block.textContent.slice(0, offset).split("\n").length - 1;
  const first = lineAt($from.parentOffset);
  const last = lineAt($to.parentOffset);
  const neighbour = direction < 0 ? first - 1 : last + 1;
  const other = lines[neighbour];
  if (other === undefined) return null;

  const moved = lines.slice(first, last + 1);
  const reordered =
    direction < 0
      ? [...lines.slice(0, neighbour), ...moved, other, ...lines.slice(last + 1)]
      : [...lines.slice(0, first), other, ...moved, ...lines.slice(neighbour + 1)];
  const start = $from.start();
  const tr = state.tr.replaceWith(
    start,
    start + block.content.size,
    state.schema.text(reordered.join("\n")),
  );
  return withSelectionMoved(tr, state, direction * (other.length + 1));
}

/** `tr` with the selection where its rows went: `shift` positions on. */
function withSelectionMoved(tr: Transaction, state: EditorState, shift: number): Transaction {
  const { anchor, head } = state.selection;
  return tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
}
