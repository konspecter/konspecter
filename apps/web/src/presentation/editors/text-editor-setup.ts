import {
  baseKeymap,
  chainCommands,
  exitCode,
  setBlockType,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { findMatches, type Match } from "../../domain/search/find";
import { tagRanges } from "../../domain/tag/tags";
import { blockDecorations, updatedBlockDecorations } from "./block-decorations";
import { codeHighlighting } from "./code-highlight";
import { ListItemView, splitItem, taskInputRule, toggleTask, untask } from "./task-items";
import { textSchema } from "./text-schema";
import { diffSequences, offsets } from "./diff";
import { t, type TextKey } from "../i18n/i18n";

const { nodes, marks } = textSchema;

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
  return true;
};

const markdownInputRules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({
      level: match[1]?.length ?? 1,
    })),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*[-+*]\s$/, nodes.bullet_list, { tight: true }),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]), tight: true }),
      (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1]),
    ),
    // Any info string: ```go, ```c++, ```c#.
    textblockTypeInputRule(/^```([^\s`]*)\s$/, nodes.code_block, (match) => ({
      params: match[1] ?? "",
    })),
    taskInputRule,
  ],
});

/** List items draw themselves: a task has a checkbox that ticks it. */
const listItems = new Plugin({
  props: {
    nodeViews: {
      list_item: (node, view, getPos) => new ListItemView(node, view, getPos),
    },
  },
});

/** Shows placeholder text while the document is a single empty paragraph. */
function placeholder(text: string) {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const only = doc.firstChild;
        if (doc.childCount !== 1 || only?.type !== nodes.paragraph || only.content.size > 0) {
          return null;
        }
        return DecorationSet.create(doc, [
          Decoration.node(0, only.nodeSize, { class: "placeholder", "data-placeholder": text }),
        ]);
      },
    },
  });
}

/** The tags in the text block at `pos`, as the tag rules say; none in code. */
function blockTags(block: Node, pos: number): Decoration[] {
  if (block.type === nodes.code_block) return [];
  // The block's text, code replaced by spaces and breaks by newlines, so
  // offsets match positions and code never looks like a tag.
  let text = "";
  block.forEach((child) => {
    if (!child.isText) text += "\n";
    else if (marks.code.isInSet(child.marks)) text += " ".repeat(child.nodeSize);
    else text += child.text ?? "";
  });
  return tagRanges(text).map(({ from, to }) =>
    Decoration.inline(pos + 1 + from, pos + 1 + to, { class: "md-tag" }),
  );
}

/** The tags in the document, marked for styling. */
export function tagDecorations(doc: Node): DecorationSet {
  return blockDecorations(doc, blockTags);
}

const tags: Plugin<DecorationSet> = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => tagDecorations(state.doc),
    apply: (tr, previous) =>
      tr.docChanged ? updatedBlockDecorations(tr, previous, blockTags) : previous,
  },
  props: {
    decorations(state) {
      return this.getState(state) ?? null;
    },
  },
});

/** A search in the text (the top bar's, see `NoteFind`): its matches and the selected one. */
type FindState = {
  readonly query: string;
  readonly selected: number;
  readonly matches: readonly Match[];
  readonly decorations: DecorationSet;
};

const findKey = new PluginKey<FindState>("find");

const NOTHING_FOUND: FindState = {
  query: "",
  selected: 0,
  matches: [],
  decorations: DecorationSet.empty,
};

/** Every match of `query` in the text blocks of `doc`, in document positions. */
export function findInDocument(doc: Node, query: string): Match[] {
  const matches: Match[] = [];
  if (query.trim() === "") return matches;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One character per position: inline leaves (breaks, images) are one
    // character that nothing typed matches. Matches stay within the block.
    const text = node.textBetween(0, node.content.size, undefined, "\ufffc");
    for (const { from, to } of findMatches(text, query)) {
      matches.push({ from: pos + 1 + from, to: pos + 1 + to });
    }
    return false;
  });
  return matches;
}

function foundIn(doc: Node, query: string, selected: number, matches: readonly Match[]) {
  const current = Math.min(selected, matches.length - 1);
  const decorations = matches.map(({ from, to }, index) =>
    Decoration.inline(from, to, {
      class: index === current ? "find-match find-current" : "find-match",
    }),
  );
  return { query, selected, matches, decorations: DecorationSet.create(doc, decorations) };
}

