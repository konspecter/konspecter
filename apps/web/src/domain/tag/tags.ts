import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * A tag is a path of one or more segments: `#java` is ["java"], and
 * `#java#collections` is ["java", "collections"], a child of `java`.
 * Tags are case-insensitive and stored in lowercase.
 * See docs/architecture/tags.md for the full rules.
 */
export type Tag = {
  readonly path: readonly string[];
  /** The canonical form, segments joined by "#": "java#collections". */
  readonly name: string;
};

// GFM-aware tokenizer. text_join is disabled so escaped characters ("\#")
// stay separate tokens and are never read as tags.
const tokenizer = new MarkdownIt({ html: true, linkify: true });
tokenizer.disable("text_join");

/**
 * `#` starts a tag unless it follows a letter, digit, `_` or another `#`
 * (so `C#`, `foo#bar` and `##` are not tags). Segments are letters, digits,
 * `_` and `-`; further `#segment`s make the tag hierarchical.
 */
const TAG = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*)/gu;
const ALL_DIGITS = /^\p{N}+$/u;

/** All tags in a Markdown body, deduplicated, in order of first appearance. */
export function parseTags(markdown: string): Tag[] {
  const seen = new Map<string, Tag>();
  for (const text of taggableText(tokenizer.parse(markdown, {}))) {
    for (const match of text.matchAll(TAG)) {
      const tag = toTag(match[1] ?? "");
      if (tag && !seen.has(tag.name)) seen.set(tag.name, tag);
    }
  }
  return [...seen.values()];
}

function toTag(raw: string): Tag | null {
  const path = raw.toLowerCase().split("#");
  const [first] = path;
  // "#123" is more likely an issue number than a tag.
  if (first === undefined || ALL_DIGITS.test(first)) return null;
  return { path, name: path.join("#") };
}

/** Plain text content, excluding code, HTML, images and URLs shown as link text. */
function* taggableText(tokens: readonly Token[]): Generator<string> {
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    let insideUrlLink = 0;
    for (const child of token.children) {
      if (
        child.type === "link_open" &&
        (child.markup === "linkify" || child.markup === "autolink")
      ) {
        insideUrlLink += 1;
      } else if (child.type === "link_close" && insideUrlLink > 0) {
        insideUrlLink -= 1;
      } else if (child.type === "text" && insideUrlLink === 0) {
        yield child.content;
      }
    }
  }
}

export function parseTagName(name: string): Tag | null {
  const trimmed = name.trim().replace(/^#/, "");
  const match = /^[\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*$/u.exec(trimmed);
  return match ? toTag(trimmed) : null;
}

/** The tag and each of its ancestors, outermost first: java, java#collections. */
export function tagWithAncestors(tag: Tag): Tag[] {
  return tag.path.map((_, index) => {
    const path = tag.path.slice(0, index + 1);
    return { path, name: path.join("#") };
  });
}

/** True if `tag` is `ancestor` or nested somewhere below it. */
export function isWithin(tag: Tag, ancestor: Tag): boolean {
  return (
    ancestor.path.length <= tag.path.length &&
    ancestor.path.every((segment, index) => tag.path[index] === segment)
  );
}

export type TagNode = {
  readonly tag: Tag;
  /** Notes tagged with this tag or any tag below it. */
  readonly count: number;
  readonly children: readonly TagNode[];
};

/**
 * Arranges tag counts into a tree, siblings sorted by name. A tag whose parent
 * is missing from the input becomes a root.
 */
export function tagTree(counts: readonly { tag: Tag; count: number }[]): TagNode[] {
  type Mutable = { tag: Tag; count: number; children: Mutable[] };
  const byName = new Map<string, Mutable>();
  for (const { tag, count } of counts) {
    byName.set(tag.name, { tag, count, children: [] });
  }
  const roots: Mutable[] = [];
  for (const node of byName.values()) {
    const parent = byName.get(node.tag.path.slice(0, -1).join("#"));
    if (node.tag.path.length > 1 && parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: Mutable[]): Mutable[] =>
    nodes
      .sort((a, b) => (a.tag.name < b.tag.name ? -1 : a.tag.name > b.tag.name ? 1 : 0))
      .map((node) => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}

/** The tag's last segment, for display inside a tree. */
export function tagLabel(tag: Tag): string {
  return tag.path.at(-1) ?? tag.name;
}
