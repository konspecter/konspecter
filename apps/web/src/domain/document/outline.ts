import MarkdownIt from "markdown-it";
import { inlinePlainText } from "./plain-text";

/** The deepest heading an outline shows: h1, h2 and h3. */
export const OUTLINE_DEPTH = 3;

export type HeadingLevel = 1 | 2 | 3;

/** A heading of a body, as the outline shows it. */
export type Heading = {
  readonly level: HeadingLevel;
  /** Its readable text, without markup (`Using **maps**` → `Using maps`). */
  readonly text: string;
  /** The body line it starts on, from 0. */
  readonly line: number;
  /** Its place among the body's headings up to OUTLINE_DEPTH, from 0: how views find it. */
  readonly index: number;
};

/** A heading and the deeper ones under it, up to the next heading of its level or above. */
export type OutlineNode = {
  readonly heading: Heading;
  readonly children: readonly OutlineNode[];
};

// Block rules only: inline parsing is the slow part, and only headings need it.
const blocks = new MarkdownIt({ html: true });
blocks.core.ruler.enableOnly(["normalize", "block"]);

/**
 * The body's headings up to OUTLINE_DEPTH, in order: ATX (`## Maps`) and
 * setext (`Maps\n---`) ones, wherever they are (a list, a quote), but not in
 * code. Every heading counts towards `index`, an empty one too.
 */
export function documentHeadings(body: string): Heading[] {
  const headings: Heading[] = [];
  const tokens = blocks.parse(body, {});
  for (const [position, token] of tokens.entries()) {
    if (token.type !== "heading_open" || !token.map) continue;
    const level = Number(token.tag.slice(1));
    if (level > OUTLINE_DEPTH) continue;
    headings.push({
      level: level as HeadingLevel,
      text: inlinePlainText(tokens[position + 1]?.content ?? "").trim(),
      line: token.map[0],
      index: headings.length,
    });
  }
  return headings;
}

/**
 * The headings nested: each under the nearest heading before it of a higher
 * level. A body that starts at h2, or skips from h1 to h3, nests what it has.
 */
export function outlineTree(headings: readonly Heading[]): OutlineNode[] {
  type Open = { heading: Heading; children: OutlineNode[] };
  const root: OutlineNode[] = [];
  const open: Open[] = [];
  for (const heading of headings) {
    while (open.length > 0 && (open.at(-1)?.heading.level ?? 0) >= heading.level) open.pop();
    const node: Open = { heading, children: [] };
    (open.at(-1)?.children ?? root).push(node);
    open.push(node);
  }
  return root;
}