/** Marks the matches of a search; the text is searched again as it changes. */
const find: Plugin<FindState> = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => NOTHING_FOUND,
    apply(tr, previous) {
      const asked = tr.getMeta(findKey) as { query: string; selected: number } | undefined;
      const query = asked?.query ?? previous.query;
      const selected = asked?.selected ?? previous.selected;
      if (query === "" && previous.query === "") return previous;
      const same = query === previous.query && !tr.docChanged;
      if (same && selected === previous.selected) return previous;
      return foundIn(
        tr.doc,
        query,
        selected,
        same ? previous.matches : findInDocument(tr.doc, query),
      );
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)?.decorations ?? null;
    },
  },
});

/** Searches the text for `query`, with the match at `selected` (from 0) as the selected one. */
export function findTransaction(state: EditorState, query: string, selected: number): Transaction {
  return state.tr.setMeta(findKey, { query, selected });
}

/** The matches of the search in `state`. */
export function foundMatches(state: EditorState): readonly Match[] {
  return findKey.getState(state)?.matches ?? [];
}

const SMART_QUOTES: Record<string, RegExp> = { '"': /[«»“”„‟]/g, "'": /[‘’‚‛]/g };

/** What typing an opening character over a selection wraps it in. */
const PAIRS: ReadonlyMap<string, string> = new Map([
  ["(", ")"],
  ['"', '"'],
  ["'", "'"],
  ["«", "»"],
  ["“", "”"],
  ["‘", "’"],
]);

/**
 * The selection as the page shows it: when a typed key replaces it, the
 * editor has not always taken in a selection just made with the keyboard.
 */
function shownSelection(view: EditorView): { anchor: number; head: number } | null {
  const shown = view.dom.ownerDocument.getSelection();
  if (shown?.anchorNode && shown.focusNode && view.dom.contains(shown.anchorNode)) {
    const anchor = view.posAtDOM(shown.anchorNode, shown.anchorOffset);
    const head = view.posAtDOM(shown.focusNode, shown.focusOffset);
    if (anchor !== head) return { anchor, head };
  }
  const { selection } = view.state;
  return selection instanceof TextSelection && !selection.empty ? selection : null;
}

/**
 * The typed text, with two rules. Typing `(` or a quote over a selection wraps
 * it instead of replacing it, and the text stays selected; with no selection
 * nothing is closed for you. Straight quotes in code stay straight: when the
 * system replaces a typed `"` or `'` with a typographic quote (macOS smart
 * quotes, «» in Russian), the replacement is undone in code blocks and inline
 * code. Text keeps it.
 */
function typing(): Plugin {
  let typed: string | null = null;
  let selected: { anchor: number; head: number } | null = null;
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        typed = event.key in SMART_QUOTES ? event.key : null;
        selected = shownSelection(view);
        return false;
      },
      handleTextInput(view, from, to, text) {
        const quote = typed;
        const range = selected;
        typed = null;
        selected = null;
        const { state } = view;
        const smart = quote === null ? undefined : SMART_QUOTES[quote];
        const $from = state.doc.resolve(from);
        const inCode =
          $from.parent.type === nodes.code_block ||
          Boolean(marks.code.isInSet(state.storedMarks ?? $from.marks()));
        const insert = quote !== null && smart && inCode ? text.replace(smart, quote) : text;
        const close = PAIRS.get(insert);
        if (
          close !== undefined &&
          range !== null &&
          Math.min(range.anchor, range.head) === from &&
          Math.max(range.anchor, range.head) === to
        ) {
          const tr = state.tr.insertText(close, to).insertText(insert, from);
          const shift = insert.length;
          view.dispatch(
            tr
              .setSelection(TextSelection.create(tr.doc, range.anchor + shift, range.head + shift))
              .scrollIntoView(),
          );
          return true;
        }
        if (insert === text) return false;
        view.dispatch(state.tr.insertText(insert, from, to));
        return true;
      },
    },
  });
}

/** A first line shorter than this becomes the title when Enter ends it. */
export const TITLE_MAX_LENGTH = 50;

/**
 * In a new note, Enter at the end of the first line makes that line the title
 * (a level 1 heading) if it is short, and continues in a paragraph below.
 * Only while the note is still that one line, so it happens once.
 */
