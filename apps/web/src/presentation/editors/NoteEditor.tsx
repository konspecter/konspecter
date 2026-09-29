import type { Node } from "prosemirror-model";
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { InvalidDocumentError, documentTitle, parseDocument } from "../../domain/document/document";
import type { EditorMode } from "../../domain/settings/settings";
import { ErrorState } from "../components/ErrorState";
import { markdownToTextDoc, textDocToMarkdown } from "./text-markdown";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { MetadataFields } from "./MetadataFields";
import { TextEditor } from "./TextEditor";
import "./editors.css";
import { t } from "../i18n/i18n";
import { withBody, withSavedDates, type Note } from "../../domain/note/note";

export type { EditorMode };

// Only notes the text editor cannot represent are shown rendered; load the
// renderer for them alone.
const MarkdownView = lazy(() =>
  import("../markdown/MarkdownView").then(
    (module) => ({ default: module.MarkdownView }),
    (error: unknown) => ({
      default: () => <ErrorState title={t("editor.readerLoadFailed")} error={error} />,
    }),
  ),
);

export type NoteEditorProps = {
  /** Read when the editor mounts; remount (a new key) to open other text. */
  initialMarkdown: string;
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
};

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
    const reason = error instanceof InvalidDocumentError ? error.message : String(error);
    return {
      kind: "source",
      key,
      notice: t("editor.textUnavailable", { reason }),
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

/**
 * Edits a whole note document. Text mode edits the body as rich text, and the
 * frontmatter's title and tags follow what the body says (`withBody`);
 * Markdown mode edits the raw document as written.
 * There is no save button: every edit is reported through `onChange`.
 */
export const NoteEditor = memo(function NoteEditor({
  initialMarkdown,
  mode,
  onChange,
  onReady,
  autoFocus = false,
  titleFromFirstLine = false,
  saved = null,
  showMetadata = false,
}: NoteEditorProps) {
  // The document as of the last metadata or source edit. In text mode its
  // body is replaced by `doc` (the rich text) once that has been edited.
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [doc, setDoc] = useState<Node | null>(null);
  // For the functions handed to onChange, which run later, when saving: the
  // frontmatter as last edited, and the rich text of the current text session.
  const markdownRef = useRef(initialMarkdown);
  const docRef = useRef<{ readonly session: number; readonly doc: Node } | null>(null);
  const [shown, setShown] = useState(() => ({ mode, view: viewFor(mode, initialMarkdown, 0) }));
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

  // Whether the caret is in the editor: switching modes then (the shortcut)
  // puts it in the other editor, so typing can go on.
  const [focusWithin, setFocusWithin] = useState(false);
  let { view } = shown;

  if (mode !== shown.mode) {
    // Switching modes carries the edits over, serialized once.
    const current = doc ? withBody(markdown, textDocToMarkdown(doc)) : markdown;
    view = viewFor(mode, current, view.key + 1);
    setMarkdown(current);
    setDoc(null);
    setShown({ mode, view });
  }

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
          onChange={handleTextChange}
          autoFocus={autoFocus || focusWithin}
          titleFromFirstLine={titleFromFirstLine}
        />
      )}
      {view.kind === "source" && (
        <MarkdownSourceEditor
          key={view.key}
          initialValue={markdown}
          onChange={handleSourceChange}
          autoFocus={autoFocus || focusWithin}
          titleFromFirstLine={titleFromFirstLine}
          saved={saved}
        />
      )}
      {view.kind === "rendered" && (
        <Suspense fallback={null}>
          <MarkdownView
            markdown={view.body}
            title={view.title}
            titleDerived={view.titleDerived}
            {...(onReady ? { onRendered: onReady } : {})}
          />
        </Suspense>
      )}
    </div>
  );
});
