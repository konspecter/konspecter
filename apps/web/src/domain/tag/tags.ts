import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * A tag is one name: `#java` is the tag java. Tags are case-insensitive and
 * stored in lowercase. See docs/architecture/tags.md for the full rules.
 */
export type Tag = {
  readonly name: string;
};

/**
 * Tags written as a chain: `#java#collections` is the tags java and
 * collections, and says that collections has the parent java. Each tag of a
 * chain is the parent of the next.
 */
export type TagChain = {
  /** Outermost first: java, collections. */
  readonly tags: readonly Tag[];
  /** The canonical form, names joined by "#": "java#collections". */
  readonly name: string;
};

// GFM-aware tokenizer. text_join is disabled so escaped characters ("\#")
// stay separate tokens and are never read as tags.
const tokenizer = new MarkdownIt({ html: true, linkify: true });
tokenizer.disable("text_join");

/**
 * `#` starts a tag unless it follows a letter, digit, `_` or another `#`
 * (so `C#`, `foo#bar` and `##` are not tags). Names are letters, digits,
 * `_` and `-`; further `#name`s make a chain.
 */
const TAG = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*)/gu;
const ALL_DIGITS = /^\p{N}+$/u;

/** All tags in a Markdown body, each once, in order of first appearance. */
export function parseTags(markdown: string): Tag[] {
  return writtenTagList(writtenTags(markdown)).map(({ tag }) => tag);
}

/**
 * The tag chains of a Markdown body as first written there, case kept and
 * without the leading "#" ("Java#Linked_List"), each once, in order.
 */
export function writtenTags(markdown: string): string[] {
  const seen = new Map<string, string>();
  for (const text of taggableText(tokenizer.parse(markdown, {}))) {
    for (const match of text.matchAll(TAG)) {
      const written = match[1] ?? "";
      const chain = toChain(written);
      if (chain && !seen.has(chain.name)) seen.set(chain.name, written);
    }
  }
  return [...seen.values()];
}

/**
 * The tags of chains as written, each once with its first spelling, in order:
 * ["Java#Collections", "java#streams"] → Java, Collections, streams. What a
 * note shows as its list of tags. Entries that are not chains are skipped.
 */
