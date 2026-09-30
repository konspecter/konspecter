import { EditorView } from "@codemirror/view";

export function sourceView(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("Element is not inside a CodeMirror editor");
  return view;
}

/** The Markdown source editor's current text. */
export function sourceValue(element: HTMLElement): string {
  return sourceView(element).state.doc.toString();
}

/** Replaces the Markdown source editor's text, as a user edit would. */
export function setSourceValue(element: HTMLElement, text: string): void {
  const view = sourceView(element);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    userEvent: "input",
  });
}

/**
 * Types `key` at `at` (a position, or a selected [from, to]) the way a system
 * text substitution does: the key goes down, then the input handlers see
 * `inserted` (e.g. « for a typed "). Returns false when no handler took the
 * input (the default would insert it).
 */
export function typeSubstituted(
  element: HTMLElement,
  at: number | readonly [number, number],
  key: string,
  inserted: string,
): boolean {
  const view = sourceView(element);
  const [from, to] = typeof at === "number" ? [at, at] : at;
  view.dispatch({ selection: { anchor: from, head: to } });
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const insert = () => view.state.update({ changes: { from, to, insert: inserted } });
  return view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, inserted, insert));
}
