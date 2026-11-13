import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** Spaces, punctuation and emoji: what deleting a word passes over to reach the word. */
const PASSED = /^(?:[\s\p{P}\p{Extended_Pictographic}]|‍|️)+$/u;

/**
 * Where deleting the word before `text`'s end stops, as macOS does it (the Text
 * editor, which the system edits): back over spaces and punctuation, then over
 * the word before them. Words are Unicode's (`it's`, `snake_case` and `3.14`
 * are one; `foo-bar` is two), and a symbol (`+`, `$`, `©`) is a word of its own.
 * The space before the word stays.
 */
export function wordStartBefore(text: string): number {
  const segments = [...words.segment(text)];
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment && !PASSED.test(segment.segment)) return segment.index;
  }
  return 0;
}

/**
 * Option+Backspace (Ctrl+Backspace elsewhere) in the source editor: deletes the
 * word before the caret the way the Text editor does, rather than CodeMirror's
 * group (which stops at each run of punctuation or spaces). At a line's start it
 * joins the line to the one above; a selection is deleted as it is.
 */
export const deleteWordBackward: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const changes = state.changeByRange((range) => {
    if (!range.empty) {
      return {
        changes: { from: range.from, to: range.to },
        range: EditorSelection.cursor(range.from),
      };
    }
    const line = state.doc.lineAt(range.head);
    const from =
      range.head > line.from
        ? line.from + wordStartBefore(state.sliceDoc(line.from, range.head))
        : Math.max(0, range.head - 1);
    return { changes: { from, to: range.head }, range: EditorSelection.cursor(from) };
  });
  if (changes.changes.empty) return false;
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "delete.backward" }));
  return true;
};