export const firstLineTitle: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const line = $from.parent;
  const text = line.textContent.trim();
  if (
    !empty ||
    state.doc.childCount !== 1 ||
    $from.depth !== 1 ||
    line.type !== nodes.paragraph ||
    $from.parentOffset !== line.content.size ||
    text === "" ||
    text.length >= TITLE_MAX_LENGTH
  ) {
    return false;
  }
  if (dispatch) {
    const tr = state.tr.setBlockType(0, line.nodeSize, nodes.heading, { level: 1 });
    tr.split($from.pos, 1, [{ type: nodes.paragraph }]);
    tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

type TextEditorOptions = {
  /** A new note: its short first line becomes the title (see `firstLineTitle`). */
  titleFromFirstLine?: boolean;
};

/**
 * Meta of a transaction that shows a version from elsewhere (sync, another
 * program): not an edit of this editor, so it is neither reported nor undone.
 */
export const FROM_ELSEWHERE = "konspecter.fromElsewhere";

/**
 * A transaction that makes the document `next` with the smallest changes: only
 * the blocks that differ, and within a block that changed into one of the same
 * kind only the part that differs. The caret, the scroll position and the rest
 * of the text stay where they are. Null when nothing differs.
 */
export function replaceDocument(state: EditorState, next: Node): Transaction | null {
  const current = state.doc;
  if (current.eq(next)) return null;
  const blocksA = childrenOf(current);
  const blocksB = childrenOf(next);
  const hunks = diffSequences(blocksA, blocksB, (x, y) => x.eq(y)) ?? [
    { fromA: 0, toA: blocksA.length, fromB: 0, toB: blocksB.length },
  ];
  const startsA = offsets(blocksA.map((block) => ({ length: block.nodeSize })));
  const startsB = offsets(blocksB.map((block) => ({ length: block.nodeSize })));
  const tr = state.tr;
  // From the end, so the positions of the earlier ones stay valid.
  for (const hunk of [...hunks].reverse()) {
    const a = blocksA[hunk.fromA];
    const b = blocksB[hunk.fromB];
    let fromA = startsA[hunk.fromA] ?? 0;
    let toA = startsA[hunk.toA] ?? 0;
    let fromB = startsB[hunk.fromB] ?? 0;
    let toB = startsB[hunk.toB] ?? 0;
    if (hunk.toA - hunk.fromA === 1 && hunk.toB - hunk.fromB === 1 && a && b && a.sameMarkup(b)) {
      // One block edited: replace only what differs inside it.
      const inside = narrowInside(a, b);
      if (inside === null) continue;
      toA = fromA + 1 + inside.endA;
      toB = fromB + 1 + inside.endB;
      fromA += 1 + inside.start;
      fromB += 1 + inside.start;
    }
    tr.replace(fromA, toA, next.slice(fromB, toB));
  }
  return tr.setMeta(FROM_ELSEWHERE, true).setMeta("addToHistory", false);
}

function childrenOf(node: Node): Node[] {
  const children: Node[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

/** Where two blocks' contents differ, relative to the contents' start. */
function narrowInside(a: Node, b: Node): { start: number; endA: number; endB: number } | null {
  const start = a.content.findDiffStart(b.content);
  if (start === null) return null;
  let { a: endA, b: endB } = a.content.findDiffEnd(b.content) ?? {
    a: a.content.size,
    b: b.content.size,
  };
  // Repeated text can make the ends overlap the start: move them after it.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return { start, endA, endB };
}

export function createTextEditorState(
  doc: Node,
  { titleFromFirstLine = false }: TextEditorOptions = {},
): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      ...(titleFromFirstLine ? [keymap({ Enter: firstLineTitle })] : []),
      markdownInputRules,
      history(),
      keymap({
        "Mod-z": undo,
        "Shift-Mod-z": redo,
        "Mod-y": redo,
        ...toolShortcuts(),
        Enter: splitItem,
        "Mod-Enter": toggleTask,
        "Mod-[": liftListItem(nodes.list_item),
        "Mod-]": sinkListItem(nodes.list_item),
        "Shift-Enter": chainCommands(exitCode, insertHardBreak),
        Backspace: chainCommands(undoInputRule, untask),
      }),
      keymap(baseKeymap),
      placeholder(t("editor.placeholder")),
      listItems,
      tags,
      codeHighlighting(),
      find,
      typing(),
    ],
  });
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  }
  return state.doc.rangeHasMark(from, to, type);
}

function isBlockActive(state: EditorState, type: NodeType, attrs: Record<string, unknown> = {}) {
  const { parent } = state.selection.$from;
  return parent.type === type && Object.entries(attrs).every(([k, v]) => parent.attrs[k] === v);
}

