import { defaultMarkdownParser } from "prosemirror-markdown";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createTextEditorState, toolbarActions } from "./text-editor-setup";
import { toolbarTopFor } from "./TextEditor";

function editorWith(markdown: string) {
  const view = new EditorView(document.createElement("div"), {
    state: createTextEditorState(defaultMarkdownParser.parse(markdown)),
  });
  /** Types `key` at `pos` as a system substitution does: the key, then `inserted`. */
  const type = (pos: number, key: string, inserted: string) => {
    view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key })));
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, pos, pos, inserted, () => view.state.tr.insertText(inserted, pos, pos)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(inserted, pos, pos));
  };
  return { view, type };
}

describe("text editor quotes", () => {
  it("keeps a typed straight quote in a code block", () => {
    const { view, type } = editorWith("```\nx\n```");

    type(2, '"', "«");
    expect(view.state.doc.textContent).toBe('x"');
  });

  it("keeps the system's typographic quote in text", () => {
    const { view, type } = editorWith("x");

    type(2, '"', "«");
    expect(view.state.doc.textContent).toBe("x«");
  });
});

describe("list tools", () => {
  it("run on any selection in nested lists without failing", () => {
    const state = createTextEditorState(
      defaultMarkdownParser.parse("text\n\n- one\n  1. inner\n- two\n\nafter"),
    );
    const lists = toolbarActions.filter(
      (action) => action.label === "tool.bulletList" || action.label === "tool.orderedList",
    );
    const size = state.doc.content.size;
    const inText = (pos: number) => state.doc.resolve(pos).parent.inlineContent;
    for (let from = 0; from <= size; from++) {
      for (let to = from; to <= size; to++) {
        if (!inText(from) || !inText(to)) continue;
        const selected = state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, from, to)),
        );
        for (const { command } of lists) {
          expect(() => command(selected, () => undefined)).not.toThrow();
        }
      }
    }
  });
});

describe("toolbar placement", () => {
  const rect = (top: number, bottom: number) => new DOMRect(0, top, 100, bottom - top);
  const area = { top: 52, bottom: 800 };

  it("starts at the block's top and grows down when it fits below", () => {
    expect(toolbarTopFor(rect(300, 330), rect(100, 900), 320, area)).toBe(200);
  });

  it("ends at the block's bottom and grows up when it does not fit below", () => {
    expect(toolbarTopFor(rect(700, 730), rect(100, 900), 320, area)).toBe(730 - 320 - 100);
  });

  it("keeps growing down when there is even less room above", () => {
    expect(toolbarTopFor(rect(120, 150), rect(100, 900), 900, area)).toBe(20);
  });
});
