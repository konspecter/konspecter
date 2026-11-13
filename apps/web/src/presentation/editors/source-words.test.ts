import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { createSourceExtensions } from "./MarkdownSourceEditor";
import { deleteWordBackward } from "./source-words";

/** The source editor's text, the caret at each `|`. */
function view(text: string): EditorView {
  const parts = text.split("|");
  const carets: number[] = [];
  let doc = "";
  for (const [index, part] of parts.entries()) {
    doc += part;
    if (index < parts.length - 1) carets.push(doc.length);
  }
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(carets.map((caret) => EditorSelection.cursor(caret))),
      extensions: [EditorState.allowMultipleSelections.of(true), createSourceExtensions(() => {})],
    }),
  });
}

/** The text with a caret at each `|`. */
function shown(editor: EditorView): string {
  const doc = editor.state.doc.toString();
  const heads = editor.state.selection.ranges.map((range) => range.head).sort((a, b) => b - a);
  return heads.reduce((text, head) => `${text.slice(0, head)}|${text.slice(head)}`, doc);
}

function deleteWord(text: string): string {
  const editor = view(text);
  deleteWordBackward(editor);
  const result = shown(editor);
  editor.destroy();
  return result;
}

describe("deleting the word before the caret in the source editor", () => {
  // Each one as Option+Backspace does it in the Text editor (WebKit on macOS).
  it.each([
    ["a word", "foo bar|", "foo |"],
    ["a word and the spaces after it", "foo bar   |", "foo |"],
    ["spaces back to the word before them", "foo   |", "|"],
    ["punctuation with its word", "foo bar.|", "foo |"],
    ["closing brackets with their word", "foo (bar)|", "foo (|"],
    ["a sentence's end", "One. Two.|", "One. |"],
    ["Markdown markers with their word", "foo **bar**|", "foo **|"],
    ["a link's address", "see [site](https://example.com)|", "see [site](https://|"],
    ["an apostrophe inside the word", "it's|", "|"],
    ["an underscore inside the word", "snake_case|", "|"],
    ["a decimal number", "pi is 3.14|", "pi is |"],
    ["a hyphenated word's last part", "well-known|", "well-|"],
    ["a symbol on its own", "a + |", "a |"],
    ["the word's start before the caret", "foo bar|baz", "foo |baz"],
    ["Cyrillic", "Привет, мир!|", "Привет, |"],
    ["an indentation", "- a\n   |", "- a\n|"],
    ["a list item's text, not its marker", "- item|", "- |"],
    ["the line break at a line's start", "foo\n|bar", "foo|bar"],
    ["at every caret", "one two|\nthree four|", "one |\nthree |"],
  ])("deletes %s", (_, before, after) => {
    expect(deleteWord(before)).toBe(after);
  });

  it("deletes a selection as it is", () => {
    const editor = view("foo bar|");
    editor.dispatch({ selection: { anchor: 5, head: 7 } });
    deleteWordBackward(editor);
    expect(shown(editor)).toBe("foo b|");
    editor.destroy();
  });

  it("does nothing at the document's start", () => {
    const editor = view("|foo");
    expect(deleteWordBackward(editor)).toBe(false);
    editor.destroy();
  });

  it("is the editor's word deletion key", () => {
    const editor = view("foo bar.|");
    // jsdom is not a Mac: the key is Ctrl+Backspace there, Option+Backspace on one.
    runScopeHandlers(
      editor,
      new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true }),
      "editor",
    );
    expect(shown(editor)).toBe("foo |");
    editor.destroy();
  });
});
