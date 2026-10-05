import { LanguageDescription, LanguageSupport, LRLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, type DecorationSet, type EditorView } from "prosemirror-view";
import { blockDecorations, updatedBlockDecorations } from "./block-decorations";

/**
 * The classes code tokens get, in both editors: Markdown mode highlights its
 * fenced code with them and the text editor its code blocks. They are
 * coloured with the reader's code tokens (`editors.css`).
 */
export const codeHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: "tok-keyword" },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], class: "tok-string" },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom, tags.escape, tags.character],
    class: "tok-number",
  },
  { tag: [tags.comment, tags.meta], class: "tok-comment" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.name)], class: "tok-title" },
  { tag: [tags.typeName, tags.className], class: "tok-type" },
  { tag: [tags.propertyName, tags.attributeName], class: "tok-property" },
  { tag: [tags.tagName, tags.angleBracket], class: "tok-tag" },
]);

/**
 * PHP as notes write it: code from its first line, with or without `<?php`
 * (the grammar's default reads everything before `<?php` as HTML, so a
 * snippet without it would show plain).
 */
function plainPhp(php: LanguageDescription): LanguageDescription {
  return LanguageDescription.of({
    name: php.name,
    alias: php.alias,
    extensions: php.extensions,
    async load() {
      const support = await php.load();
      const { language } = support;
      return language instanceof LRLanguage
        ? new LanguageSupport(language.configure({ top: "Program" }), support.support)
        : support;
    },
  });
}

/**
 * The grammars fenced code is highlighted with, in both editors:
 * `@codemirror/language-data`'s (loaded on demand), PHP read as plain code.
 * Among them C (```c), C++ (```cpp, ```c++), C# (```cs, ```c#) and PHP.
 */
export const codeLanguages: readonly LanguageDescription[] = languages.map((language) =>
  language.name === "PHP" ? plainPhp(language) : language,
);

/**
 * The grammar a code block's info string names (```go, ```ts title="x"), as
 * Markdown mode finds it: from the same list, by name, alias or extension.
 */
export function codeLanguage(info: string): LanguageDescription | null {
  const name = /^\S+/.exec(info.trim())?.[0];
  return name === undefined
    ? null
    : LanguageDescription.matchLanguageName(codeLanguages, name, true);
}

/** Meta of a transaction that only says a grammar has arrived. */
const highlightKey = new PluginKey<DecorationSet>("codeHighlight");

/**
 * The tokens of the code block at `pos`, decorated with their classes. A
 * grammar that is not loaded yet is asked for (`load`) and nothing is
 * decorated until it is there.
 */
function blockTokens(
  block: Node,
  pos: number,
  load: (language: LanguageDescription) => void,
): Decoration[] {
  if (block.type.name !== "code_block") return [];
  const language = codeLanguage(String(block.attrs.params ?? ""));
  if (!language) return [];
  if (!language.support) {
    load(language);
    return [];
  }
  const decorations: Decoration[] = [];
  // A code block holds only text, so offsets in it are positions.
  highlightTree(
    language.support.language.parser.parse(block.textContent),
    codeHighlighter,
    (from, to, classes) => {
      decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: classes }));
    },
  );
  return decorations;
}

/**
 * Highlights code blocks in the language their info string names, with the
 * grammars Markdown mode uses. Grammars load on demand; when one arrives, the
 * editor's code blocks are highlighted again.
 */
export function codeHighlighting(): Plugin<DecorationSet> {
  let view: EditorView | null = null;
  const asked = new Set<LanguageDescription>();
  const load = (language: LanguageDescription) => {
    if (asked.has(language)) return;
    asked.add(language);
    language
      .load()
      .then(() => {
        if (view) view.dispatch(view.state.tr.setMeta(highlightKey, true));
      })
      .catch(() => {
        // Without its grammar the code stays plain; the next change asks again.
        asked.delete(language);
      });
  };
  const decorate = (block: Node, pos: number) => blockTokens(block, pos, load);
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_, state: EditorState) => blockDecorations(state.doc, decorate),
      apply: (tr, previous) =>
        tr.getMeta(highlightKey)
          ? blockDecorations(tr.doc, decorate)
          : tr.docChanged
            ? updatedBlockDecorations(tr, previous, decorate)
            : previous,
    },
    view(editorView) {
      view = editorView;
      return {
        destroy() {
          view = null;
        },
      };
    },
    props: {
      decorations(state) {
        return highlightKey.getState(state) ?? null;
      },
    },
  });
}
