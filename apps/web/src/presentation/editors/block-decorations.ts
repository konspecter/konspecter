import type { Node } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { DecorationSet, type Decoration } from "prosemirror-view";

/** Decorations for the text blocks of `doc`, made by `decorate`. */
export function blockDecorations(
  doc: Node,
  decorate: (block: Node, pos: number) => Decoration[],
): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    decorations.push(...decorate(node, pos));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * The decorations after `tr`: the previous ones moved with the text, and
 * those of the text blocks it changed made anew by `decorate`. Building the
 * set for a whole long document on every keystroke would make typing slow.
 */
export function updatedBlockDecorations(
  tr: Transaction,
  previous: DecorationSet,
  decorate: (block: Node, pos: number) => Decoration[],
): DecorationSet {
  const mapped = previous.map(tr.mapping, tr.doc);
  const start = tr.before.content.findDiffStart(tr.doc.content);
  const end = tr.before.content.findDiffEnd(tr.doc.content);
  if (start === null || end === null) return mapped;
  // Repeated text can make the ends overlap the start: move them after it.
  const to = end.b + Math.max(0, start - Math.min(end.a, end.b));
  const size = tr.doc.content.size;
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  // One position wider, so a change at a block's edge counts for that block.
  tr.doc.nodesBetween(Math.max(0, start - 1), Math.min(size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    stale.push(...mapped.find(pos, pos + node.nodeSize));
    fresh.push(...decorate(node, pos));
    return false;
  });
  return mapped.remove(stale).add(tr.doc, fresh);
}
