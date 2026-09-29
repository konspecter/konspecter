import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder, type Command } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { memo, useEffect, useRef } from "react";
import { sourceEditorMarks } from "./source-marks";
import { t } from "../i18n/i18n";
import { TITLE_MAX_LENGTH } from "./text-editor-setup";
import { withSavedDates, type Note } from "../../domain/note/note";

type MarkdownSourceEditorProps = {
  /** Read once, when the editor mounts. */
  initialValue: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** A new note: a short first line becomes the title when Enter ends it. */
  titleFromFirstLine?: boolean;
  /** The stored version: the dates each save writes are shown in the text at once. */
  saved?: Note | null;
};

/**
 * Makes `view`'s text `next` with the smallest change (the differing middle),
 * so the caret and the rest of the text stay where they are; not undoable.
 */
function replaceInPlace(view: EditorView, next: string): void {
  const current = view.state.doc.toString();
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) from += 1;
  let toCurrent = current.length;
  let toNext = next.length;
  while (toCurrent > from && toNext > from && current[toCurrent - 1] === next[toNext - 1]) {
    toCurrent -= 1;
    toNext -= 1;
  }
  view.dispatch({
    changes: { from, to: toCurrent, insert: next.slice(from, toNext) },
    annotations: Transaction.addToHistory.of(false),
  });
}

// Colours come from the same tokens as the reader's code highlighting. The
// Markdown itself: marks muted, headings strong, links in the accent colour,
// code in the code colours; fenced code in its own language's colours.
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
  { tag: [tags.escape, tags.character], color: "var(--code-number)" },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  { tag: [tags.comment, tags.meta], color: "var(--code-comment)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.name)],
    color: "var(--code-title)",
  },
  { tag: [tags.typeName, tags.className], color: "var(--code-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-number)" },
  { tag: [tags.tagName, tags.angleBracket], color: "var(--code-meta)" },
]);

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
  { titleFromFirstLine = false }: { titleFromFirstLine?: boolean } = {},
) {
  return [
    ...(titleFromFirstLine ? [Prec.high(keymap.of([{ key: "Enter", run: firstLineTitle }]))] : []),
    history(),
    drawSelection(),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    // Markdown with GFM, fenced code highlighted in its own language (grammars
    // load on demand), and a YAML frontmatter block.
    yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
    syntaxHighlighting(highlightStyle),
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
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];
}

/** CodeMirror 6 editing the whole document as Markdown source. No autocompletion. */
export const MarkdownSourceEditor = memo(function MarkdownSourceEditor({
  initialValue,
  onChange,
  autoFocus = false,
  titleFromFirstLine = false,
  saved = null,
}: MarkdownSourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(initialValue);
  const autoFocusRef = useRef(autoFocus);
  const titleFromFirstLineRef = useRef(titleFromFirstLine);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: createSourceExtensions(
          (value) => {
            onChangeRef.current(value);
          },
          { titleFromFirstLine: titleFromFirstLineRef.current },
        ),
      }),
    });
    viewRef.current = view;
    if (autoFocusRef.current) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

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
