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
  return tagsAsWritten(markdown).map(([tag]) => tag);
}

/**
 * The tags of a Markdown body as first written there, case kept and without
 * the leading "#" ("Java#Linked_List"), in the order of `parseTags`.
 */
export function writtenTags(markdown: string): string[] {
  return tagsAsWritten(markdown).map(([, written]) => written);
}

function tagsAsWritten(markdown: string): [Tag, string][] {
  const seen = new Map<string, [Tag, string]>();
  for (const text of taggableText(tokenizer.parse(markdown, {}))) {
    for (const match of text.matchAll(TAG)) {
      const written = match[1] ?? "";
      const tag = toTag(written);
      if (tag && !seen.has(tag.name)) seen.set(tag.name, [tag, written]);
    }
  }
  return [...seen.values()];
}

/**
 * Where tags are in a piece of plain text (no Markdown syntax), as ranges that
 * include the "#". For marking tags in editors, which already know which text
 * is code; the same rules as `parseTags` otherwise.
 */
export function tagRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const match of text.matchAll(TAG)) {
    if (toTag(match[1] ?? ""))
      ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
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
  /** What the tree shows: see `tagLabel`. */
  readonly label: string;
  /** Notes tagged with this tag or any tag below it. */
  readonly count: number;
  readonly children: readonly TagNode[];
};

/**
 * Arranges tag counts into a tree, siblings sorted by name. A tag whose parent
 * is missing from the input becomes a root. `spelling` is the tag as written
 * (see `tagSpellings`); without it the tag shows in lowercase. `capitalize`
 * starts every label with a capital letter.
 */
export function tagTree(
  counts: readonly { tag: Tag; count: number; spelling?: string }[],
  { capitalize = false }: { capitalize?: boolean } = {},
): TagNode[] {
  type Mutable = { tag: Tag; label: string; count: number; children: Mutable[] };
  const byName = new Map<string, Mutable>();
  for (const { tag, count, spelling } of counts) {
    const label = tagLabel(spelling ?? tag.name, capitalize);
    byName.set(tag.name, { tag, label, count, children: [] });
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

/**
 * How a tag is shown inside the tree: the last segment of its spelling, case
 * kept, with "_" shown as a space ("Java#Linked_List" → "Linked List"), and
 * with a capital first letter if `capitalize` ("новые_технологии" → "Новые технологии").
 */
export function tagLabel(spelling: string, capitalize = false): string {
  const label = (spelling.split("#").at(-1) ?? spelling).replaceAll("_", " ");
  if (!capitalize) return label;
  const [first = "", ...rest] = label;
  return first.toLocaleUpperCase() + rest.join("");
}

/**
 * One spelling per tag name, for display, from each note's tags as written
 * (`writtenTags`). An ancestor is spelled as written before its child
 * ("Java" from "Java#Streams"). When notes differ ("#Java", "#java"), the
 * spelling in most notes wins; a tie goes to the first in code point order,
 * so capitals win.
 */
export function tagSpellings(notes: Iterable<readonly string[]>): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const written of notes) {
    // Each note votes once per spelling.
    const spelled = new Set(
      written.flatMap((tag) => {
        const segments = tag.split("#");
        return segments.map((_, index) => segments.slice(0, index + 1).join("#"));
      }),
    );
    for (const spelling of spelled) {
      const name = spelling.toLowerCase();
      const counts = votes.get(name) ?? new Map<string, number>();
      counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
      votes.set(name, counts);
    }
  }
  const chosen = new Map<string, string>();
  for (const [name, counts] of votes) {
    let best: [string, number] | null = null;
    for (const [spelling, count] of counts) {
      if (!best || count > best[1] || (count === best[1] && spelling < best[0])) {
        best = [spelling, count];
      }
    }
    if (best) chosen.set(name, best[0]);
  }
  return chosen;
}
