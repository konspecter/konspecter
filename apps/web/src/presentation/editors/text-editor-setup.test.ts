import { TextSelection, type EditorState } from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import {
  createTextEditorState,
  findInDocument,
  findTransaction,
  foundMatches,
  linkAtCaret,
  tagDecorations,
  toolbarActions,
  toolsInEffect,
  writtenAddressAt,
} from "./text-editor-setup";
import { textDocToMarkdown } from "./text-markdown";
import { linkButtonSpotFor, toolbarTopFor } from "./TextEditor";
import { textMarkdownParser, textSchema } from "./text-schema";

function editorWith(markdown: string) {
  const view = new EditorView(document.createElement("div"), {
    state: createTextEditorState(textMarkdownParser.parse(markdown)),
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

describe("paired characters in the text editor", () => {
  /** Selects [from, to] and types `key`, the system inserting `inserted`. */
  const typeOver = (markdown: string, from: number, to: number, key: string, inserted = key) => {
    const { view } = editorWith(markdown);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key })));
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, inserted, () => view.state.tr.insertText(inserted, from, to)),
    );
    const { selection, doc } = view.state;
    return {
      handled: handled ?? false,
      markdown: textDocToMarkdown(doc),
      selected: doc.textBetween(selection.from, selection.to),
    };
  };

  it.each([
    ["(", "(", "a (word) here"],
    ['"', '"', 'a "word" here'],
    ["'", "'", "a 'word' here"],
    ['"', "«", "a «word» here"],
    ['"', "“", "a “word” here"],
  ])(
    "wraps the selection in %s (the system typing %s), keeping it selected",
    (key, inserted, markdown) => {
      expect(typeOver("a word here", 3, 7, key, inserted)).toEqual({
        handled: true,
        markdown,
        selected: "word",
      });
    },
  );

  it("wraps in straight quotes in code", () => {
    expect(typeOver("`word`", 1, 5, '"', "«").markdown).toBe('`"word"`');
  });

  it("replaces the selection with other characters, and closes nothing without one", () => {
    expect(typeOver("a word here", 3, 7, "*").handled).toBe(false);
    expect(typeOver("a word here", 3, 7, "[").handled).toBe(false);
    expect(typeOver("a word here", 3, 3, "(").handled).toBe(false);
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
      textMarkdownParser.parse("#one text `#code` #two\n\n- #item x\n\n```\n#no\n```\n\nend"),
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
          tr.addMark(from, to, textSchema.marks.code.create());
          break;
        case 4:
          tr.split(at);
          break;
        default:
          tr.setBlockType(
            from,
            to,
            random(2) === 0 ? textSchema.nodes.code_block : textSchema.nodes.paragraph,
          );
      }
      if (!tr.docChanged) continue;
      state = state.apply(tr);
      expect(shown(state)).toEqual(ranges(tagDecorations(state.doc)));
    }
  });
});

