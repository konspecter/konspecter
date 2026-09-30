import { defaultMarkdownParser } from "prosemirror-markdown";
import type { Node } from "prosemirror-model";
import { diffSequences, type Hunk } from "./diff";

/**
 * Where the reader is in an editor, in that editor's positions (ProseMirror
 * positions, or characters of the Markdown source): the selection, and the
 * text held on screen, `at` a position, whose line is `top` pixels from the
 * top of the window.
 */
export type Place = {
  readonly anchor: number;
  readonly head: number;
  readonly shown: { readonly at: number; readonly top: number } | null;
};

/** The same place in other positions. */
export function mapPlace(place: Place, map: (position: number) => number): Place {
  return {
    anchor: map(place.anchor),
    head: map(place.head),
    shown: place.shown && { at: map(place.shown.at), top: place.shown.top },
  };
}

/** How far up from the window's bottom edge the island covers the page (small screens), else 0. */
export function coveredBelow(): number {
  const island = document.querySelector(".island");
  return island ? Math.max(0, window.innerHeight - island.getBoundingClientRect().top) : 0;
}

/**
 * The part of the window where the note can be seen: below the page's sticky
 * top bar (when there is one) and above the island (when there is one) or the
 * window's bottom edge.
 */
export function visibleArea(): { top: number; bottom: number } {
  const topBar = document.querySelector(".topbar");
  return {
    top: topBar?.getBoundingClientRect().bottom ?? 0,
    bottom: window.innerHeight - coveredBelow(),
  };
}

/**
 * A block's text and where each of its characters is, with one more position
 * at the end: the block's end.
 */
type Block = { readonly text: string; readonly positions: readonly number[] };

/**
 * The text blocks of the document, in order. An empty paragraph is left out:
 * it is written as nothing, so the source has no block for it.
 */
function textBlocks(doc: Node): Block[] {
  const blocks: Block[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "paragraph" && node.content.size === 0) return false;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      // A hard break is whitespace in the source; an image has no text of its own.
      const shown = child.isText
        ? (child.text ?? "")
        : child.type.name === "hard_break"
          ? "\n"
          : "";
      for (let index = 0; index < shown.length; index += 1) positions.push(start + index);
      text += shown;
    });
    positions.push(pos + 1 + node.content.size);
    blocks.push({ text, positions });
    return false;
  });
  return blocks;
}

const TEXT_TOKENS = new Set(["paragraph_open", "heading_open", "code_block", "fence"]);

/**
 * The source of each text block of `body`, in order: the lines of the
 * parser's block token, a fence's content without its fence lines.
 */
function sourceBlocks(body: string): Block[] {
  const lineStarts = [0];
  for (let index = body.indexOf("\n"); index !== -1; index = body.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }
  const lineStart = (line: number) => lineStarts[line] ?? body.length;
  const blocks: Block[] = [];
  for (const token of defaultMarkdownParser.tokenizer.parse(body, {})) {
    if (!TEXT_TOKENS.has(token.type) || !token.map) continue;
    let [first, last] = token.map;
    if (token.type === "fence") {
      const closing = body.slice(lineStart(last - 1), lineStart(last)).trim();
      if (last - 1 > first && closing.startsWith(token.markup)) last -= 1;
      first += 1;
    }
    const from = lineStart(first);
    let to = Math.max(from, lineStart(last));
    if (to > from && body[to - 1] === "\n") to -= 1;
    const positions: number[] = [];
    for (let position = from; position <= to; position += 1) positions.push(position);
    blocks.push({ text: body.slice(from, to), positions });
  }
  return blocks;
}

/**
 * Which block `position` is in, and before which of its characters (the
 * block's length: at its end). Between blocks it is at the end of the one
 * before, and before them all at the start of the first.
 */
function locate(blocks: readonly Block[], position: number): { block: number; index: number } {
  let before = -1;
  for (const [block, { positions }] of blocks.entries()) {
    const end = positions.length - 1;
    if (position > (positions[end] ?? 0)) {
      before = block;
      continue;
    }
    if (position < (positions[0] ?? 0)) break;
    return { block, index: positions.findIndex((at) => at >= position) };
  }
  if (before === -1) return { block: 0, index: 0 };
  return { block: before, index: (blocks[before]?.positions.length ?? 1) - 1 };
}

const SPACE = /\s/;

/** Whitespace stands for whitespace: a soft line break is a space in the text editor. */
function sameCharacter(x: string, y: string): boolean {
  return x === y || (SPACE.test(x) && SPACE.test(y));
}

/**
 * `index` in `a` → the index before the same character in `b`, after what only
 * `b` has there (markup, in the source); one inside what only `a` has goes to
 * where that was.
 */
function mapIndex(hunks: readonly Hunk[], index: number): number {
  let shift = 0;
  for (const { fromA, toA, fromB, toB } of hunks) {
    if (index < fromA) break;
    if (index < toA) return fromB + Math.min(index - fromA, toB - fromB);
    shift = toB - toA;
  }
  return index + shift;
}

/** `position` in the `from` blocks → the same place in the `to` blocks. */
function translate(from: readonly Block[], to: readonly Block[], position: number): number {
  const { block, index } = locate(from.slice(0, Math.min(from.length, to.length)), position);
  const source = from[block];
  const target = to[block];
  if (!source || !target) return 0;
  // In UTF-16 units, as both kinds of positions count.
  const hunks = diffSequences(source.text.split(""), target.text.split(""), sameCharacter);
  const mapped =
    hunks === null
      ? Math.round((index * target.text.length) / Math.max(1, source.text.length))
      : mapIndex(hunks, index);
  return target.positions[Math.min(mapped, target.text.length)] ?? 0;
}

/**
 * Maps positions between a text editor document and the Markdown body it
 * shows (read from it, or written from it): the text blocks are paired in
 * order, and each block's characters with the characters of its source.
 */
export function positionMap(
  doc: Node,
  body: string,
): { toSource: (position: number) => number; toText: (offset: number) => number } {
  const text = textBlocks(doc);
  const source = sourceBlocks(body);
  return {
    toSource: (position) => translate(text, source, position),
    toText: (offset) => translate(source, text, offset),
  };
}
