import { TextSelection, type EditorState } from "prosemirror-state";
import { moveRow } from "./move-rows";
import { createTextEditorState } from "./text-editor-setup";
import { textDocToMarkdown } from "./text-markdown";
import { textMarkdownParser } from "./text-schema";

/** The position of the first `word` in the document, `after` characters into it. */
function positionOf(state: EditorState, word: string, after = 1): number {
  let at = -1;
  state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? "").indexOf(word) : -1;
    if (at < 0 && index >= 0) at = pos + index + after;
  });
  if (at < 0) throw new Error(`no ${word}`);
  return at;
}

/** `markdown` with the selection from `from` to `to` (words; the caret when one). */
function stateWith(markdown: string, from: string, to = from): EditorState {
  const state = createTextEditorState(textMarkdownParser.parse(markdown));
  const selection = TextSelection.create(state.doc, positionOf(state, from), positionOf(state, to));
  return state.apply(state.tr.setSelection(selection));
}

/** The Markdown after moving the rows of the selection, and the text at the caret. */
function moved(state: EditorState, direction: -1 | 1) {
  let next = state;
  const done = moveRow(direction)(state, (tr) => {
    next = state.apply(tr);
  });
  const { $head } = next.selection;
  return {
    done,
    markdown: textDocToMarkdown(next.doc),
    at: $head.parent.textContent.slice($head.parentOffset - 1, $head.parentOffset + 1),
  };
}

describe("moving rows", () => {
  it("moves a paragraph up and down, the caret with it", () => {
    const state = stateWith("one\n\ntwo\n\nthree", "two");
    expect(moved(state, -1)).toEqual({ done: true, markdown: "two\n\none\n\nthree", at: "tw" });
    expect(moved(state, 1)).toEqual({ done: true, markdown: "one\n\nthree\n\ntwo", at: "tw" });
  });

  it("moves nothing past the first or the last row", () => {
    expect(moved(stateWith("one\n\ntwo", "one"), -1).done).toBe(false);
    expect(moved(stateWith("one\n\ntwo", "two"), 1).done).toBe(false);
  });

  it("moves a list item with its nested items, within its list", () => {
    const markdown = "* a\n* b\n  * b1\n* c";
    expect(moved(stateWith(markdown, "b"), -1).markdown).toBe("* b\n  * b1\n* a\n* c");
    expect(moved(stateWith(markdown, "b"), 1).markdown).toBe("* a\n* c\n* b\n  * b1");
    expect(moved(stateWith(markdown, "a"), -1).done).toBe(false);
  });

  it("moves a nested item within its own list", () => {
    const state = stateWith("* a\n  * a1\n  * a2\n* b", "a2");
    expect(moved(state, -1).markdown).toBe("* a\n  * a2\n  * a1\n* b");
    expect(moved(state, 1).done).toBe(false);
  });

  it("keeps a task's tick as it moves", () => {
    const state = stateWith("* [ ] todo\n* [x] done", "done");
    expect(moved(state, -1).markdown).toBe("* [x] done\n* [ ] todo");
  });

  it("moves the selected rows together", () => {
    const state = stateWith("one\n\ntwo\n\nthree\n\nfour", "two", "three");
    expect(moved(state, -1).markdown).toBe("two\n\nthree\n\none\n\nfour");
    expect(moved(state, 1).markdown).toBe("one\n\nfour\n\ntwo\n\nthree");
  });

  it("moves past a whole block: a list, a heading", () => {
    const state = stateWith("## Title\n\n* a\n* b\n\ntext", "text");
    expect(moved(state, -1).markdown).toBe("## Title\n\ntext\n\n* a\n* b");
    expect(moved(stateWith("## Title\n\ntext", "text"), -1).markdown).toBe("text\n\n## Title");
  });

  it("moves the lines of code in a code block, not the block", () => {
    const state = stateWith("```\nfirst\nsecond\nthird\n```", "second");
    expect(moved(state, -1)).toEqual({
      done: true,
      markdown: "```\nsecond\nfirst\nthird\n```",
      at: "se",
    });
    expect(moved(state, 1).markdown).toBe("```\nfirst\nthird\nsecond\n```");
    expect(moved(stateWith("```\nfirst\nsecond\n```", "first"), -1).done).toBe(false);
  });
});