describe("list tools", () => {
  const listTool = (label: string) => {
    const action = toolbarActions.find((candidate) => candidate.label === label);
    if (!action) throw new Error(`no tool ${label}`);
    return action.command;
  };

  it.each([
    ["tool.bulletList", "* one\n* two"],
    ["tool.orderedList", "1. one\n2. two"],
  ])("%s makes a list with no blank line between its items", (label, markdown) => {
    const { view } = editorWith("one\n\ntwo");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)));
    listTool(label)(view.state, view.dispatch);
    expect(textDocToMarkdown(view.state.doc)).toBe(markdown);
  });

  it("typing 1. makes a list with no blank line between its items", () => {
    const { view, type } = editorWith("x");
    view.dispatch(view.state.tr.delete(1, 2));
    for (const key of "1.") type(view.state.selection.from, key, key);
    type(view.state.selection.from, " ", " ");
    view.dispatch(view.state.tr.insertText("one"));
    view.someProp("handleKeyDown", (handle) =>
      handle(view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    view.dispatch(view.state.tr.insertText("two"));
    expect(textDocToMarkdown(view.state.doc)).toBe("1. one\n2. two");
  });

  it("run on any selection in nested lists without failing", () => {
    const state = createTextEditorState(
      textMarkdownParser.parse("text\n\n- one\n  1. inner\n- two\n\nafter"),
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

describe("tools in effect", () => {
  /** The state of `markdown` with the caret inside the first `word`. */
  const caretIn = (markdown: string, word: string) => {
    const state = createTextEditorState(textMarkdownParser.parse(markdown));
    let at = -1;
    state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? "").indexOf(word) : -1;
      if (at < 0 && index >= 0) at = pos + index + 1;
    });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  };

  it("are none in plain text", () => {
    expect(toolsInEffect(caretIn("plain text", "text"))).toEqual([]);
  });

  it.each([
    ["**bold** word", "bold", ["tool.bold"]],
    ["*leaning* word", "leaning", ["tool.italic"]],
    ["`code` word", "code", ["tool.code"]],
    ["[linked](https://example.com) word", "linked", ["tool.link"]],
    ["## Heading", "Heading", ["tool.heading"]],
    ["### Sub", "Sub", ["tool.subheading"]],
    ["```\nblock\n```", "block", ["tool.codeBlock"]],
    ["> quoted", "quoted", ["tool.quote"]],
    ["- item", "item", ["tool.bulletList"]],
    ["1. item", "item", ["tool.orderedList"]],
  ])("in %j", (markdown, word, tools) => {
    expect(toolsInEffect(caretIn(markdown, word))).toEqual(tools);
  });

  it("list the closest first: marks, the block, then the inner containers", () => {
    expect(toolsInEffect(caretIn("> - ***both***", "both"))).toEqual([
      "tool.bold",
      "tool.italic",
      "tool.bulletList",
      "tool.quote",
    ]);
    expect(toolsInEffect(caretIn("- > ## **Deep**", "Deep"))).toEqual([
      "tool.bold",
      "tool.heading",
      "tool.quote",
      "tool.bulletList",
    ]);
  });
});

describe("link at the caret", () => {
  /** The state of `markdown` with the caret `after` characters into the first `word`. */
  const caretIn = (markdown: string, word: string, after = 1) => {
    const state = createTextEditorState(textMarkdownParser.parse(markdown));
    let at = -1;
    state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? "").indexOf(word) : -1;
      if (at < 0 && index >= 0) at = pos + index + after;
    });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  };

  it("is the link's address, at its ends too", () => {
    const markdown = "See [the docs](https://example.com/docs) now";
    expect(linkAtCaret(caretIn(markdown, "docs"))).toBe("https://example.com/docs");
    expect(linkAtCaret(caretIn(markdown, "the", 0))).toBe("https://example.com/docs");
    expect(linkAtCaret(caretIn(markdown, " now", 0))).toBe("https://example.com/docs");
    expect(linkAtCaret(caretIn(markdown, "See"))).toBeNull();
  });

  it("is an address written out in the text, as the reader links it", () => {
    expect(linkAtCaret(caretIn("Go to https://example.com/a, then", "example"))).toBe(
      "https://example.com/a",
    );
    expect(linkAtCaret(caretIn("at www.example.com.", "example"))).toBe("http://www.example.com");
    expect(linkAtCaret(caretIn("Go to https://example.com now", "now"))).toBeNull();
  });

  it("is none for a selection, in code or for anything but a web address", () => {
    const state = caretIn("[docs](https://example.com)", "docs");
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)));
    expect(linkAtCaret(selected)).toBeNull();
    expect(linkAtCaret(caretIn("`https://example.com`", "example"))).toBeNull();
    expect(linkAtCaret(caretIn("```\nhttps://example.com\n```", "example"))).toBeNull();
    expect(linkAtCaret(caretIn("[mail](mailto:me@example.com)", "mail"))).toBeNull();
    expect(linkAtCaret(caretIn("[next](other.md)", "next"))).toBeNull();
  });

  it.each([
    ["(see https://en.wikipedia.org/wiki/Owl_(bird))", "https://en.wikipedia.org/wiki/Owl_(bird)"],
    ["(see https://example.com)", "https://example.com"],
    ["https://example.com/?q=1!", "https://example.com/?q=1"],
  ])("leaves out what GFM leaves out of %j", (text, address) => {
    expect(writtenAddressAt(text, text.indexOf("://"))).toBe(address);
  });
});

