import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { memo, useEffect, useRef } from "react";

type MarkdownSourceEditorProps = {
  /** Read once, when the editor mounts. */
  initialValue: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
};

// Colours come from the same tokens as the reader's code highlighting.
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--color-fg)" },
  { tag: tags.heading1, fontSize: "1.2em" },
  { tag: tags.heading2, fontSize: "1.1em" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--color-accent)" },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: "var(--color-muted)" },
  { tag: tags.monospace, color: "var(--code-string)" },
  { tag: tags.quote, color: "var(--color-muted)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  { tag: [tags.comment, tags.meta], color: "var(--code-comment)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.name)],
    color: "var(--code-title)",
  },
  { tag: [tags.typeName, tags.className], color: "var(--code-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-number)" },
  { tag: [tags.tagName], color: "var(--code-meta)" },
]);

export function createSourceExtensions(onChange: (value: string) => void) {
  return [
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
    placeholder("# Title"),
    EditorView.contentAttributes.of({ "aria-label": "Markdown", spellcheck: "true" }),
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
}: MarkdownSourceEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(initialValue);
  const autoFocusRef = useRef(autoFocus);

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
        extensions: createSourceExtensions((value) => {
          onChangeRef.current(value);
        }),
      }),
    });
    if (autoFocusRef.current) view.focus();
    return () => {
      view.destroy();
    };
  }, []);

  return <div ref={mountRef} className="markdown-source" />;
});
