import { EditorView } from "@codemirror/view";

function sourceView(element: HTMLElement): EditorView {
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
