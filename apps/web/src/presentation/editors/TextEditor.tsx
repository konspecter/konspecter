import type { Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { ChevronIcon } from "../components/icons";
import {
  createTextEditorState,
  FROM_ELSEWHERE,
  isLinkActive,
  linkCommand,
  replaceDocument,
  toolbarActions,
} from "./text-editor-setup";
import { t, type TextKey } from "../i18n/i18n";

type TextEditorProps = {
  /** Read once, when the editor mounts. */
  initialDoc: Node;
  /**
   * A version from elsewhere to show instead, in place: the caret and the
   * scroll position stay, and it is not reported as an edit (a new object
   * each time).
   */
  replacement?: { readonly doc: Node } | null;
  onChange: (doc: Node) => void;
  /** Where the caret goes when the editor opens (clamped to the document). */
  initialSelection?: Caret | null;
  /** The caret moved, or the editor gained or lost the focus. */
  onSelectionChange?: (caret: Caret) => void;
  autoFocus?: boolean;
  /** A new note: a short first line becomes the title when Enter ends it. */
  titleFromFirstLine?: boolean;
};

/** A caret in ProseMirror positions, and whether the editor has the focus. */
export type Caret = { readonly anchor: number; readonly head: number; readonly focused: boolean };

type Tool = {
  /** Identifies the tool (a message key). */
  readonly id: TextKey;
  readonly label: string;
  readonly title: string;
  readonly content: ReactNode;
  /** Whether it is in effect at the caret; undefined for tools that are not toggles. */
  readonly pressed: boolean | undefined;
  readonly disabled: boolean;
  /** What it does; null for the link tool, which asks for an address. */
  readonly command: Command | null;
};

const TOOLBAR_KEY = "konspecter.toolbar";

/** The toolbar starts folded unless it was last unfolded on this device. */
function initialFolded(): boolean {
  try {
    return localStorage.getItem(TOOLBAR_KEY) !== "open";
  } catch {
    return true;
  }
}

function rememberFolded(folded: boolean): void {
  try {
    localStorage.setItem(TOOLBAR_KEY, folded ? "folded" : "open");
  } catch {
    // A per-device convenience; without storage the toolbar starts folded.
  }
}

function LinkIcon() {
  return (
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
  );
}

/** The text block holding the caret, or null when the selection is not in one. */
function activeBlock(view: EditorView): HTMLElement | null {
  const { $from } = view.state.selection;
  if ($from.depth === 0) return null;
  const block = view.nodeDOM($from.before($from.depth));
  return block instanceof HTMLElement ? block : null;
}

/**
 * The part of the window where the toolbar can be seen: below the page's
 * sticky top bar (when there is one) and above the window's bottom edge.
 */
function visibleArea(): { top: number; bottom: number } {
  const topBar = document.querySelector(".topbar");
  return { top: topBar?.getBoundingClientRect().bottom ?? 0, bottom: window.innerHeight };
}

/**
 * Where the toolbar goes, relative to its container. It starts at the top of
 * the block and grows down; when it does not fit below within the window and
 * there is more room above, it ends at the block's bottom and grows up. It
 * stays on the same side of the text either way.
 */
export function toolbarTopFor(
  block: DOMRect,
  container: DOMRect,
  height: number,
  area: { top: number; bottom: number },
): number {
  const below = area.bottom - block.top;
  const above = block.bottom - area.top;
  const upward = height > below && above > below;
  return (upward ? block.bottom - height : block.top) - container.top;
}

/**
 * A Telegraph-like rich-text editor whose document maps one-to-one to
 * Markdown. The formatting toolbar is contextual: a vertical strip beside
 * the block being edited, shown only while the editor has focus. It is
 * positioned absolutely, so it never takes space or shifts the text, and it
 * folds to a single tool and its toggle.
 */
export const TextEditor = memo(function TextEditor({
  initialDoc,
  replacement = null,
  onChange,
  initialSelection = null,
  onSelectionChange,
  autoFocus = false,
  titleFromFirstLine = false,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const [editorState, setEditorState] = useState(() => {
    const state = createTextEditorState(initialDoc, { titleFromFirstLine });
    if (!initialSelection) return state;
    const size = state.doc.content.size;
    const at = (position: number) => state.doc.resolve(Math.min(position, size));
    const selection = TextSelection.between(at(initialSelection.anchor), at(initialSelection.head));
    return state.apply(state.tr.setSelection(selection));
  });
  const [initialState] = useState(editorState);
  const [initialFocus] = useState(autoFocus || initialSelection?.focused === true);
  const [focused, setFocused] = useState(false);
  const [toolbarTop, setToolbarTop] = useState<number | null>(null);
  const [folded, setFolded] = useState(initialFolded);
  const [lastUsed, setLastUsed] = useState<TextKey | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionRef.current = onSelectionChange;
  }, [onChange, onSelectionChange]);

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
        "aria-label": t("editor.text"),
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        setEditorState(next);
        if (transaction.docChanged && !transaction.getMeta(FROM_ELSEWHERE)) {
          onChangeRef.current(next.doc);
        }
        if (transaction.selectionSet || transaction.docChanged) report();
      },
      handleDOMEvents: {
        focus: () => {
          report(true);
          return false;
        },
        blur: () => {
          // Once the focus has moved: a window that loses the focus (another
          // app, closing) keeps it in the editor, and so does the caret.
          setTimeout(() => {
            if (viewRef.current === view) report();
          }, 0);
          return false;
        },
      },
    });
    function report(focused = view.hasFocus()) {
      const { anchor, head } = view.state.selection;
      onSelectionRef.current?.({ anchor, head, focused });
    }
    viewRef.current = view;
    if (initialFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialState, initialFocus]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !replacement) return;
    const transaction = replaceDocument(view.state, replacement.doc);
    if (transaction) view.dispatch(transaction);
  }, [replacement]);

  // Place the toolbar after every render that can move the caret's block or
  // change the toolbar's height (folding), and again once it shows, when its
  // height can be measured.
  const place = useCallback(() => {
    const view = viewRef.current;
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    if (!view || !container || !toolbar) return;
    const block = activeBlock(view);
    setToolbarTop(
      block
        ? toolbarTopFor(
            block.getBoundingClientRect(),
            container.getBoundingClientRect(),
            toolbar.offsetHeight,
            visibleArea(),
          )
        : null,
    );
  }, []);
  const placed = toolbarTop !== null;
  useLayoutEffect(() => {
    if (focused) place();
  }, [focused, folded, editorState, placed, place]);
  // Scrolling or resizing moves the text under a toolbar that should stay visible.
  useEffect(() => {
    if (!focused) return;
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [focused, place]);

  function handleFocus() {
    setFocused(true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    // Moving between the text and its toolbar keeps the toolbar.
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  function run(command: Command) {
    const view = viewRef.current;
    if (!view) return;
    command(view.state, view.dispatch);
    view.focus();
  }

  function handleLink() {
    const view = viewRef.current;
    if (!view) return;
    const href = isLinkActive(view.state) ? null : window.prompt(t("editor.linkAddress"));
    run(linkCommand(href?.trim() ?? null));
  }

  const toolbarVisible = focused && toolbarTop !== null;
  const linkActive = isLinkActive(editorState);
  const tools: Tool[] = [
    ...toolbarActions.map((action) => ({
      id: action.label,
      label: t(action.label),
      title: action.shortcut ? `${t(action.label)} (${action.shortcut})` : t(action.label),
      content: action.text,
      pressed: action.isActive?.(editorState),
      disabled: !action.command(editorState),
      command: action.command,
    })),
    {
      id: "tool.link",
      label: t("tool.link"),
      title: t("tool.link"),
      content: <LinkIcon />,
      pressed: linkActive,
      disabled: editorState.selection.empty && !linkActive,
      command: null,
    },
  ];
  // Folded, the toolbar keeps one tool: the one in effect at the caret, else
  // the last one used, else Bold.
  const pinned =
    tools.find((tool) => tool.pressed === true) ??
    tools.find((tool) => tool.id === lastUsed) ??
    tools[0];
  const shown = folded ? tools.filter((tool) => tool === pinned) : tools;

  return (
    <div ref={containerRef} className="text-editor" onFocus={handleFocus} onBlur={handleBlur}>
      <div ref={mountRef} />
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={t("editor.formatting")}
        aria-orientation="vertical"
        className="text-editor-toolbar"
        data-folded={folded}
        hidden={!toolbarVisible}
        style={toolbarTop === null ? undefined : { top: toolbarTop }}
      >
        {shown.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="toolbar-button"
            aria-label={tool.label}
            title={tool.title}
            {...(tool.pressed === undefined ? {} : { "aria-pressed": tool.pressed })}
            disabled={tool.disabled}
            // Keep the editor's selection when the toolbar is clicked.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              setLastUsed(tool.id);
              if (tool.command) run(tool.command);
              else handleLink();
            }}
          >
            {tool.content}
          </button>
        ))}
        <button
          type="button"
          className="toolbar-button toolbar-fold"
          aria-label={t("editor.allTools")}
          title={folded ? t("editor.showTools") : t("editor.foldTools")}
          aria-expanded={!folded}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setFolded(!folded);
            rememberFolded(!folded);
          }}
        >
          <ChevronIcon />
        </button>
      </div>
    </div>
  );
});
