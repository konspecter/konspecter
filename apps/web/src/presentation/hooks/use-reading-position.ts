import { useEffect, useState } from "react";
import {
  positionToScroll,
  scrollToPosition,
  type ReadingPositionMode,
} from "../../domain/reading/reading";
import type { NoteRepository } from "../../application/notes/note-repository";

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
 * `resume`), or not at all ("off", which also stops saving).
 */
export function useReadingPosition({ store, noteId, mode, ready, saveDelay = 400 }: Options) {
  const [offer, setOffer] = useState<{ noteId: string; position: number } | null>(null);

  useEffect(() => {
    if (!ready || mode === "off") return;
    let current = true;
    store.readingState(noteId).then(
      (state) => {
        if (!current || !state || state.position === 0) return;
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
    const save = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (pending === null) return;
      const position = pending;
      pending = null;
      store.saveReadingPosition(noteId, position).catch(() => undefined);
    };
    const onScroll = () => {
      pending = currentPosition();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(save, saveDelay);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [store, noteId, mode, saveDelay]);

  const visibleOffer = offer?.noteId === noteId && mode === "ask" ? offer : null;
  return {
    /** In "ask" mode, the saved position the reader can jump back to. */
    resumePosition: visibleOffer?.position ?? null,
    resume: () => {
      if (visibleOffer) scrollTo(visibleOffer.position);
      setOffer(null);
    },
    dismiss: () => {
      setOffer(null);
    },
  };
}
