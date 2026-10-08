import type { Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { ChevronIcon, ExternalIcon } from "@konspecter/ui/icons";
import { openInBrowser } from "../../infrastructure/desktop/desktop";
import { reportError } from "../app/errors";
import { InIsland } from "../components/island-slot";
import { NO_FIND, revealMatch, type NoteFind } from "../components/note-find";
import {
  createTextEditorState,
  findTransaction,
  foundMatches,
  FROM_ELSEWHERE,
  isLinkActive,
  linkAtCaret,
  linkCommand,
  replaceDocument,
  TOOL_USED,
  toolbarActions,
  toolsInEffect,
} from "./text-editor-setup";
import { t, type TextKey } from "../i18n/i18n";
import { useNarrow } from "../hooks/use-narrow";
import { coveredBelow, visibleArea, type Place } from "./place";

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
  /** What to find in the text (see `NoteEditor`). */
  find?: NoteFind;
  onFindCount?: (count: number) => void;
  /** Where the reader was when the editor closes (switching modes). */
  onLeave?: (place: Place) => void;
  /**
   * Asked once the editor has opened: where to put the caret, and which text
   * to bring back to its height in the window (switching modes). Instead of
   * `initialSelection`.
   */
  arrival?: () => Place | null;
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
const LAST_TOOL_KEY = "konspecter.toolbar.last";

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

/** The tool last used on this device (unchecked: it may no longer exist). */
function initialLastUsed(): string | null {
  try {
    return localStorage.getItem(LAST_TOOL_KEY);
  } catch {
    return null;
  }
}

function rememberLastUsed(id: TextKey): void {
  try {
    localStorage.setItem(LAST_TOOL_KEY, id);
  } catch {
    // A per-device convenience; without storage the folded toolbar shows Bold.
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

/** `position`, if it is in `doc`, else its end. */
function clamp(doc: Node, position: number): number {
  return Math.min(position, doc.content.size);
}

/** The text block holding the caret, or null when the selection is not in one. */
function activeBlock(view: EditorView): HTMLElement | null {
  const { $from } = view.state.selection;
  if ($from.depth === 0) return null;
  const block = view.nodeDOM($from.before($from.depth));
  return block instanceof HTMLElement ? block : null;
}

/**
 * Where the reader is: the selection, and the caret's line if it can be seen,
 * else the line in the middle of what can be seen of the text.
 */
function placeOf(view: EditorView): Place {
  const { anchor, head } = view.state.selection;
  const area = visibleArea();
  const caret = view.coordsAtPos(head);
  if (caret.top >= area.top && caret.bottom <= area.bottom) {
    return { anchor, head, shown: { at: head, top: caret.top } };
  }
  const text = view.dom.getBoundingClientRect();
  const top = Math.min(Math.max((area.top + area.bottom) / 2, text.top), text.bottom);
  const middle =
    top >= area.top && top <= area.bottom
      ? view.posAtCoords({ left: text.left + text.width / 2, top })
      : null;
  const shown = middle && { at: middle.pos, top: view.coordsAtPos(middle.pos).top };
  return { anchor, head, shown };
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
 * Where the button that opens a link goes, relative to its container: just
 * under the caret, starting at it, moved left as far as it must to stay
 * within the container.
 */
export function linkButtonSpotFor(
  caret: { left: number; bottom: number },
  container: DOMRect,
  width: number,
): { top: number; left: number } {
  const right = Math.max(0, container.width - width);
  return {
    top: caret.bottom - container.top + 4,
    left: Math.min(Math.max(0, caret.left - container.left), right),
  };
}

/** An address as the link button shows it: without `http(s)://`. */
function shownAddress(href: string): string {
  return href.replace(/^https?:\/\//i, "");
}

/**
 * A Telegraph-like rich-text editor whose document maps one-to-one to
 * Markdown. The formatting toolbar is contextual: a vertical strip beside
 * the block being edited, shown only while the editor has focus. It is
 * positioned absolutely, so it never takes space or shifts the text, and it
 * folds to a single tool and its toggle. Small screens have no margin for it:
 * there the island holds the tool a folded toolbar would show, and pressing
 * it opens every tool (`IslandTools`).
 */
export const TextEditor = memo(function TextEditor({
  initialDoc,
  replacement = null,
  onChange,
  initialSelection = null,
  onSelectionChange,
  autoFocus = false,
  titleFromFirstLine = false,
  find = NO_FIND,
  onFindCount,
  onLeave,
  arrival,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onLeaveRef = useRef(onLeave);
  const [arrive] = useState(() => arrival);
  const [editorState, setEditorState] = useState(() => {
    const state = createTextEditorState(initialDoc, { titleFromFirstLine });
    if (!initialSelection || arrival) return state;
    const at = (position: number) => state.doc.resolve(clamp(state.doc, position));
    const selection = TextSelection.between(at(initialSelection.anchor), at(initialSelection.head));
    return state.apply(state.tr.setSelection(selection));
  });
  const [initialState] = useState(editorState);
  const [initialFocus] = useState(autoFocus || initialSelection?.focused === true);
  const [focused, setFocused] = useState(false);
  const narrow = useNarrow();
  const [toolbarTop, setToolbarTop] = useState<number | null>(null);
  const [linkButtonSpot, setLinkButtonSpot] = useState<{ top: number; left: number } | null>(null);
  const [folded, setFolded] = useState(initialFolded);
  const [lastUsed, setLastUsed] = useState(initialLastUsed);
  /** A tool was used, from the toolbar or by its shortcut. */
  const noteToolUsed = useCallback((id: TextKey) => {
    setLastUsed(id);
    rememberLastUsed(id);
  }, []);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionRef.current = onSelectionChange;
    onLeaveRef.current = onLeave;
  }, [onChange, onSelectionChange, onLeave]);

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
      // The caret is scrolled into view above the island, measured each time.
      scrollMargin: {
        top: 5,
        left: 5,
        right: 5,
        get bottom() {
          return coveredBelow() + 5;
        },
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        setEditorState(next);
        if (transaction.docChanged && !transaction.getMeta(FROM_ELSEWHERE)) {
          onChangeRef.current(next.doc);
        }
        if (transaction.selectionSet || transaction.docChanged) report();
        const tool: unknown = transaction.getMeta(TOOL_USED);
        if (typeof tool === "string") noteToolUsed(tool as TextKey);
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
    const place = arrive?.() ?? null;
    const at = (position: number) => view.state.doc.resolve(clamp(view.state.doc, position));
    if (place) {
      const selection = TextSelection.between(at(place.anchor), at(place.head));
      view.dispatch(view.state.tr.setSelection(selection));
    }
    if (initialFocus) view.focus();
    if (place?.shown) {
      const moved = view.coordsAtPos(at(place.shown.at).pos).top - place.shown.top;
      if (moved !== 0) window.scrollBy({ top: moved });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialState, initialFocus, noteToolUsed, arrive]);

  // While the text is still laid out: the effect above ends after it is gone.
  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      if (view) onLeaveRef.current?.(placeOf(view));
    },
    [],
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !replacement) return;
    const transaction = replaceDocument(view.state, replacement.doc);
    if (transaction) view.dispatch(transaction);
  }, [replacement]);

  // The search marks its matches; asked anew, it scrolls to the selected one
  // (not when the editor opens with a search under way).
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(findTransaction(view.state, find.query, find.selected));
    if (revealed.current !== null && revealed.current !== find.reveal) {
      const current = view.dom.querySelector(".find-current");
      if (current) revealMatch(current.getBoundingClientRect());
    }
    revealed.current = find.reveal;
  }, [find]);
  const findCount = foundMatches(editorState).length;
  useEffect(() => {
    onFindCount?.(findCount);
  }, [findCount, onFindCount]);

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
    if (focused && !narrow) place();
  }, [focused, narrow, folded, editorState, placed, place]);
  // Scrolling or resizing moves the text under a toolbar that should stay visible.
  useEffect(() => {
    if (!focused || narrow) return;
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [focused, narrow, place]);

  // Links cannot be followed by clicking in text being edited: while the caret
  // is in one, a button under it opens it.
  const link = focused ? linkAtCaret(editorState) : null;
  const placeLinkButton = useCallback(() => {
    const view = viewRef.current;
    const container = containerRef.current;
    const button = linkButtonRef.current;
    if (!view || !container || !button) return;
    setLinkButtonSpot(
      linkButtonSpotFor(
        view.coordsAtPos(view.state.selection.head),
        container.getBoundingClientRect(),
        button.offsetWidth,
      ),
    );
  }, []);
  const linkButtonPlaced = linkButtonSpot !== null;
  useLayoutEffect(() => {
    if (link) placeLinkButton();
  }, [link, editorState, linkButtonPlaced, placeLinkButton]);
  useEffect(() => {
    if (!link) return;
    window.addEventListener("resize", placeLinkButton);
    return () => {
      window.removeEventListener("resize", placeLinkButton);
    };
  }, [link, placeLinkButton]);

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

  function applyTool(tool: Tool) {
    noteToolUsed(tool.id);
    if (tool.command) run(tool.command);
    else handleLink();
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
  // Folded, the toolbar keeps one tool: in formatted text, the closest one in
  // effect there (the last one used, if it is among them); in plain text, the
  // last one used, else Bold.
  const inEffect = toolsInEffect(editorState);
  const pinnedId = inEffect.find((id) => id === lastUsed) ?? inEffect[0] ?? lastUsed;
  const pinned = tools.find((tool) => tool.id === pinnedId) ?? tools[0];
  const shown = folded ? tools.filter((tool) => tool === pinned) : tools;

  return (
    <div ref={containerRef} className="text-editor" onFocus={handleFocus} onBlur={handleBlur}>
      <div ref={mountRef} />
      {link && (
        <button
          ref={linkButtonRef}
          type="button"
          className="link-open"
          aria-label={t("editor.openLink", { address: link })}
          title={t("editor.openLinkHint")}
          hidden={linkButtonSpot === null}
          style={linkButtonSpot ?? undefined}
          // Keep the caret in the text when the button is clicked.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            openInBrowser(link).catch(reportError);
          }}
        >
          <ExternalIcon />
          <span className="link-open-address">{shownAddress(link)}</span>
        </button>
      )}
      {narrow ? (
        <InIsland>
          <IslandTools tools={tools} pinned={pinned} onUse={applyTool} />
        </InIsland>
      ) : (
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
            <ToolButton
              key={tool.id}
              tool={tool}
              onUse={() => {
                applyTool(tool);
              }}
            />
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
      )}
    </div>
  );
});

function ToolButton({ tool, onUse }: { tool: Tool; onUse: () => void }) {
  return (
    <button
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
      onClick={onUse}
    >
      {tool.content}
    </button>
  );
}

/**
 * The toolbar in the island (small screens): one button showing the tool a
 * folded toolbar would show; pressing it opens every tool in a column above it,
 * and using one, or tapping elsewhere, closes them again.
 */
function IslandTools({
  tools,
  pinned,
  onUse,
}: {
  tools: readonly Tool[];
  pinned: Tool | undefined;
  onUse: (tool: Tool) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element && ref.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="island-tools">
      <button
        type="button"
        className="island-button island-tool"
        aria-label={t("editor.formatting")}
        title={t("editor.showTools")}
        aria-expanded={open}
        aria-controls={id}
        data-pressed={pinned?.pressed === true}
        // Keep the editor's selection when the island is tapped.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {pinned?.content}
      </button>
      {open && (
        <div
          id={id}
          role="toolbar"
          aria-label={t("editor.formatting")}
          aria-orientation="vertical"
          className="island-toolbar"
        >
          {tools.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              onUse={() => {
                setOpen(false);
                onUse(tool);
              }}
            />
          ))}
        </div>
      )}
    </span>
  );
}
