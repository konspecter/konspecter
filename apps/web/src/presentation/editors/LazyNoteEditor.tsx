import type { NoteEditorProps } from "./NoteEditor";
import { ErrorState } from "../components/ErrorState";
import { moduleLoader, useModule } from "../hooks/use-module";
import { t } from "../i18n/i18n";

const editor = moduleLoader(() => import("./NoteEditor"));

/**
 * Loads the editor chunk (ProseMirror, CodeMirror, markdown-it). The app
 * calls this when the browser is idle after start-up, and the note page
 * while it reads the note, so opening a note does not wait for the download
 * or the parse.
 */
export function preloadEditor(): Promise<typeof import("./NoteEditor")> {
  return editor.load();
}

export function LazyNoteEditor(props: NoteEditorProps) {
  const loaded = useModule(editor);
  // A failed load (e.g. offline before the chunk was cached) shows an error.
  if (loaded.status === "error") {
    return <ErrorState title={t("editor.loadFailed")} error={loaded.error} />;
  }
  // No loading text: the space stays empty for the moment the chunk takes.
  if (loaded.status === "loading") return <div className="note-editor" />;
  const { NoteEditor } = loaded.module;
  return <NoteEditor {...props} />;
}