export function writtenTagList(chains: readonly string[]): { tag: Tag; written: string }[] {
  const seen = new Map<string, { tag: Tag; written: string }>();
  for (const chain of chains) {
    const parsed = parseTagChain(chain);
    if (!parsed) continue;
    const spellings = chain.trim().replace(/^#/, "").split("#");
    parsed.tags.forEach((tag, index) => {
      if (!seen.has(tag.name)) seen.set(tag.name, { tag, written: spellings[index] ?? tag.name });
    });
  }
  return [...seen.values()];
}

/**
 * Where tags are in a piece of plain text (no Markdown syntax), as ranges that
 * include the "#", a chain as one range. For marking tags in editors, which
 * already know which text is code; the same rules as `parseTags` otherwise.
 */
export function tagRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const match of text.matchAll(TAG)) {
    if (toChain(match[1] ?? ""))
      ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

function toChain(raw: string): TagChain | null {
  const names = raw.toLowerCase().split("#");
  const [first] = names;
  // "#123" is more likely an issue number than a tag.
  if (first === undefined || ALL_DIGITS.test(first)) return null;
  return { tags: names.map((name) => ({ name })), name: names.join("#") };
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

/** A tag or chain typed by the user, with or without the leading "#". */
export function parseTagChain(written: string): TagChain | null {
  const trimmed = written.trim().replace(/^#/, "");
  const match = /^[\p{L}\p{N}_-]+(?:#[\p{L}\p{N}_-]+)*$/u.exec(trimmed);
  return match ? toChain(trimmed) : null;
}

/** The parent links a chain makes, as [parent, child] names; none to itself. */
export function chainLinks(chain: TagChain): [string, string][] {
  const links: [string, string][] = [];
  chain.tags.forEach((tag, index) => {
    const parent = chain.tags[index - 1];
    if (parent && parent.name !== tag.name) links.push([parent.name, tag.name]);
  });
  return links;
}

/** One tag chain of a note, by tag name, outermost first: java, collections. */
export type NoteChain = {
  readonly noteId: string;
  readonly tags: readonly string[];
};

export type TagNode = {
  readonly tag: Tag;
  /** What the tree shows: see `tagLabel`. */
  readonly label: string;
  /** Notes in this folder and the folders below it, each once. */
  readonly count: number;
  /** The notes in this folder itself, by id: see `tagTree`. */
  readonly noteIds: readonly string[];
  readonly children: readonly TagNode[];
};

/**
 * Arranges tags into a tree, siblings sorted by name. `parents` are the tags
 * a chain writes right before this one, in any note; a tag shows under each
 * of them, and only a tag without a parent is a root. Tags reachable only
 * through a cycle (`#a#b` and `#b#a`) get a root too: the first by name. A
 * branch stops before a tag already above it. `spelling` is the tag as
 * written (see `tagSpellings`); without it the tag shows in lowercase.
 * `capitalize` starts every label with a capital letter.
 *
 * `chains` are the note chains ending in the tag. A note sits only in the
 * folders its chains lead to: those whose path ends with the chain, so
 * `#java#collections` is in Java › Collections but not in Python ›
 * Collections, and a bare `#collections` is in every Collections. A chain
 * that ends no path (`#b#a` when the cycle above shows a › b) goes to the
 * folders that end with the longest part of its end that one does.
 */
export function tagTree(
  entries: readonly {
    tag: Tag;
    spelling?: string;
    parents?: readonly string[];
    chains?: readonly NoteChain[];
  }[],
  { capitalize = false }: { capitalize?: boolean } = {},
): TagNode[] {
  const byName = new Map(entries.map((entry) => [entry.tag.name, entry]));
  const names = [...byName.keys()].sort(byCodePoint);
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const name of names) {
    for (const parent of new Set(byName.get(name)?.parents)) {
      if (parent === name || !byName.has(parent)) continue;
      children.set(parent, [...(children.get(parent) ?? []), name]);
      hasParent.add(name);
    }
  }

  const roots = names.filter((name) => !hasParent.has(name));
  const reached = new Set<string>();
  const reach = (start: string) => {
    const pending = [start];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (reached.has(name)) continue;
      reached.add(name);
      pending.push(...(children.get(name) ?? []));
    }
  };
  roots.forEach(reach);
  for (const name of names) {
    if (!reached.has(name)) {
      roots.push(name);
      reach(name);
    }
  }

  // The folders, each with its path from the root; then the notes go in.
  type Folder = {
    readonly name: string;
    readonly path: readonly string[];
    readonly noteIds: Set<string>;
    readonly children: readonly Folder[];
  };
  const foldersOf = new Map<string, Folder[]>();
  const folder = (name: string, above: readonly string[]): Folder => {
    const path = [...above, name];
    const made: Folder = {
      name,
      path,
      noteIds: new Set(),
      children: (children.get(name) ?? [])
        .filter((child) => !path.includes(child))
        .map((child) => folder(child, path)),
    };
    foldersOf.set(name, [...(foldersOf.get(name) ?? []), made]);
    return made;
  };
  const tree = roots.sort(byCodePoint).map((name) => folder(name, []));

  for (const [name, entry] of byName) {
    const candidates = foldersOf.get(name) ?? [];
    for (const chain of entry.chains ?? []) {
      for (let length = chain.tags.length; length > 0; length -= 1) {
        const end = chain.tags.slice(-length);
        const matching = candidates.filter((each) => endsWith(each.path, end));
        matching.forEach((each) => each.noteIds.add(chain.noteId));
        if (matching.length > 0) break;
      }
    }
  }

  const node = (each: Folder): { node: TagNode; below: ReadonlySet<string> } => {
    const entry = byName.get(each.name);
    const nested = each.children.map(node);
    const below = new Set([...each.noteIds, ...nested.flatMap((child) => [...child.below])]);
    return {
      node: {
        tag: entry?.tag ?? { name: each.name },
        label: tagLabel(entry?.spelling ?? each.name, capitalize),
        count: below.size,
        noteIds: [...each.noteIds],
        children: nested.map((child) => child.node),
      },
      below,
    };
  };
  return tree.map((each) => node(each).node);
}

function endsWith(path: readonly string[], end: readonly string[]): boolean {
  const offset = path.length - end.length;
  return offset >= 0 && end.every((name, index) => path[offset + index] === name);
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True if the tag named `name` is somewhere below `node`. */
export function tagTreeContains(node: TagNode, name: string): boolean {
  return node.children.some((child) => child.tag.name === name || tagTreeContains(child, name));
}

/**
 * How a tag is shown inside the tree: its spelling, case kept, with "_" shown
 * as a space ("Linked_List" → "Linked List"), and with a capital first letter
 * if `capitalize` ("новые_технологии" → "Новые технологии").
 */
export function tagLabel(spelling: string, capitalize = false): string {
  const label = spelling.replaceAll("_", " ");
  if (!capitalize) return label;
  const [first = "", ...rest] = label;
  return first.toLocaleUpperCase() + rest.join("");
}

/**
 * One spelling per tag name, for display, from each note's tag chains as
 * written (`writtenTags`): "Java#Streams" spells java "Java". When notes
 * differ ("#Java", "#java"), the spelling in most notes wins; a tie goes to
 * the first in code point order, so capitals win.
 */
export function tagSpellings(notes: Iterable<readonly string[]>): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const written of notes) {
    // Each note votes once per spelling.
    const spelled = new Set(written.flatMap((chain) => chain.split("#")));
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
