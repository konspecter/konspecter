import { defaultMarkdownParser, schema } from "prosemirror-markdown";
import { TextSelection, type EditorState } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import {
  createTextEditorState,
  findInDocument,
  findTransaction,
  foundMatches,
  tagDecorations,
  toolbarActions,
} from "./text-editor-setup";
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

describe("tag highlighting", () => {
  const ranges = (set: DecorationSet) => set.find().map(({ from, to }) => [from, to]);
  const shown = (state: EditorState) =>
    ranges(
      state.plugins
        .map((plugin) => plugin.getState(state) as unknown)
        .find((value) => value instanceof DecorationSet) ?? DecorationSet.empty,
    );

  it("follows every edit as a rebuild of the whole document would", () => {
    let state = createTextEditorState(
      defaultMarkdownParser.parse("#one text `#code` #two\n\n- #item x\n\n```\n#no\n```\n\nend"),
    );
    // A fixed pseudo-random series of edits: typing, deleting, inline code,
    // code blocks, splitting and joining blocks.
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const inText = (pos: number) => state.doc.resolve(pos).parent.inlineContent;
    const textPositions = () =>
      Array.from({ length: state.doc.content.size + 1 }, (_, pos) => pos).filter(inText);
    for (let step = 0; step < 400; step++) {
      const positions = textPositions();
      const at = positions[random(positions.length)] ?? 1;
      const other = positions[random(positions.length)] ?? 1;
      const [from, to] = at <= other ? [at, other] : [other, at];
      const tr = state.tr;
      switch (random(6)) {
        case 0:
        case 1:
          tr.insertText(["#", "a", " ", "_", "/", "#b"][random(6)] ?? "#", at);
          break;
        case 2:
          if (state.doc.resolve(from).sameParent(state.doc.resolve(to))) tr.delete(from, to);
          break;
        case 3:
          tr.addMark(from, to, schema.marks.code.create());
          break;
        case 4:
          tr.split(at);
          break;
        default:
          tr.setBlockType(
            from,
            to,
            random(2) === 0 ? schema.nodes.code_block : schema.nodes.paragraph,
          );
      }
      if (!tr.docChanged) continue;
      state = state.apply(tr);
      expect(shown(state)).toEqual(ranges(tagDecorations(state.doc)));
    }
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

describe("text editor search", () => {
  const found = (markdown: string, query: string) => {
    const doc = defaultMarkdownParser.parse(markdown);
    return findInDocument(doc, query).map(({ from, to }) => doc.textBetween(from, to));
  };

  it("finds across marks and after line breaks, at the right positions", () => {
    expect(found("A **Hash**Map and a  \nhashmap", "hashmap")).toEqual(["HashMap", "hashmap"]);
  });

  it("never matches from one block into the next", () => {
    expect(found("ends with hash\n\nmap starts this", "hash map")).toEqual([]);
    expect(found("- hash\n- map", "hashmap")).toEqual([]);
  });

  it("marks the selected match and searches again as the text changes", () => {
    const { view } = editorWith("map, map");
    view.dispatch(findTransaction(view.state, "map", 1));
    const classes = () =>
      [...view.dom.querySelectorAll(".find-match")].map((match) => match.className);
    expect(classes()).toEqual(["find-match", "find-match find-current"]);

    view.dispatch(view.state.tr.insertText(" map", view.state.doc.content.size - 1));
    expect(foundMatches(view.state)).toHaveLength(3);
    view.dispatch(findTransaction(view.state, "", 0));
    expect(classes()).toEqual([]);
  });
});