describe("link button placement", () => {
  const container = new DOMRect(100, 50, 600, 900);

  it("goes just under the caret, starting at it", () => {
    expect(linkButtonSpotFor({ left: 250, bottom: 320 }, container, 200)).toEqual({
      top: 274,
      left: 150,
    });
  });

  it("moves left to stay within the container", () => {
    expect(linkButtonSpotFor({ left: 650, bottom: 320 }, container, 200)).toEqual({
      top: 274,
      left: 400,
    });
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
    const doc = textMarkdownParser.parse(markdown);
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

describe("task lists", () => {
  /** Presses `key` in the editor, as the keymaps see it. */
  const press = (view: EditorView, key: string, init: KeyboardEventInit = {}) =>
    view.someProp("handleKeyDown", (handle) =>
      handle(view, new KeyboardEvent("keydown", { key, ...init })),
    );
  const caretAt = (view: EditorView, pos: number) => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  };

  it("shows a checkbox that ticks and unticks the task", () => {
    const { view } = editorWith("- [ ] todo\n- plain");
    const boxes = () => [...view.dom.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes().map((box) => box.checked)).toEqual([false]);

    boxes()[0]?.click();
    expect(textDocToMarkdown(view.state.doc)).toBe("* [x] todo\n* plain");
    expect(boxes().map((box) => box.checked)).toEqual([true]);
    expect(view.dom.querySelector("li")).toHaveAttribute("data-checked", "true");

    boxes()[0]?.click();
    expect(textDocToMarkdown(view.state.doc)).toBe("* [ ] todo\n* plain");
  });

  it("makes a task of a list item when [ ] or [x] is typed at its start", () => {
    const { view, type } = editorWith("- one\n- two");
    for (const key of "[x]") type(view.state.selection.from, key, key);
    type(view.state.selection.from, " ", " ");
    expect(textDocToMarkdown(view.state.doc)).toBe("* [x] one\n* two");

    caretAt(view, 10);
    for (const key of "[]") type(view.state.selection.from, key, key);
    type(view.state.selection.from, " ", " ");
    expect(textDocToMarkdown(view.state.doc)).toBe("* [x] one\n* [ ] two");
  });

  it("leaves [ ] typed outside a list item's start as text", () => {
    const { view, type } = editorWith("text");
    caretAt(view, 1);
    for (const key of "[ ] ") type(view.state.selection.from, key, key);
    expect(textDocToMarkdown(view.state.doc)).toBe("\\[ \\] text");
  });

  it("continues a task list with an unticked task on Enter", () => {
    const { view } = editorWith("- [x] one");
    caretAt(view, 6);
    press(view, "Enter");
    view.dispatch(view.state.tr.insertText("two"));
    expect(textDocToMarkdown(view.state.doc)).toBe("* [x] one\n* [ ] two");
  });

  it("makes a task an ordinary item with Backspace at the start of its text", () => {
    const { view } = editorWith("- [ ] one");
    caretAt(view, 3);
    press(view, "Backspace");
    expect(textDocToMarkdown(view.state.doc)).toBe("* one");
    expect(view.dom.querySelector("input[type=checkbox]")).toBeNull();
  });

  it("ticks the task at the caret with Mod-Enter", () => {
    const { view } = editorWith("- [ ] one\n- two");
    caretAt(view, 4);
    press(view, "Enter", { ctrlKey: true });
    expect(textDocToMarkdown(view.state.doc)).toBe("* [x] one\n* two");
  });
});
