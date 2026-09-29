import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown";
import type { Node } from "prosemirror-model";

export type TextEditorContent =
  | { readonly supported: true; readonly doc: Node }
  | { readonly supported: false; readonly reason: string };

/** A GFM-aware reference parser used only to compare documents. */
const reference = new MarkdownIt({ html: true, linkify: true });

// GFM extensions markdown-it does not parse; the text editor would escape them.
const TASK_ITEM = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/m;
const FOOTNOTE = /\[\^[^\]\s]+\]/;

const FEATURE_NAMES: Record<string, string> = {
  table_open: "tables",
  s_open: "strikethrough",
  html_block: "HTML",
  html_inline: "HTML",
};

/**
 * Converts a document body for the text editor, but only if the editor can
 * represent it without changing its meaning. The editor may still normalize
 * formatting (list markers, line wrapping, `Title\n===` headings).
 */
export function markdownToTextDoc(body: string): TextEditorContent {
  const features = new Set<string>();
  if (TASK_ITEM.test(body)) features.add("task lists");
  if (FOOTNOTE.test(body)) features.add("footnotes");
  for (const token of flatten(reference.parse(body, {}))) {
    const name = FEATURE_NAMES[token.type];
    if (name) features.add(name);
  }
  if (features.size > 0) {
    return { supported: false, reason: `This note uses ${[...features].join(", ")}` };
  }

  const doc = defaultMarkdownParser.parse(body);
  if (signature(body) !== signature(textDocToMarkdown(doc))) {
    return { supported: false, reason: "This note uses Markdown the text editor would change" };
  }
  return { supported: true, doc };
}

export function textDocToMarkdown(doc: Node): string {
  return defaultMarkdownSerializer.serialize(doc);
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
