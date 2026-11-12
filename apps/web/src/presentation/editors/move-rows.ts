import { Fragment, type Node, type ResolvedPos } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { centreInView } from "./place";

/**
 * Moving rows with ⌥↑/⌥↓ (Alt elsewhere), as the Markdown editor moves lines.
 * A row is a text block, or the list item it starts (with its nested items),
 * so a list item moves among its list's items; the rows the selection covers
 * move together, past the row above or below them in the same parent. In a
 * code block, the lines of its code move instead. Nothing moves past the
 * first or the last row (the key is then not taken). In an editor on screen,
 * the caret's line is kept in the middle of it as the rows move.
 */
export function moveRow(direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    const { $from, $to } = state.selection;
    if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
    const tr =
      $from.parent.type.spec.code && $from.sameParent($to)
        ? moveCodeLines(state, direction)
        : moveBlocks(state, direction);
    if (!tr) return false;
    if (!dispatch) return true;
    tr.setMeta(movingKey, "moved");
    if (view) {
      dispatch(tr);
      centreInView(view.coordsAtPos(view.state.selection.head));
    } else {
      dispatch(tr.scrollIntoView());
    }
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

/**
 * How the rows being moved are marked: they light up (`enter`) at the first
 * move, stay lit while ⌥ is held (`held`), and fade out (`leave`) once it is
 * released; each step of the fade takes `MOVE_FADE_MS`.
 */
export type MovePhase = "idle" | "enter" | "held" | "leave";

type MoveEvent = "moved" | "released" | "faded";

/** The fade in and out of the rows being moved, in milliseconds (as in `editors.css`). */
export const MOVE_FADE_MS = 150;

export function nextMovePhase(phase: MovePhase, event: MoveEvent): MovePhase {
  switch (event) {
    case "moved":
      return phase === "enter" || phase === "held" ? "held" : "enter";
    case "released":
      return phase === "enter" || phase === "held" ? "leave" : phase;
    case "faded":
      return phase === "leave" ? "idle" : phase;
  }
}

/** A row being moved: a whole block (`node`), or lines of code inside one. */
type MovedRange = { readonly from: number; readonly to: number; readonly node: boolean };

type MovingState = { readonly phase: MovePhase; readonly ranges: readonly MovedRange[] };

const movingKey = new PluginKey<MovingState>("moving-rows");

const NOT_MOVING: MovingState = { phase: "idle", ranges: [] };

/** The rows the selection covers in `state`, just after they moved. */
function movedRanges(state: EditorState): MovedRange[] {
  const { $from, $to } = state.selection;
  if ($from.parent.type.spec.code && $from.sameParent($to)) {
    const text = $from.parent.textContent;
    const start = $from.start();
    const from = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
    const end = text.indexOf("\n", $to.parentOffset);
    return [{ from: start + from, to: start + (end < 0 ? text.length : end), node: false }];
  }
  const rows = selectedRows(state);
  if (!rows) return [];
  const parent = $from.node(rows.depth);
  const ranges: MovedRange[] = [];
  let pos = $from.start(rows.depth);
  for (let index = 0; index < rows.end; index++) {
    const size = parent.child(index).nodeSize;
    if (index >= rows.start) ranges.push({ from: pos, to: pos + size, node: true });
    pos += size;
  }
  return ranges;
}

/**
 * Marks the rows that ⌥↑/⌥↓ move, in the colour of the selected search match,
 * until ⌥ is released (`.moving-row` in `editors.css`).
 */
export const movingRows: Plugin<MovingState> = new Plugin<MovingState>({
  key: movingKey,
  state: {
    init: () => NOT_MOVING,
    apply(tr, previous, _old, state) {
      const event = tr.getMeta(movingKey) as MoveEvent | undefined;
      if (event === "moved") {
        return { phase: nextMovePhase(previous.phase, event), ranges: movedRanges(state) };
      }
      const phase = event ? nextMovePhase(previous.phase, event) : previous.phase;
      if (phase === "idle") return NOT_MOVING;
      const ranges = tr.docChanged
        ? previous.ranges
            .map(({ from, to, node }) => ({
              from: tr.mapping.map(from, 1),
              to: tr.mapping.map(to, -1),
              node,
            }))
            .filter(({ from, to }) => from < to)
        : previous.ranges;
      return phase === previous.phase && ranges === previous.ranges ? previous : { phase, ranges };
    },
  },
  props: {
    decorations(state) {
      const moving = movingKey.getState(state);
      if (!moving || moving.phase === "idle") return null;
      const attrs = { class: `moving-row moving-row-${moving.phase}` };
      return DecorationSet.create(
        state.doc,
        moving.ranges.map(({ from, to, node }) =>
          node ? Decoration.node(from, to, attrs) : Decoration.inline(from, to, attrs),
        ),
      );
    },
  },
  view(view) {
    let fading: ReturnType<typeof setTimeout> | undefined;
    const send = (event: MoveEvent) => {
      view.dispatch(view.state.tr.setMeta(movingKey, event));
    };
    const release = () => {
      const phase = movingKey.getState(view.state)?.phase;
      if (phase === "enter" || phase === "held") send("released");
    };
    // ⌥ let go anywhere, a key pressed without it, or the window left.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") release();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) release();
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", release);
    return {
      update() {
        const leaving = movingKey.getState(view.state)?.phase === "leave";
        if (leaving && fading === undefined) {
          fading = setTimeout(() => {
            fading = undefined;
            send("faded");
          }, MOVE_FADE_MS);
        } else if (!leaving && fading !== undefined) {
          clearTimeout(fading);
          fading = undefined;
        }
      },
      destroy() {
        clearTimeout(fading);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("blur", release);
      },
    };
  },
});