function toggleBlock(type: NodeType, attrs: Record<string, unknown> = {}): Command {
  return (state, dispatch) =>
    isBlockActive(state, type, attrs)
      ? setBlockType(nodes.paragraph)(state, dispatch)
      : setBlockType(type, attrs)(state, dispatch);
}

const isList = (node: Node) => node.type === nodes.bullet_list || node.type === nodes.ordered_list;

/** The innermost list holding the whole selection, and its position; null outside lists. */
function selectedList(state: EditorState): { list: Node; pos: number } | null {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, isList);
  return range ? { list: range.parent, pos: range.$from.before(range.depth) } : null;
}

/**
 * A list tool, toggling like the block tools: in a list of `type` (the
 * innermost one, when lists are nested) it lifts the selected items out of
 * it; in a list of the other kind it changes that list's kind, keeping its
 * items and spacing; elsewhere it wraps the selected blocks in a new tight
 * list (no blank line between its items).
 */
function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const selected = selectedList(state);
    if (!selected) return wrapInList(type, { tight: true })(state, dispatch);
    const { list, pos } = selected;
    if (list.type === type) return liftListItem(nodes.list_item)(state, dispatch);
    if (dispatch) {
      const tight: unknown = list.attrs.tight;
      dispatch(state.tr.setNodeMarkup(pos, type, { tight }).scrollIntoView());
    }
    return true;
  };
}

function isListActive(state: EditorState, type: NodeType): boolean {
  return selectedList(state)?.list.type === type;
}

/** Meta of a transaction made by a toolbar tool's shortcut: the tool's label. */
export const TOOL_USED = "konspecter.toolUsed";

/**
 * The toolbar tools' shortcuts, each running its tool and marking the
 * transaction with it (`TOOL_USED`), so a shortcut counts as using the tool.
 * Shortcuts are written for display ("Mod-B"); a keymap reads an upper-case
 * letter as one typed with Shift, so the keys are lower-cased.
 */
function toolShortcuts(): Record<string, Command> {
  const bindings: Record<string, Command> = {};
  for (const { shortcut, label, command } of toolbarActions) {
    if (!shortcut) continue;
    bindings[shortcut.toLowerCase()] = (state, dispatch) =>
      command(
        state,
        dispatch &&
          ((tr) => {
            dispatch(tr.setMeta(TOOL_USED, label));
          }),
      );
  }
  return bindings;
}

export type ToolbarAction = {
  /** A message key: the tool's name, translated where it is shown. */
  readonly label: TextKey;
  readonly text: string;
  readonly shortcut?: string;
  readonly command: Command;
  readonly isActive?: (state: EditorState) => boolean;
};

export const toolbarActions: readonly ToolbarAction[] = [
  {
    label: "tool.bold",
    text: "B",
    shortcut: "Mod-B",
    command: toggleMark(marks.strong),
    isActive: (state) => isMarkActive(state, marks.strong),
  },
  {
    label: "tool.italic",
    text: "I",
    shortcut: "Mod-I",
    command: toggleMark(marks.em),
    isActive: (state) => isMarkActive(state, marks.em),
  },
  {
    label: "tool.code",
    text: "</>",
    shortcut: "Mod-`",
    command: toggleMark(marks.code),
    isActive: (state) => isMarkActive(state, marks.code),
  },
  {
    label: "tool.heading",
    text: "H2",
    command: toggleBlock(nodes.heading, { level: 2 }),
    isActive: (state) => isBlockActive(state, nodes.heading, { level: 2 }),
  },
  {
    label: "tool.subheading",
    text: "H3",
    command: toggleBlock(nodes.heading, { level: 3 }),
    isActive: (state) => isBlockActive(state, nodes.heading, { level: 3 }),
  },
  {
    label: "tool.quote",
    text: "❝",
    command: wrapIn(nodes.blockquote),
    isActive: (state) => {
      const { $from, $to } = state.selection;
      return $from.blockRange($to, (node) => node.type === nodes.blockquote) !== null;
    },
  },
  {
    label: "tool.bulletList",
    text: "•",
    command: toggleList(nodes.bullet_list),
    isActive: (state) => isListActive(state, nodes.bullet_list),
  },
  {
    label: "tool.orderedList",
    text: "1.",
    command: toggleList(nodes.ordered_list),
    isActive: (state) => isListActive(state, nodes.ordered_list),
  },
  {
    label: "tool.codeBlock",
    text: "{ }",
    command: toggleBlock(nodes.code_block),
    isActive: (state) => isBlockActive(state, nodes.code_block),
  },
];

