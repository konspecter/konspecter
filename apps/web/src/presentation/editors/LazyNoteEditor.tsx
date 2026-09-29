import { lazy, Suspense, type ComponentType } from "react";
import type { NoteEditorProps } from "./NoteEditor";
import { ErrorState } from "../components/ErrorState";

let editorModule: Promise<typeof import("./NoteEditor")> | null = null;

/**
 * Loads the editor chunk (ProseMirror, CodeMirror, markdown-it). The app
 * calls this when the browser is idle after start-up, so opening a note does
 * not wait for the download or the parse.
 */
export function preloadEditor(): Promise<typeof import("./NoteEditor")> {
  editorModule ??= import("./NoteEditor").catch((error: unknown) => {
    editorModule = null; // Try again on the next request (e.g. back online).
    throw error;
  });
  return editorModule;
}

// A failed load (e.g. offline before the chunk was cached) shows an error.
const NoteEditor = lazy<ComponentType<NoteEditorProps>>(() =>
  preloadEditor().then(
    (module) => ({ default: module.NoteEditor }),
    (error: unknown) => ({
      default: () => <ErrorState title="Could not load the editor" error={error} />,
    }),
  ),
);

export function LazyNoteEditor(props: NoteEditorProps) {
  // No loading text: the space stays empty for the moment the chunk takes.
  return (
    <Suspense fallback={<div className="note-editor" />}>
      <NoteEditor {...props} />
    </Suspense>
  );
}
