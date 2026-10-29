import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { defaultMarkdownSerializer, MarkdownSerializer } from "prosemirror-markdown";
import { Fragment, type Node } from "prosemirror-model";
import { t, type TextKey } from "../i18n/i18n";
import { textMarkdownParser } from "./text-schema";

export type TextEditorContent =
  | { readonly supported: true; readonly doc: Node }
  | { readonly supported: false; readonly reason: string };

/** A GFM-aware reference parser used only to compare documents. */
const reference = new MarkdownIt({ html: true, linkify: true });

// A GFM extension markdown-it does not parse; the text editor would escape it.
const FOOTNOTE = /\[\^[^\]\s]+\]/;

const FEATURE_NAMES: Record<string, TextKey> = {
  table_open: "editor.feature.tables",
  s_open: "editor.feature.strikethrough",
  html_block: "editor.feature.html",
  html_inline: "editor.feature.html",
};

/**
 * Converts a document body for the text editor, but only if the editor can
 * represent it without changing its meaning. The editor may still normalize
 * formatting (list markers, line wrapping, `Title\n===` headings).
 */
export function markdownToTextDoc(body: string): TextEditorContent {
  const features = new Set<TextKey>();
  if (FOOTNOTE.test(body)) features.add("editor.feature.footnotes");
  for (const token of flatten(reference.parse(body, {}))) {
    const name = FEATURE_NAMES[token.type];
    if (name) features.add(name);
  }
  if (features.size > 0) {
    const names = [...features].map((feature) => t(feature)).join(", ");
    return { supported: false, reason: t("editor.uses", { features: names }) };
  }

  const doc = textMarkdownParser.parse(body);
  if (signature(body) !== signature(textDocToMarkdown(doc))) {
    return { supported: false, reason: t("editor.wouldChange") };
  }
  return { supported: true, doc };
}

/** `\_` between letters or digits of any script: an escape CommonMark does not need there. */
const INTRAWORD_ESCAPED_UNDERSCORE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu;

const defaultText = defaultMarkdownSerializer.nodes.text;

/**
 * The default serializer, except that `_` between letters or digits stays as
 * it is in every script. prosemirror-markdown keeps it only between ASCII
 * letters, so `#новые_технологии` would be written `#новые\_технологии`,
 * which is a different tag (`новые`). Intraword `_` never starts emphasis.
 */
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    // A task's marker goes right after the bullet: `* [x] done`.
    list_item(state, node, parent, index) {
      const { checked } = node.attrs;
      if (checked !== null) {
        // No space after the marker of an empty task, so no line ends in one.
        const space = node.firstChild?.content.size ? " " : "";
        state.write((checked === true ? "[x]" : "[ ]") + space);
      }
      defaultMarkdownSerializer.nodes.list_item?.(state, node, parent, index);
    },
    text(state, node, parent, index) {
      const escape = state.esc.bind(state);
      state.esc = (text, startOfLine) =>
        escape(text, startOfLine).replace(INTRAWORD_ESCAPED_UNDERSCORE, "_");
      try {
        defaultText?.(state, node, parent, index);
      } finally {
        Reflect.deleteProperty(state, "esc");
      }
    },
  },
  defaultMarkdownSerializer.marks,
  defaultMarkdownSerializer.options,
);

export function textDocToMarkdown(doc: Node): string {
  return serializer.serialize(joinedLists(doc));
}

const isList = (node: Node | undefined): node is Node =>
  node?.type.name === "bullet_list" || node?.type.name === "ordered_list";
const isBlank = (node: Node | undefined) =>
  node?.type.name === "paragraph" && node.content.size === 0;

/**
 * `node` with lists of a kind that follow one another, or have only blank
 * lines between them, made one list: Markdown has no other way to read them
 * (two such lists, or a blank line in a list, make one loose list). The text
 * editor makes them when Enter twice splits a list, or a list is begun right
 * above another. The list is tight if its parts are; it starts where the
 * first one did.
 */
function joinedLists(node: Node): Node {
  if (node.isTextblock || node.isLeaf) return node;
  const blocks: Node[] = [];
  node.forEach((child) => blocks.push(joinedLists(child)));
  const joined: Node[] = [];
  blocks.forEach((block, index) => {
    const previous = joined.at(-1);
    if (isList(previous) && isList(block) && previous.type === block.type) {
      const tight = previous.attrs.tight === true && block.attrs.tight === true;
      joined[joined.length - 1] = previous.type.create(
        { ...previous.attrs, tight },
        previous.content.append(block.content),
      );
      return;
    }
    if (isList(previous) && isBlank(block)) {
      const next = blocks.slice(index + 1).find((later) => !isBlank(later));
      if (next?.type === previous.type) return;
    }
    joined.push(block);
  });
  const same =
    joined.length === node.childCount && joined.every((block, i) => block === node.child(i));
  return same ? node : node.copy(Fragment.from(joined));
}

function flatten(tokens: readonly Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...flatten(token.children ?? [])]);
}

/** A task list item ticked with a capital `[X]`. */
const TICKED_UPPER = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[X\]/gm;

const COMPARED_ATTRIBUTES = new Set(["href", "src", "title", "start"]);
const TEXT_LIKE = new Set(["text", "text_special", "softbreak"]);

/**
 * What a document means, ignoring how it is written: token structure, text
 * (with soft line breaks as spaces), URLs and code, but not markers or escapes.
 */
function signature(markdown: string): string {
  const parts: unknown[] = [];
  // `[X]` and `[x]` tick a task alike; the editor writes `[x]`.
  const source = markdown.replace(TICKED_UPPER, "$1[x]");
  let text = "";
  const flushText = () => {
    if (text !== "") parts.push(["text", text]);
    text = "";
  };
  for (const token of flatten(reference.parse(source, {}))) {
    if (TEXT_LIKE.has(token.type)) {
      text += token.type === "softbreak" ? " " : token.content;
      continue;
    }
    flushText();
    if (token.type === "inline") continue;
    parts.push([
      token.type,
      token.tag,
      (token.attrs ?? []).filter(([name]) => COMPARED_ATTRIBUTES.has(name)),
      token.info.trim(),
      token.type.startsWith("code") || token.type === "fence" ? token.content : "",
      token.hidden,
    ]);
  }
  flushText();
  return JSON.stringify(parts);
}
