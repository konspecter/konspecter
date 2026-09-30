import type { Node } from "prosemirror-model";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { documentTitle, parseDocument } from "../../domain/document/document";
import type { EditorSelection } from "../../domain/reading/reading";
import type { EditorMode } from "../../domain/settings/settings";
import { LazyMarkdownView } from "../markdown/LazyMarkdownView";
import { markdownToTextDoc, textDocToMarkdown } from "./text-markdown";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { MetadataFields } from "./MetadataFields";
import { TextEditor } from "./TextEditor";
import "./editors.css";
import { errorMessage } from "../app/errors";
import { t } from "../i18n/i18n";
import { withBody, withSavedDates, type Note } from "../../domain/note/note";
import { NO_FIND, type NoteFind } from "../components/note-find";
import { mapPlace, positionMap, type Place } from "./place";

export type { EditorMode };

export type NoteEditorProps = {
  /** Read when the editor mounts; remount (a new key) to open other text. */
  initialMarkdown: string;
  /**
   * A version stored elsewhere (sync, another program) to show instead of the
   * current text. It is applied in place, with the smallest change, so the
   * editor does not reload and the caret stays; it is not reported through
   * `onChange`. Only a note that now needs another kind of view (rendered
   * instead of rich text, say) is shown anew.
   */
  replacement?: Note | null;
  /**
   * A change made outside the editor (a tag removed in the Details): applied
   * to the document as it is now, in any mode, and reported through
   * `onChange` like an edit made here. A new object each time.
   */
  edit?: DocumentEdit | null;
  /** Text: rich text where possible. Markdown: the whole document as source. */
  mode: EditorMode;
  /**
   * Called after every edit with a function that returns the whole document.
   * Calling it serializes the text, so do that when saving, not per keystroke.
   */
  onChange: (read: () => string) => void;
  /** Called once the content is laid out (for restoring the reading position). */
  onReady?: () => void;
  /** Puts the caret in the editor when it opens (a new note). */
  autoFocus?: boolean;
  /** A new note: a short first line becomes the title when Enter ends it. */
  titleFromFirstLine?: boolean;
  /**
   * The stored version, after each save: the dates the save wrote (created,
   * updated) become part of the edited document at once, in every mode.
   */
  saved?: Note | null;
  /** Shows the title and cover fields even when they are empty. */
  showMetadata?: boolean;
  /**
   * Where the caret was when the note was last open: restored when the editor
   * opens in the same kind of editor, with the focus if it had it.
   */
  initialSelection?: EditorSelection | null;
  /** The caret moved, or the editor gained or lost the focus. */
  onSelectionChange?: (selection: EditorSelection) => void;
  /** What to find in the note: the matches are marked, the selected one scrolled to. */
  find?: NoteFind;
  /** How many matches the open view has, whenever that changes. */
  onFindCount?: (count: number) => void;
};

/** Turns the whole document into its edited version. */
export type DocumentEdit = { readonly apply: (markdown: string) => string };

type View =
  | { readonly kind: "text"; readonly key: number; readonly doc: Node }
  | { readonly kind: "source"; readonly key: number; readonly notice: string | null }
  | {
      readonly kind: "rendered";
      readonly key: number;
      readonly notice: string;
      readonly body: string;
      readonly title: string;
      readonly titleDerived: boolean;
    };

/**
 * How `markdown` is shown in `mode`. Text mode uses the rich-text editor only
 * if it represents the body losslessly; otherwise the note is shown rendered
 * (and edited in Markdown mode), or as source when its frontmatter is invalid.
 */
function viewFor(mode: EditorMode, markdown: string, key: number): View {
  if (mode === "markdown") return { kind: "source", key, notice: null };
  let document;
  try {
    document = parseDocument(markdown);
  } catch (error) {
    return {
      kind: "source",
      key,
      notice: t("editor.textUnavailable", { reason: errorMessage(error) }),
    };
  }
  const content = markdownToTextDoc(document.body);
  if (content.supported) return { kind: "text", key, doc: content.doc };
  return {
    kind: "rendered",
    key,
    notice: t("editor.markdownOnly", { reason: content.reason }),
    body: document.body,
    title: documentTitle(document),
    titleDerived: !document.metadata.title?.trim(),
  };
}

/** Positions of one editor → the same places in another. */
type Carry = (position: number) => number;

/** The text editor's document and the Markdown source `markdown`, whose body it shows. */
function bodyPositions(doc: Node, markdown: string) {
  const { body } = parseDocument(markdown);
  return { map: positionMap(doc, body), start: markdown.length - body.length };
}

/**
 * How the positions of the view being left (`from`, showing `doc` when it is
 * the text editor) become the next one's, for a mode switch between the two
 * editors: made when the new editor asks. Null with the rendered view, which
 * has no caret. `markdown` is the document as it is carried over.
 */
