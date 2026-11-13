import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, Text } from "@codemirror/state";
import type { Command } from "@codemirror/view";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** A list item's marker: `-`, `*`, `+` (with an unticked `[ ]` for a task), or `1.` / `1)`. */
const ORDERED = /^(\d+)([.)])( *)/;
const BULLET = /^([-+*])( {1,4}\[[ xX]\])?( +)/;

/** The list item whose paragraph (a task's text too) holds `pos`; null elsewhere. */
function itemParagraph(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node;) {
    const parent: SyntaxNode | null = node.parent;
    if (parent?.name === "ListItem")
      return node.name === "Paragraph" || node.name === "Task" ? parent : null;
    node = parent;
  }
  return null;
}

/** Spaces after a marker, at most four (more would make the text indented code). */
const spacing = (spaces: string) => (spaces.length > 4 ? " " : spaces);

/** The marker of the item after `item`, and the item's number when the list is ordered. */
function nextMarker(item: SyntaxNode, doc: Text): { marker: string; number: number | null } | null {
  const text = doc.sliceString(item.from, Math.min(item.to, item.from + 20));
  const ordered = item.parent?.name === "OrderedList" ? ORDERED.exec(text) : null;
  if (ordered) {
    const [, digits = "", delimiter = "", spaces = ""] = ordered;
    const number = Number(digits);
    return { marker: `${String(number + 1)}${delimiter}${spacing(spaces)}`, number };
  }
  const bullet = item.parent?.name === "BulletList" ? BULLET.exec(text) : null;
  if (!bullet) return null;
  const [, mark = "", task, spaces = ""] = bullet;
  const box = task ? task.replace(/[xX]/, " ") : "";
  return { marker: `${mark}${box}${spacing(spaces)}`, number: null };
}

/** Whether a blank line parts the list's first two items (a loose list keeps parting them). */
function loose(list: SyntaxNode, doc: Text): boolean {
  const first = list.getChild("ListItem");
  const second = list.getChildren("ListItem")[1];
  if (!first || !second) return false;
  const end = doc.lineAt(first.to);
  const empty = /^[\s>]*$/.test(end.text);
  return end.number + (empty ? 0 : 1) < doc.lineAt(second.from).number;
}

/** The items after `item` numbered one on from it, each one up: a new item goes in before them. */
function renumber(item: SyntaxNode, number: number, doc: Text): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let previous = number;
  for (let next = item.nextSibling; next?.name === "ListItem"; next = next.nextSibling) {
    const match = /^(\s*)(\d+)/.exec(doc.sliceString(next.from, next.from + 12));
    if (!match || Number(match[2]) !== previous + 1) break;
    const from = next.from + (match[1]?.length ?? 0);
    changes.push({ from, to: from + (match[2]?.length ?? 0), insert: String(previous + 2) });
    previous += 1;
  }
  return changes;
}

/**
 * Enter on a list item's later line (one that wrapped, as Prettier wraps at 80
 * columns) starts the next item, as it does on the item's first line:
 * CodeMirror's own command would only add another line to the same item.
 * The new item has the same marker (the next number, an unticked task), sits
 * where the item does, and a loose list stays loose. Elsewhere it does nothing.
 */
export const continueWrappedItem: Command = (view) => {
  const { state } = view;
  const { ranges, main } = state.selection;
  if (ranges.length > 1 || !main.empty) return false;
  const { doc } = state;
  const pos = main.head;
  const line = doc.lineAt(pos);
  const item = itemParagraph(state, pos);
  if (!item?.parent) return false;
  const first = doc.lineAt(item.from);
  // On the marker's own line, and before a later line's text, CodeMirror's command decides.
  if (first.number === line.number) return false;
  if (pos - line.from <= (/^\s*/.exec(line.text)?.[0].length ?? 0)) return false;
  const next = nextMarker(item, doc);
  if (!next) return false;

  // What comes before the item on its first line (a quote, or the parent item's
  // marker), as the new line's start: quotes stay, markers become spaces.
  const before = first.text.slice(0, item.from - first.from).replace(/[^\s>]/g, " ");
  let from = pos;
  let to = pos;
  while (from > line.from && /\s/.test(line.text.charAt(from - line.from - 1))) from--;
  while (to < line.to && /\s/.test(line.text.charAt(to - line.from))) to++;
  const blank = loose(item.parent, doc) ? `\n${before.trimEnd()}` : "";
  const insert = `${blank}\n${before}${next.marker}`;
  const changes: ChangeSpec[] = [{ from, to, insert }];
  if (next.number !== null) changes.push(...renumber(item, next.number, doc));
  view.dispatch(
    state.update({
      changes,
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};
