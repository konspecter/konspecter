import { InputRule } from "prosemirror-inputrules";
import type { Node } from "prosemirror-model";
import { splitListItem } from "prosemirror-schema-list";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { t } from "../i18n/i18n";
import { textSchema } from "./text-schema";

const { list_item: listItem } = textSchema.nodes;

/** The list item whose first block holds the caret, with its position; null elsewhere. */
function itemAtCaret(state: EditorState): { item: Node; pos: number } | null {
  const { $from } = state.selection;
  if ($from.depth < 2) return null;
  const item = $from.node(-1);
  if (item.type !== listItem || $from.index(-1) !== 0) return null;
  return { item, pos: $from.before(-1) };
}

/**
 * Typing `[ ] ` or `[x] ` (also `[] `) at the start of a list item makes it a
 * task, unticked or ticked; the marker is not kept as text.
 */
export const taskInputRule = new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
  const found = itemAtCaret(state);
  if (!found || found.item.attrs.checked !== null) return null;
  return state.tr
    .delete(start, end)
    .setNodeAttribute(found.pos, "checked", match[1] === "x" || match[1] === "X");
});

/** Enter in a list item; the item it makes after a task is an unticked task. */
export const splitItem: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type !== listItem) continue;
    const task = node.attrs.checked !== null;
    return splitListItem(listItem, task ? { checked: false } : undefined)(state, dispatch);
  }
  return false;
};

/** Backspace at the start of a task's text makes it an ordinary list item. */
export const untask: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  const found = itemAtCaret(state);
  if (!empty || $from.parentOffset > 0 || !found || found.item.attrs.checked === null) {
    return false;
  }
  dispatch?.(state.tr.setNodeAttribute(found.pos, "checked", null));
  return true;
};

/** Ticks or unticks the task holding the caret (Mod-Enter). */
export const toggleTask: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type !== listItem || node.attrs.checked === null) continue;
    dispatch?.(state.tr.setNodeAttribute($from.before(depth), "checked", !node.attrs.checked));
    return true;
  }
  return false;
};

/**
 * A list item; a task shows a checkbox before its text, and clicking it ticks
 * the task (an edit like any other). The checkbox is not part of the text:
 * the caret never goes into it and clicking it keeps the selection.
 */
export class ListItemView implements NodeView {
  readonly dom: HTMLLIElement;
  readonly contentDOM: HTMLElement;
  readonly #box: HTMLInputElement | null = null;
  #node: Node;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.#node = node;
    this.dom = document.createElement("li");
    if (node.attrs.checked === null) {
      this.contentDOM = this.dom;
      return;
    }
    this.dom.className = "task-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "task-box";
    box.contentEditable = "false";
    box.tabIndex = -1;
    box.setAttribute("aria-label", t("editor.taskDone"));
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    // The box ticks itself; the edit then shows the same (a cancelled click
    // would put the box back as it was).
    box.addEventListener("click", () => {
      const pos = getPos();
      if (pos === undefined) return;
      const checked = this.#node.attrs.checked === true;
      view.dispatch(view.state.tr.setNodeAttribute(pos, "checked", !checked));
    });
    this.#box = box;
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "task-text";
    this.dom.append(box, this.contentDOM);
    this.#show(node);
  }

  #show(node: Node): void {
    const checked = node.attrs.checked === true;
    if (this.#box) this.#box.checked = checked;
    this.dom.dataset.checked = String(checked);
  }

  update(node: Node): boolean {
    // A task and an ordinary item are drawn differently: changing one into the other redraws it.
    if (node.type !== listItem || (node.attrs.checked === null) !== (this.#box === null)) {
      return false;
    }
    this.#node = node;
    if (this.#box) this.#show(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.#box !== null && event.target === this.#box;
  }

  ignoreMutation(
    mutation: MutationRecord | { type: "selection"; target: globalThis.Node },
  ): boolean {
    return (
      this.#box !== null &&
      (mutation.target === this.#box ||
        (mutation.type === "attributes" && mutation.target === this.dom))
    );
  }
}