/** Adds a link to the selection, or removes the link under it. */
export function linkCommand(href: string | null): Command {
  return (state, dispatch) => {
    if (isMarkActive(state, marks.link)) {
      return toggleMark(marks.link)(state, dispatch);
    }
    if (state.selection.empty || !href) {
      return false;
    }
    return toggleMark(marks.link, { href })(state, dispatch);
  };
}

export function isLinkActive(state: EditorState): boolean {
  return isMarkActive(state, marks.link);
}

/** Only web addresses are opened: the desktop app's shell opens nothing else. */
const WEB_ADDRESS = /^https?:\/\//i;

/** A web address written out, as GFM links it (`www.` gets `http://`). */
const WRITTEN_ADDRESS = /(?:https?:\/\/|www\.)[^\s<]+/gi;

/**
 * `address` without what GFM leaves out of a written address: punctuation
 * at its end, and closing parentheses it does not open.
 */
function trimAddress(address: string): string {
  let trimmed = address.replace(/[.,:;!?'"*_~]+$/, "");
  while (trimmed.endsWith(")")) {
    const open = trimmed.split("(").length - 1;
    const close = trimmed.split(")").length - 1;
    if (close <= open) break;
    trimmed = trimmed.slice(0, -1).replace(/[.,:;!?'"*_~]+$/, "");
  }
  return trimmed;
}

/** The web address written out in `text` around `offset` (at its ends too), if any. */
export function writtenAddressAt(text: string, offset: number): string | null {
  for (const match of text.matchAll(WRITTEN_ADDRESS)) {
    const address = trimAddress(match[0]);
    if (offset >= match.index && offset <= match.index + address.length) {
      return /^www\./i.test(address) ? `http://${address}` : address;
    }
  }
  return null;
}

/**
 * The web address under the caret (not a selection): the link around it,
 * at either end too, or else an address written out in the text, which the
 * reader shows as a link. None in code.
 */
export function linkAtCaret(state: EditorState): string | null {
  const { empty, $head } = state.selection;
  const { parent, parentOffset } = $head;
  if (!empty || !parent.isTextblock || parent.type.spec.code) return null;
  const around = [parent.childBefore(parentOffset).node, parent.childAfter(parentOffset).node];
  if (around.some((node) => node && marks.code.isInSet(node.marks))) return null;
  for (const node of around) {
    const link = node && marks.link.isInSet(node.marks);
    if (link) {
      const href = String(link.attrs.href);
      return WEB_ADDRESS.test(href) ? href : null;
    }
  }
  // Inline nodes other than text stand for a space: an address never runs through them.
  const text = parent.textBetween(0, parent.content.size, undefined, " ");
  return writtenAddressAt(text, parentOffset);
}

const markTools: readonly (readonly [TextKey, MarkType])[] = [
  ["tool.bold", marks.strong],
  ["tool.italic", marks.em],
  ["tool.code", marks.code],
  ["tool.link", marks.link],
];

/** The block tool that makes `node`, if any. */
function blockTool(node: Node): TextKey | null {
  switch (node.type) {
    case nodes.heading:
      return node.attrs.level === 2
        ? "tool.heading"
        : node.attrs.level === 3
          ? "tool.subheading"
          : null;
    case nodes.code_block:
      return "tool.codeBlock";
    case nodes.blockquote:
      return "tool.quote";
    case nodes.bullet_list:
      return "tool.bulletList";
    case nodes.ordered_list:
      return "tool.orderedList";
    default:
      return null;
  }
}

/**
 * The tools in effect at the selection (those the toolbar shows pressed), the
 * closest to its text first: its marks, then its block, then the quotes and
 * lists around it, the inner ones first. Empty in plain text.
 */
export function toolsInEffect(state: EditorState): TextKey[] {
  const marked = markTools.filter(([, type]) => isMarkActive(state, type)).map(([id]) => id);
  const active = new Set(
    toolbarActions.filter((action) => action.isActive?.(state)).map((action) => action.label),
  );
  const { $from } = state.selection;
  const around: TextKey[] = [];
  for (let depth = $from.depth; depth > 0; depth--) {
    const id = blockTool($from.node(depth));
    if (id && active.has(id) && !around.includes(id)) around.push(id);
  }
  return [...marked, ...around];
}
