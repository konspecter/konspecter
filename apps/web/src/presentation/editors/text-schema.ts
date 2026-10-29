import MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import { defaultMarkdownParser, MarkdownParser, schema as commonMark } from "prosemirror-markdown";
import { Schema } from "prosemirror-model";

type NodeName = typeof commonMark extends Schema<infer N, string> ? N : never;
type MarkName = typeof commonMark extends Schema<string, infer M> ? M : never;

/**
 * Whether a list is tight: the editor marks its own (`data-tight`); a list
 * from a web page is tight unless its items hold paragraphs, which is how
 * rendered Markdown shows a loose one.
 */
function tightList(list: HTMLElement): boolean {
  if (list.hasAttribute("data-tight")) return true;
  return ![...list.children].some(
    (item) => item.tagName === "LI" && [...item.children].some((child) => child.tagName === "P"),
  );
}

/**
 * The text editor's schema: prosemirror-markdown's CommonMark schema, with
 * GFM task list items. A list item's `checked` is true or false for a task
 * (`[x]`, `[ ]`) and null for an ordinary item.
 */
export const textSchema = new Schema<NodeName, MarkName>({
  nodes: commonMark.spec.nodes
    .update("bullet_list", {
      ...commonMark.spec.nodes.get("bullet_list"),
      parseDOM: [{ tag: "ul", getAttrs: (dom) => ({ tight: tightList(dom) }) }],
    })
    .update("ordered_list", {
      ...commonMark.spec.nodes.get("ordered_list"),
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom) => ({
            order: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1,
            tight: tightList(dom),
          }),
        },
      ],
    })
    .update("list_item", {
      ...commonMark.spec.nodes.get("list_item"),
      attrs: { checked: { default: null } },
      parseDOM: [
        {
          tag: "li",
          getAttrs: (dom) => {
            const checked = dom.getAttribute("data-checked");
            if (checked !== null) return { checked: checked === "true" };
            return { checked: pastedTaskBox(dom) };
          },
        },
      ],
      toDOM: (node) => [
        "li",
        node.attrs.checked === null ? {} : { "data-checked": String(node.attrs.checked) },
        0,
      ],
    }),
  marks: commonMark.spec.marks,
});

/**
 * A checklist item from a web page (GitHub, a rendered Markdown page): its
 * checkbox, an `<input>` the item's text follows, says whether it is ticked.
 * Null for an item without one; a box in a nested item is that item's. The
 * box itself is not text, so the paste leaves it out.
 */
function pastedTaskBox(item: HTMLElement): boolean | null {
  const box = item.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!box || box.closest("li") !== item) return null;
  return box.hasAttribute("checked") || box.checked;
}

/** `[ ]` or `[x]` at the start of an item's text, then a space (or nothing). */
const TASK_MARKER = /^\[([ xX])\](?:[ \t]+|$)/;

/**
 * Reads GFM task list items (markdown-it has no rule for them): a list item
 * whose first paragraph starts with `[ ]` or `[x]` gets the token attribute
 * `checked`, and the marker leaves its text.
 */
function taskItems(state: StateCore): void {
  const { tokens } = state;
  tokens.forEach((token, index) => {
    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    if (
      token.type !== "list_item_open" ||
      paragraph?.type !== "paragraph_open" ||
      inline?.type !== "inline"
    ) {
      return;
    }
    const marker = TASK_MARKER.exec(inline.content);
    const first = inline.children?.[0];
    if (!marker || first?.type !== "text" || !first.content.startsWith(marker[0])) return;
    first.content = first.content.slice(marker[0].length);
    inline.content = inline.content.slice(marker[0].length);
    token.attrSet("checked", String(marker[1] !== " "));
  });
}

const tokenizer = MarkdownIt("commonmark", { html: false });
// After the text tokens are joined; the marker is matched in the source, so `\[ ]` is no task.
tokenizer.core.ruler.after("text_join", "task_items", taskItems);

/** Markdown to the text editor's documents: prosemirror-markdown's parser, with task items. */
export const textMarkdownParser = new MarkdownParser(textSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: {
    block: "list_item",
    getAttrs: (token) => {
      const checked = token.attrGet("checked");
      return { checked: checked === null ? null : checked === "true" };
    },
  },
});
