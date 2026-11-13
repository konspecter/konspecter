import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { createSourceExtensions } from "./MarkdownSourceEditor";

/** Enter in the source editor, the caret at `|`; the text after it, the caret at `|`. */
function enter(text: string): string {
  const anchor = text.indexOf("|");
  const view = new EditorView({
    state: EditorState.create({
      doc: text.replace("|", ""),
      selection: { anchor },
      extensions: createSourceExtensions(() => {}),
    }),
  });
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter" }), "editor");
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  view.destroy();
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe("Enter in a list in the source editor", () => {
  it.each([
    ["an item's first line", "- one|\n- two", "- one\n- |\n- two"],
    [
      "the line an item wrapped onto",
      "- one that wraps\n  onto a second line|\n- two",
      "- one that wraps\n  onto a second line\n- |\n- two",
    ],
    ["an unindented (lazy) line", "- one\nlazy line|", "- one\nlazy line\n- |"],
    ["a wrapped item's middle", "- one\n  wraps here| and on", "- one\n  wraps here\n- |and on"],
    ["a nested item", "- a\n  - nested\n    wraps|", "- a\n  - nested\n    wraps\n  - |"],
    [
      "a nested item on its parent's line",
      "- - nested\n    wraps|",
      "- - nested\n    wraps\n  - |",
    ],
    ["a quoted list", "> - one\n>   wraps|", "> - one\n>   wraps\n> - |"],
    ["a task, unticked", "- [x] done\n  wraps|", "- [x] done\n  wraps\n- [ ] |"],
    ["a loose list", "- a\n\n- b\n  wraps|\n", "- a\n\n- b\n  wraps\n\n- |\n"],
    ["trailing spaces", "* one\n  wraps   |", "* one\n  wraps\n* |"],
  ])("starts the next item on %s", (_, before, after) => {
    expect(enter(before)).toBe(after);
  });

  it("numbers the new item and the ones after it", () => {
    expect(enter("1. one\n   wraps|\n2. two\n3. three\n\n5. five")).toBe(
      "1. one\n   wraps\n2. |\n3. two\n4. three\n\n5. five",
    );
    expect(enter("9) nine\n   wraps|")).toBe("9) nine\n   wraps\n10) |");
  });

  it("leaves code in an item, a quote in an item and plain text alone", () => {
    expect(enter("- one\n\n  ```\n  code|\n  ```")).toBe("- one\n\n  ```\n  code\n  |\n  ```");
    expect(enter("Some text\nwraps|")).toBe("Some text\nwraps\n|");
    expect(enter("- one\n  |wraps")).not.toContain("- |");
  });
});
