import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  gotoLine,
  highlightSelectionMatches,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  keymap,
  placeholder,
  type Command,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { codeHighlighter, codeLanguages } from "./code-highlight";
import { textChanges } from "./diff";
import { sourceEditorMarks } from "./source-marks";
import { t } from "../i18n/i18n";
import { TITLE_MAX_LENGTH } from "./text-editor-setup";
import { withSavedDates, type Note } from "../../domain/note/note";
import { findMatches, type Match } from "../../domain/search/find";
import { NO_FIND, type NoteFind } from "../components/note-find";
import { coveredBelow, visibleArea, type Place } from "./place";

type MarkdownSourceEditorProps = {
  /** Read once, when the editor mounts. */
  initialValue: string;
  onChange: (value: string) => void;
  /** Where the caret goes when the editor opens (clamped to the text). */
  initialSelection?: Caret | null;
  /** The caret moved, or the editor gained or lost the focus. */
  onSelectionChange?: (caret: Caret) => void;
  autoFocus?: boolean;
  /** A new note: a short first line becomes the title when Enter ends it. */
  titleFromFirstLine?: boolean;
  /** The stored version: the dates each save writes are shown in the text at once. */
  saved?: Note | null;
  /**
   * A version from elsewhere to show instead, in place: the caret and the
   * scroll position stay, and it is not reported as an edit (a new object
   * each time).
   */
  replacement?: { readonly markdown: string } | null;
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

/** A caret in characters of the text, and whether the editor has the focus. */
export type Caret = { readonly anchor: number; readonly head: number; readonly focused: boolean };

/** Marks a change that shows a version from elsewhere: not an edit of this editor. */
const fromElsewhere = Annotation.define<boolean>();

/**
 * Makes `view`'s text `next` with the smallest changes: only the lines that
 * differ, narrowed to their characters. The caret, the scroll position and the
 * rest of the text stay where they are; not undoable.
 */
function replaceInPlace(view: EditorView, next: string, elsewhere = false): void {
  view.dispatch({
    changes: textChanges(view.state.doc.toString(), next),
    annotations: [Transaction.addToHistory.of(false), fromElsewhere.of(elsewhere)],
  });
}

// Colours come from the same tokens as the reader's code highlighting. The
// Markdown itself: marks muted, headings strong, links in the accent colour,
// code in the code colours. Fenced code and the frontmatter have their
// language's tokens, classed by the highlighter the text editor uses too.
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--color-fg)" },
  { tag: tags.heading1, fontSize: "1.2em" },
  { tag: tags.heading2, fontSize: "1.1em" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--color-accent)" },
  { tag: tags.url, color: "var(--color-accent)", opacity: "0.8" },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: "var(--color-muted)" },
  { tag: [tags.labelName, tags.list], color: "var(--code-number)" },
  { tag: tags.monospace, color: "var(--code-string)" },
  { tag: tags.quote, color: "var(--color-muted)", fontStyle: "italic" },
]);

/** A search in the text (the top bar's, see `NoteFind`): its matches and the selected one. */
type SourceFind = {
  readonly query: string;
  readonly selected: number;
  readonly matches: readonly Match[];
  readonly decorations: DecorationSet;
};

const askFind = StateEffect.define<{ query: string; selected: number }>();
const matchMark = Decoration.mark({ class: "find-match" });
const currentMark = Decoration.mark({ class: "find-match find-current" });