function carrying(from: View, doc: Node | null, markdown: string, to: View): (() => Carry) | null {
  if (from.kind === "text" && to.kind === "source") {
    const shown = doc ?? from.doc;
    return () => {
      const { map, start } = bodyPositions(shown, markdown);
      return (position) => start + map.toSource(position);
    };
  }
  if (from.kind === "source" && to.kind === "text") {
    return () => {
      // A caret in the frontmatter goes to the start of the body.
      const { map, start } = bodyPositions(to.doc, markdown);
      return (offset) => map.toText(Math.max(0, offset - start));
    };
  }
  return null;
}

/**
 * Edits a whole note document. Text mode edits the body as rich text, and the
 * frontmatter's title and tags follow what the body says (`withBody`);
 * Markdown mode edits the raw document as written.
 * There is no save button: every edit is reported through `onChange`.
 */
export const NoteEditor = memo(function NoteEditor({
  initialMarkdown,
  replacement = null,
  edit = null,
  mode,
  onChange,
  onReady,
  autoFocus = false,
  titleFromFirstLine = false,
  saved = null,
  showMetadata = false,
  initialSelection = null,
  onSelectionChange,
  find = NO_FIND,
  onFindCount,
}: NoteEditorProps) {
  // The document as of the last metadata or source edit. In text mode its
  // body is replaced by `doc` (the rich text) once that has been edited.
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [doc, setDoc] = useState<Node | null>(null);
  // For the functions handed to onChange, which run later, when saving: the
  // frontmatter as last edited, and the rich text of the current text session.
  const markdownRef = useRef(initialMarkdown);
  const docRef = useRef<{ readonly session: number; readonly doc: Node } | null>(null);
  const [shown, setShown] = useState<{
    readonly mode: EditorMode;
    readonly view: View;
    /** The view was opened by a mode switch: how to carry the place over. */
    readonly carry?: (() => Carry) | null;
  }>(() => ({ mode, view: viewFor(mode, initialMarkdown, 0) }));
  // The dates each save writes join the document at once: the frontmatter
  // held here (text mode), and the text read when saving.
  const [syncedWith, setSyncedWith] = useState(saved);
  if (saved !== syncedWith) {
    setSyncedWith(saved);
    if (saved) {
      const next = withSavedDates(markdown, saved);
      if (next !== markdown) setMarkdown(next);
    }
  }
  useEffect(() => {
    if (saved) markdownRef.current = withSavedDates(markdownRef.current, saved);
  }, [saved]);

  // A version from elsewhere, handed to the open editor to apply in place.
  const [incoming, setIncoming] = useState<{ doc: Node } | { markdown: string } | null>(null);

  // Whether the caret is in the editor: switching modes then (the shortcut)
  // puts it in the other editor, so typing can go on.
  const [focusWithin, setFocusWithin] = useState(false);
  let { view } = shown;

  if (mode !== shown.mode) {
    // Switching modes carries the edits over, serialized once.
    const current = doc ? withBody(markdown, textDocToMarkdown(doc)) : markdown;
    const closing = view;
    view = viewFor(mode, current, view.key + 1);
    const carry = carrying(closing, doc, current, view);
    setMarkdown(current);
    setDoc(null);
    setIncoming(null); // The new editor opens with the current text.
    setShown({ mode, view, carry });
  }

  // A version from elsewhere: into the open editor in place when it can show
  // it, otherwise as a new view.
  const [replaced, setReplaced] = useState(replacement);
  if (replacement !== replaced) {
    setReplaced(replacement);
    if (replacement) {
      const next = viewFor(mode, replacement.markdown, view.key);
      markdownRef.current = replacement.markdown;
      setMarkdown(replacement.markdown);
      if (next.kind === "text" && view.kind === "text") {
        docRef.current = { session: view.key, doc: next.doc };
        setDoc(next.doc);
        setIncoming({ doc: next.doc });
      } else if (next.kind === view.kind) {
        // Source keeps its editor (the notice may change); rendered re-renders.
        if (next.kind === "source") setIncoming({ markdown: replacement.markdown });
        view = next;
        setShown({ mode, view });
      } else {
        view = { ...next, key: view.key + 1 };
        docRef.current = null;
        setDoc(null);
        setIncoming(null);
        setShown({ mode, view });
      }
    }
  }
  const textReplacement = incoming && "doc" in incoming ? incoming : null;
  const sourceReplacement = incoming && "markdown" in incoming ? incoming : null;

  const kind = view.kind;
  useEffect(() => {
    if (kind !== "rendered") onReady?.();
  }, [kind, onReady]);

  // Edits are reported at once (a sync arriving meanwhile must see them as
  // unsaved), with functions that serialize only when called.
  const session = view.key;
  // Serializing the rich text also brings the frontmatter held here up to
  // date (a title or tag typed in the body), so the fields show what is saved.
  const serialize = useCallback((edited: Node) => {
    const current = markdownRef.current;
    const next = withBody(current, textDocToMarkdown(edited));
    if (next !== current) {
      markdownRef.current = next;
      setMarkdown(next);
    }
    return next;
  }, []);
  const handleTextChange = useCallback(
    (next: Node) => {
      docRef.current = { session, doc: next };
      setDoc(next);
      onChange(() => serialize(next));
    },
    [session, onChange, serialize],
  );
  const handleSourceChange = useCallback(
    (next: string) => {
      markdownRef.current = next;
      setMarkdown(next);
      onChange(() => next);
    },
    [onChange],
  );
  const handleMetadataChange = useCallback(
    (next: string) => {
      markdownRef.current = next;
      setMarkdown(next);
      const edited = docRef.current?.session === session ? docRef.current.doc : null;
      onChange(() => (edited ? serialize(edited) : next));
    },
    [session, onChange, serialize],
  );

  // An edit from outside joins the document as it is now: the frontmatter
  // held here in text mode (the rich text keeps the body), the source itself
  // in Markdown mode.
  const appliedEdit = useRef<DocumentEdit | null>(null);
  useEffect(() => {
    if (!edit || edit === appliedEdit.current) return;
    appliedEdit.current = edit;
    const current = markdownRef.current;
    let next: string;
    try {
      next = edit.apply(current);
    } catch {
      return; // Invalid frontmatter: nothing to change it in.
    }
    if (next === current) return;
    if (kind === "source") {
      setIncoming({ markdown: next });
      handleSourceChange(next);
    } else {
      handleMetadataChange(next);
    }
  }, [edit, kind, handleSourceChange, handleMetadataChange]);

  // The saved caret belongs to the editor first opened, if it is the kind it was saved in.
  const [openedKey] = useState(view.key);
  const caretFor = (editor: EditorSelection["editor"]) =>
    view.key === openedKey && initialSelection?.editor === editor ? initialSelection : null;
  const handleTextSelection = useCallback(
    (caret: Omit<EditorSelection, "editor">) => onSelectionChange?.({ editor: "text", ...caret }),
    [onSelectionChange],
  );
  const handleSourceSelection = useCallback(
    (caret: Omit<EditorSelection, "editor">) =>
      onSelectionChange?.({ editor: "markdown", ...caret }),
    [onSelectionChange],
  );

  // The place the closing editor left, carried into the one a mode switch opens.
  const left = useRef<Place | null>(null);
  const handleLeave = useCallback((place: Place) => {
    left.current = place;
  }, []);
  const carry = shown.carry ?? null;
  const arrived = useRef<{ readonly session: number; readonly place: Place | null } | null>(null);
  const arrival = useCallback(() => {
    // Asked again (a development double mount), it answers the same.
    if (arrived.current?.session !== session) {
      const place = left.current;
      arrived.current = { session, place: carry && place ? mapPlace(place, carry()) : null };
    }
    return arrived.current.place;
  }, [session, carry]);
  const arriving = carry ? { arrival } : {};

  // The title field's placeholder follows the body's first line as it is typed.
  const firstLine = doc?.firstChild?.textContent.trim();

  return (
    <div
      className="note-editor"
      onFocus={() => {
        setFocusWithin(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
    >
      {view.kind !== "text" && view.notice && (
        <p role="status" className="editor-notice">
          {view.notice}
        </p>
      )}
      {view.kind !== "source" && (
        <MetadataFields
          markdown={markdown}
          onChange={handleMetadataChange}
          bodyTitle={firstLine}
          expanded={showMetadata}
        />
      )}
      {view.kind === "text" && (
        <TextEditor
          key={view.key}
          initialDoc={view.doc}
          replacement={textReplacement}
          onChange={handleTextChange}
          initialSelection={caretFor("text")}
          onSelectionChange={handleTextSelection}
          autoFocus={autoFocus || focusWithin}
          titleFromFirstLine={titleFromFirstLine}
          find={find}
          {...(onFindCount ? { onFindCount } : {})}
          onLeave={handleLeave}
          {...arriving}
        />
      )}
      {view.kind === "source" && (
        <MarkdownSourceEditor
          key={view.key}
          initialValue={markdown}
          replacement={sourceReplacement}
          onChange={handleSourceChange}
          initialSelection={caretFor("markdown")}
          onSelectionChange={handleSourceSelection}
          autoFocus={autoFocus || focusWithin}
          titleFromFirstLine={titleFromFirstLine}
          saved={saved}
          find={find}
          {...(onFindCount ? { onFindCount } : {})}
          onLeave={handleLeave}
          {...arriving}
        />
      )}
      {view.kind === "rendered" && (
        <LazyMarkdownView
          markdown={view.body}
          title={view.title}
          titleDerived={view.titleDerived}
          {...(onReady ? { onRendered: onReady } : {})}
          find={find}
          {...(onFindCount ? { onFindCount } : {})}
        />
      )}
    </div>
  );
});
