import { useCallback, useEffect, useRef, useState } from "react";
import {
  positionToScroll,
  scrollToPosition,
  type EditorSelection,
  type ReadingPositionMode,
} from "../../domain/reading/reading";
import type { NoteRepository } from "../../application/notes/note-repository";
import { saveBeforeClosing } from "../app/closing";

function currentPosition(): number | null {
  const { scrollHeight } = document.documentElement;
  return scrollToPosition(window.scrollY, scrollHeight, window.innerHeight);
}

function scrollTo(position: number): void {
  const { scrollHeight } = document.documentElement;
  window.scrollTo({ top: positionToScroll(position, scrollHeight, window.innerHeight) });
}

type Options = {
  store: NoteRepository;
  noteId: string;
  mode: ReadingPositionMode;
  /** True once the note's content is laid out, so positions mean something. */
  ready: boolean;
  /** Milliseconds of scroll inactivity before saving. */
  saveDelay?: number;
};

/**
 * Saves the reader's scroll position per note and brings it back when the
 * note is opened again: automatically ("restore"), on request ("ask", via
 * `resume`), or not at all ("off", which also stops saving). The caret is
 * saved alongside (`rememberSelection`); the note page restores it.
 */
export function useReadingPosition({ store, noteId, mode, ready, saveDelay = 400 }: Options) {
  const [offer, setOffer] = useState<{ noteId: string; position: number } | null>(null);
  // Once per editing session: a note that gets a new id while open (its file
  // renamed after the title) stays where it is.
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || mode === "off" || restored.current) return;
    let current = true;
    store.readingState(noteId).then(
      (state) => {
        if (!current) return;
        restored.current = true;
        if (!state || state.position === 0) return;
        if (mode === "restore") {
          scrollTo(state.position);
        } else {
          setOffer({ noteId, position: state.position });
        }
      },
      () => undefined, // Without a saved position the note simply opens at the top.
    );
    return () => {
      current = false;
    };
  }, [store, noteId, mode, ready]);

  // Saving needs no readiness check: until the content is laid out the page
  // does not scroll, and there is no position to save.
  useEffect(() => {
    if (mode === "off") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: number | null = null;
    const save = (): Promise<void> => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (pending === null) return Promise.resolve();
      const position = pending;
      pending = null;
      return store.saveReadingPosition(noteId, position).catch(() => undefined);
    };
    const unregister = saveBeforeClosing(save);
    const onScroll = () => {
      pending = currentPosition();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void save(), saveDelay);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") void save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const onPageHide = () => void save();
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      unregister();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHidden);
      void save();
    };
  }, [store, noteId, mode, saveDelay]);

  // The caret, saved the same way: a moment after it stops moving, and at
  // once when the page is hidden or closed.
  const selectionSaver = useRef<((selection: EditorSelection) => void) | null>(null);
  useEffect(() => {
    if (mode === "off" || noteId === "") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: EditorSelection | null = null;
    const save = (): Promise<void> => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (pending === null) return Promise.resolve();
      const selection = pending;
      pending = null;
      return store.saveEditorSelection(noteId, selection).catch(() => undefined);
    };
    const unregister = saveBeforeClosing(save);
    const onHidden = () => {
      if (document.visibilityState === "hidden") void save();
    };
    selectionSaver.current = (selection) => {
      pending = selection;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void save(), saveDelay);
    };
    const onPageHide = () => void save();
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      unregister();
      selectionSaver.current = null;
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHidden);
      void save();
    };
  }, [store, noteId, mode, saveDelay]);
  const rememberSelection = useCallback((selection: EditorSelection) => {
    selectionSaver.current?.(selection);
  }, []);

  const visibleOffer = offer?.noteId === noteId && mode === "ask" ? offer : null;
  return {
    /** In "ask" mode, the saved position the reader can jump back to. */
    resumePosition: visibleOffer?.position ?? null,
    /** Saves where the caret is (the editor reports it as it moves). */
    rememberSelection,
    resume: () => {
      if (visibleOffer) scrollTo(visibleOffer.position);
      setOffer(null);
    },
    dismiss: () => {
      setOffer(null);
    },
  };
}
