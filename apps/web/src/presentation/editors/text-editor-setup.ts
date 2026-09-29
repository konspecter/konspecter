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
import { schema } from "prosemirror-markdown";
import type { MarkType, Node, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { tagRanges } from "../../domain/tag/tags";
import { t, type TextKey } from "../i18n/i18n";

const { nodes, marks } = schema;

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
    wrappingInputRule(/^\s*[-+*]\s$/, nodes.bullet_list),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1]),
    ),
    textblockTypeInputRule(/^```([\w-]*)\s$/, nodes.code_block, (match) => ({
      params: match[1] ?? "",
    })),
  ],
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

/** The tags in the document, marked for styling: text outside code, as the tag rules say. */
function tagDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type === nodes.code_block) return false;
    if (!node.isTextblock) return true;
    // The block's text, code replaced by spaces and breaks by newlines, so
    // offsets match positions and code never looks like a tag.
    let text = "";
    node.forEach((child) => {
      if (!child.isText) text += "\n";
      else if (marks.code.isInSet(child.marks)) text += " ".repeat(child.nodeSize);
      else text += child.text ?? "";
    });
    for (const { from, to } of tagRanges(text)) {
      decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: "md-tag" }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const tags: Plugin<DecorationSet> = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => tagDecorations(state.doc),
    apply: (tr, previous) => (tr.docChanged ? tagDecorations(tr.doc) : previous),
  },
  props: {
    decorations(state) {
      return this.getState(state) ?? null;
    },
  },
});

const SMART_QUOTES: Record<string, RegExp> = { '"': /[«»“”„‟]/g, "'": /[‘’‚‛]/g };

/**
 * Straight quotes in code stay straight: when the system replaces a typed `"`
 * or `'` with a typographic quote (macOS smart quotes, «» in Russian), the
 * replacement is undone in code blocks and inline code. Text keeps it.
 */
function straightQuotesInCode(): Plugin {
  let typed: string | null = null;
  return new Plugin({
    props: {
      handleKeyDown(_, event) {
        typed = event.key in SMART_QUOTES ? event.key : null;
        return false;
      },
      handleTextInput(view, from, to, text) {
        const quote = typed;
        typed = null;
        const smart = quote === null ? undefined : SMART_QUOTES[quote];
        if (quote === null || !smart) return false;
        const { state } = view;
        const $from = state.doc.resolve(from);
        const inCode =
          $from.parent.type === nodes.code_block ||
          Boolean(marks.code.isInSet(state.storedMarks ?? $from.marks()));
        const straight = text.replace(smart, quote);
        if (!inCode || straight === text) return false;
        view.dispatch(state.tr.insertText(straight, from, to));
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
        "Mod-b": toggleMark(marks.strong),
        "Mod-i": toggleMark(marks.em),
        "Mod-`": toggleMark(marks.code),
        Enter: splitListItem(nodes.list_item),
        "Mod-[": liftListItem(nodes.list_item),
        "Mod-]": sinkListItem(nodes.list_item),
        "Shift-Enter": chainCommands(exitCode, insertHardBreak),
        Backspace: undoInputRule,
      }),
      keymap(baseKeymap),
      placeholder(t("editor.placeholder")),
      tags,
      straightQuotesInCode(),
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
  { label: "tool.quote", text: "❝", command: wrapIn(nodes.blockquote) },
  { label: "tool.bulletList", text: "•", command: wrapInList(nodes.bullet_list) },
  { label: "tool.orderedList", text: "1.", command: wrapInList(nodes.ordered_list) },
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