/** Marks the matches of a search; the text is searched again as it changes. */
const findField = StateField.define<SourceFind>({
  create: () => ({ query: "", selected: 0, matches: [], decorations: Decoration.none }),
  update(previous, transaction) {
    let { query, selected } = previous;
    for (const effect of transaction.effects) {
      if (effect.is(askFind)) ({ query, selected } = effect.value);
    }
    if (query === "" && previous.query === "") return previous;
    const same = query === previous.query && !transaction.docChanged;
    if (same && selected === previous.selected) return previous;
    const matches = same ? previous.matches : findMatches(transaction.newDoc.toString(), query);
    const current = Math.min(selected, matches.length - 1);
    const decorations = Decoration.set(
      matches.map(({ from, to }, index) =>
        (index === current ? currentMark : matchMark).range(from, to),
      ),
    );
    return { query, selected, matches, decorations };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * In a new note, Enter at the end of the first line makes it the title
 * (`# line`) if it is short and not already Markdown syntax. Only while the
 * note is that one line, so it happens once.
 */
export const firstLineTitle: Command = (view) => {
  const { state } = view;
  const { doc, selection } = state;
  const line = doc.toString();
  const text = line.trim();
  if (
    doc.lines !== 1 ||
    !selection.main.empty ||
    selection.main.head !== doc.length ||
    text === "" ||
    text.length >= TITLE_MAX_LENGTH ||
    /^(?:#|---|>|[-*+]\s|\d+[.)]\s|```)/.test(text)
  ) {
    return false;
  }
  const insert = `# ${text}\n`;
  view.dispatch({
    changes: { from: 0, to: doc.length, insert },
    selection: { anchor: insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

export function createSourceExtensions(
  onChange: (value: string) => void,
  {
    titleFromFirstLine = false,
    onSelectionChange,
    onFindCount,
  }: {
    titleFromFirstLine?: boolean;
    onSelectionChange?: (caret: Caret) => void;
    onFindCount?: (count: number) => void;
  } = {},
) {
  return [
    ...(titleFromFirstLine ? [Prec.high(keymap.of([{ key: "Enter", run: firstLineTitle }]))] : []),
    history(),
    drawSelection(),
    highlightSelectionMatches(),
    // Searching is the top bar's (Mod+F); CodeMirror keeps its selection commands.
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
      { key: "Mod-Shift-l", run: selectSelectionMatches },
      { key: "Mod-Alt-g", run: gotoLine },
      indentWithTab,
    ]),
    findField,
    // The caret is scrolled into view above the island (small screens).
    EditorView.scrollMargins.of(() => ({ bottom: coveredBelow() })),
    // Markdown with GFM, fenced code highlighted in its own language (grammars
    // load on demand), and a YAML frontmatter block.
    yamlFrontmatter({
      content: markdown({ base: markdownLanguage, codeLanguages: [...codeLanguages] }),
    }),
    syntaxHighlighting(highlightStyle),
    syntaxHighlighting(codeHighlighter),
    EditorView.lineWrapping,
    placeholder(t("editor.sourcePlaceholder")),
    sourceEditorMarks(),
    EditorView.contentAttributes.of({
      "aria-label": t("editor.source"),
      spellcheck: "true",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.focusChanged || update.docChanged) {
        const { anchor, head } = update.state.selection.main;
        onSelectionChange?.({ anchor, head, focused: update.view.hasFocus });
      }
      const found = update.state.field(findField);
      if (found !== update.startState.field(findField)) onFindCount?.(found.matches.length);
      if (!update.docChanged) return;
      if (update.transactions.some((transaction) => transaction.annotation(fromElsewhere))) return;
      onChange(update.state.doc.toString());
    }),
  ];
}

/**
 * Where the reader is: the selection, and the caret's line if it can be seen,
 * else the line in the middle of what can be seen of the text.
 */
function placeOf(view: EditorView): Place {
  const { anchor, head } = view.state.selection.main;
  const area = visibleArea();
  const caret = view.coordsAtPos(head);
  if (caret && caret.top >= area.top && caret.bottom <= area.bottom) {
    return { anchor, head, shown: { at: head, top: caret.top } };
  }
  const text = view.contentDOM.getBoundingClientRect();
  const top = Math.min(Math.max((area.top + area.bottom) / 2, text.top), text.bottom);
  if (top < area.top || top > area.bottom) return { anchor, head, shown: null };
  const at = view.posAtCoords({ x: text.left + text.width / 2, y: top }, false);
  return { anchor, head, shown: { at, top: view.coordsAtPos(at)?.top ?? top } };
}

/** CodeMirror 6 editing the whole document as Markdown source. No autocompletion. */
export const MarkdownSourceEditor = memo(function MarkdownSourceEditor({
  initialValue,
  onChange,
  autoFocus = false,
  titleFromFirstLine = false,
  saved = null,
  replacement = null,
  initialSelection = null,
  onSelectionChange,
  find = NO_FIND,
  onFindCount,
  onLeave,
  arrival,
}: MarkdownSourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onFindCountRef = useRef(onFindCount);
  const onLeaveRef = useRef(onLeave);
  const arrivalRef = useRef(arrival);
  const initialValueRef = useRef(initialValue);
  const initialSelectionRef = useRef(initialSelection);
  const autoFocusRef = useRef(autoFocus || initialSelection?.focused === true);
  const titleFromFirstLineRef = useRef(titleFromFirstLine);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionRef.current = onSelectionChange;
    onFindCountRef.current = onFindCount;
    onLeaveRef.current = onLeave;
  }, [onChange, onSelectionChange, onFindCount, onLeave]);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    const doc = initialValueRef.current;
    const arrive = arrivalRef.current;
    const caret = arrive ? null : initialSelectionRef.current;
    const at = (position: number) => Math.min(position, doc.length);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        ...(caret ? { selection: EditorSelection.single(at(caret.anchor), at(caret.head)) } : {}),
        extensions: createSourceExtensions(
          (value) => {
            onChangeRef.current(value);
          },
          {
            titleFromFirstLine: titleFromFirstLineRef.current,
            onSelectionChange: (next) => onSelectionRef.current?.(next),
            onFindCount: (count) => onFindCountRef.current?.(count),
          },
        ),
      }),
    });
    viewRef.current = view;
    const place = arrive?.() ?? null;
    if (place)
      view.dispatch({ selection: EditorSelection.single(at(place.anchor), at(place.head)) });
    if (autoFocusRef.current) view.focus();
    // CodeMirror scrolls once it has measured the lines: the held text's line
    // goes back to its height in the window.
    if (place?.shown) {
      const { at: shown, top } = place.shown;
      view.dispatch({
        effects: EditorView.scrollIntoView(at(shown), { y: "start", yMargin: top }),
      });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // While the text is still laid out: the effect above ends after it is gone.
  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      if (view) onLeaveRef.current?.(placeOf(view));
    },
    [],
  );

  // A version from elsewhere first: the stored version that comes with it
  // then has the same dates, so the effect below changes nothing.
  useEffect(() => {
    const view = viewRef.current;
    if (view && replacement) replaceInPlace(view, replacement.markdown, true);
  }, [replacement]);

  // The search marks its matches; asked anew, it scrolls to the selected one
  // (not when the editor opens with a search under way). CodeMirror draws
  // only the lines in view, so it does the scrolling itself.
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: askFind.of({ query: find.query, selected: find.selected }) });
    const { matches, selected } = view.state.field(findField);
    const current = matches[Math.min(selected, matches.length - 1)];
    if (current && revealed.current !== null && revealed.current !== find.reveal) {
      view.dispatch({ effects: EditorView.scrollIntoView(current.from, { y: "center" }) });
    }
    revealed.current = find.reveal;
  }, [find]);

  // After each save, the frontmatter's dates follow the stored version.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !saved) return;
    const current = view.state.doc.toString();
    const next = withSavedDates(current, saved);
    if (next !== current) replaceInPlace(view, next);
  }, [saved]);

  return <div ref={mountRef} className="markdown-source" />;
});
