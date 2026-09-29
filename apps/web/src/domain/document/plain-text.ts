import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const tokenizer = new MarkdownIt({ html: true, linkify: true });

/**
 * The readable text of a Markdown body: prose, code and image descriptions,
 * without markup, URLs or HTML tags. Blocks are separated by newlines.
 */
export function plainText(body: string): string {
  const blocks: string[] = [];
  for (const token of tokenizer.parse(body, {})) {
    if (token.type === "inline") {
      blocks.push(inlineText(token.children ?? []));
    } else if (token.type === "fence" || token.type === "code_block") {
      blocks.push(token.content.trimEnd());
    }
  }
  return blocks.filter((block) => block.trim() !== "").join("\n");
}

function inlineText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
        case "code_inline":
          return token.content;
        case "softbreak":
        case "hardbreak":
          return " ";
        case "image":
          return inlineText(token.children ?? []);
        default:
          return "";
      }
    })
    .join("");
}
