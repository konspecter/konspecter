import type { Node } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { memo, useEffect, useRef, useState, type FocusEvent } from "react";
import {
  createTextEditorState,
  isLinkActive,
  linkCommand,
  toolbarActions,
} from "./text-editor-setup";

type TextEditorProps = {
  /** Read once, when the editor mounts. */
  initialDoc: Node;
  onChange: (doc: Node) => void;
  autoFocus?: boolean;
};

/**
 * Where the toolbar starts: the top of the text block holding the caret,
 * relative to `container`. Null when the selection is not in a text block.
 */
function activeBlockTop(view: EditorView, container: HTMLElement): number | null {
  const { $from } = view.state.selection;
  if ($from.depth === 0) return null;
  const block = view.nodeDOM($from.before($from.depth));
  if (!(block instanceof HTMLElement)) return null;
  return block.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

/**
 * A Telegraph-like rich-text editor whose document maps one-to-one to
 * Markdown. The formatting toolbar is contextual: a vertical strip beside
 * the block being edited, shown only while the editor has focus. It is
 * positioned absolutely, so it never takes space or shifts the text.
 */
export const TextEditor = memo(function TextEditor({
  initialDoc,
  onChange,
  autoFocus = false,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const [editorState, setEditorState] = useState(() => createTextEditorState(initialDoc));
  const [initialState] = useState(editorState);
  const [initialFocus] = useState(autoFocus);
  const [focused, setFocused] = useState(false);
  const [toolbarTop, setToolbarTop] = useState<number | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const mount = mountRef.current;
    const container = containerRef.current;
    if (!mount || !container) return;
    const view: EditorView = new EditorView(mount, {
      state: initialState,
      attributes: {
        class: "markdown text-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Note text",
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        setEditorState(next);
        if (transaction.docChanged || transaction.selectionSet) {
          setToolbarTop(activeBlockTop(view, container));
        }
        if (transaction.docChanged) {
          onChangeRef.current(next.doc);
        }
      },
    });
    viewRef.current = view;
    if (initialFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialState, initialFocus]);

  function handleFocus() {
    setFocused(true);
    const view = viewRef.current;
    const container = containerRef.current;
    if (view && container) setToolbarTop(activeBlockTop(view, container));
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    // Moving between the text and its toolbar keeps the toolbar.
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  function run(command: (state: EditorState, dispatch: EditorView["dispatch"]) => boolean) {
    const view = viewRef.current;
    if (!view) return;
    command(view.state, view.dispatch);
    view.focus();
  }

  function handleLink() {
    const view = viewRef.current;
    if (!view) return;
    const href = isLinkActive(view.state) ? null : window.prompt("Link address");
    run(linkCommand(href?.trim() ?? null));
  }

  const toolbarVisible = focused && toolbarTop !== null;

  return (
    <div ref={containerRef} className="text-editor" onFocus={handleFocus} onBlur={handleBlur}>
      <div ref={mountRef} />
      <div
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="vertical"
        className="text-editor-toolbar"
        hidden={!toolbarVisible}
        style={toolbarTop === null ? undefined : { top: toolbarTop }}
      >
        {toolbarActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="toolbar-button"
            aria-label={action.label}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            {...(action.isActive ? { "aria-pressed": action.isActive(editorState) } : {})}
            disabled={!action.command(editorState)}
            // Keep the editor's selection when the toolbar is clicked.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              run(action.command);
            }}
          >
            {action.text}
          </button>
        ))}
        <button
          type="button"
          className="toolbar-button"
          aria-label="Link"
          title="Link"
          aria-pressed={isLinkActive(editorState)}
          disabled={editorState.selection.empty && !isLinkActive(editorState)}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={handleLink}
        >
          <svg
            className="icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
        </button>
      </div>
    </div>
  );
});
