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
import { EditorState, Plugin, type Command } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

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

export function createTextEditorState(doc: Node): EditorState {
  return EditorState.create({
    doc,
    plugins: [
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
      placeholder("Start writing…"),
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
  readonly label: string;
  readonly text: string;
  readonly shortcut?: string;
  readonly command: Command;
  readonly isActive?: (state: EditorState) => boolean;
};

export const toolbarActions: readonly ToolbarAction[] = [
  {
    label: "Bold",
    text: "B",
    shortcut: "Mod-B",
    command: toggleMark(marks.strong),
    isActive: (state) => isMarkActive(state, marks.strong),
  },
  {
    label: "Italic",
    text: "I",
    shortcut: "Mod-I",
    command: toggleMark(marks.em),
    isActive: (state) => isMarkActive(state, marks.em),
  },
  {
    label: "Inline code",
    text: "</>",
    shortcut: "Mod-`",
    command: toggleMark(marks.code),
    isActive: (state) => isMarkActive(state, marks.code),
  },
  {
    label: "Heading",
    text: "H2",
    command: toggleBlock(nodes.heading, { level: 2 }),
    isActive: (state) => isBlockActive(state, nodes.heading, { level: 2 }),
  },
  {
    label: "Subheading",
    text: "H3",
    command: toggleBlock(nodes.heading, { level: 3 }),
    isActive: (state) => isBlockActive(state, nodes.heading, { level: 3 }),
  },
  { label: "Quote", text: "❝", command: wrapIn(nodes.blockquote) },
  { label: "Bulleted list", text: "•", command: wrapInList(nodes.bullet_list) },
  { label: "Numbered list", text: "1.", command: wrapInList(nodes.ordered_list) },
  {
    label: "Code block",
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
