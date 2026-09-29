import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from "prosemirror-markdown";
import type { Node } from "prosemirror-model";
import { t, type TextKey } from "../i18n/i18n";

export type TextEditorContent =
  | { readonly supported: true; readonly doc: Node }
  | { readonly supported: false; readonly reason: string };

/** A GFM-aware reference parser used only to compare documents. */
const reference = new MarkdownIt({ html: true, linkify: true });

// GFM extensions markdown-it does not parse; the text editor would escape them.
const TASK_ITEM = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/m;
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
  if (TASK_ITEM.test(body)) features.add("editor.feature.taskLists");
  if (FOOTNOTE.test(body)) features.add("editor.feature.footnotes");
  for (const token of flatten(reference.parse(body, {}))) {
    const name = FEATURE_NAMES[token.type];
    if (name) features.add(name);
  }
  if (features.size > 0) {
    const names = [...features].map((feature) => t(feature)).join(", ");
    return { supported: false, reason: t("editor.uses", { features: names }) };
  }

  const doc = defaultMarkdownParser.parse(body);
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
  return serializer.serialize(doc);
}

function flatten(tokens: readonly Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...flatten(token.children ?? [])]);
}

const COMPARED_ATTRIBUTES = new Set(["href", "src", "title", "start"]);
const TEXT_LIKE = new Set(["text", "text_special", "softbreak"]);

/**
 * What a document means, ignoring how it is written: token structure, text
 * (with soft line breaks as spaces), URLs and code, but not markers or escapes.
 */
function signature(markdown: string): string {
  const parts: unknown[] = [];
  let text = "";
  const flushText = () => {
    if (text !== "") parts.push(["text", text]);
    text = "";
  };
  for (const token of flatten(reference.parse(markdown, {}))) {
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
