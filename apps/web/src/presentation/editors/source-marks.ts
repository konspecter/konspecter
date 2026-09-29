import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tagRanges } from "../../domain/tag/tags";

/** Where "#" is not a tag: code, HTML, URLs and the frontmatter (the tag rules). */
const NOT_TAGGABLE = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "HTMLBlock",
  "HTMLTag",
  "CommentBlock",
  "Comment",
  "URL",
  "Autolink",
  "Frontmatter",
]);

/** Where straight quotes are code: code, and the YAML frontmatter. */
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "Frontmatter"]);

type SyntaxNode = { readonly name: string; readonly parent: SyntaxNode | null };

function within(state: EditorState, pos: number, names: ReadonlySet<string>): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (names.has(node.name)) return true;
  }
  return false;
}

const tagMark = Decoration.mark({ class: "md-tag" });
const codeLine = Decoration.line({ class: "cm-code-line" });
const codeFirst = Decoration.line({ class: "cm-code-line cm-code-first" });
const codeLast = Decoration.line({ class: "cm-code-line cm-code-last" });
const codeOnly = Decoration.line({ class: "cm-code-line cm-code-first cm-code-last" });

function decorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    // Code blocks read as blocks: a background on each of their lines.
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return undefined;
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let number = first; number <= last; number += 1) {
          const line = state.doc.line(number);
          if (line.to < from || line.from > to) continue;
          const decoration =
            first === last
              ? codeOnly
              : number === first
                ? codeFirst
                : number === last
                  ? codeLast
                  : codeLine;
          ranges.push(decoration.range(line.from));
        }
        return false;
      },
    });
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      for (const tag of tagRanges(line.text)) {
        const start = line.from + tag.from;
        if (!within(state, start, NOT_TAGGABLE)) {
          ranges.push(tagMark.range(start, line.from + tag.to));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/** Marks tags and code blocks in the visible part of the Markdown source. */
const sourceMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = decorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const SMART_DOUBLE = /[«»“”„‟]/g;
const SMART_SINGLE = /[‘’‚‛]/g;

/**
 * Straight quotes in code stay straight. When the system replaces a typed `"`
 * or `'` with a typographic quote (macOS smart quotes, «» in Russian), the
 * replacement is undone inside code and the frontmatter; prose keeps it.
 */
function straightQuotesInCode(): Extension {
  let typed: string | null = null;
  return [
    EditorView.domEventHandlers({
      keydown(event) {
        typed = event.key === '"' || event.key === "'" ? event.key : null;
        return false;
      },
    }),
    EditorView.inputHandler.of((view, from, to, text) => {
      const quote = typed;
      typed = null;
      if (quote === null || !within(view.state, from, CODE)) return false;
      const straight = text.replace(quote === '"' ? SMART_DOUBLE : SMART_SINGLE, quote);
      if (straight === text) return false;
      view.dispatch({
        changes: { from, to, insert: straight },
        selection: { anchor: from + straight.length },
        userEvent: "input.type",
      });
      return true;
    }),
  ];
}

export function sourceEditorMarks(): Extension {
  return [sourceMarks, straightQuotesInCode()];
}
