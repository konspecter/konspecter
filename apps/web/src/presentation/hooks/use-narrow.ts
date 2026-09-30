import { useSyncExternalStore } from "react";

/** Phones and narrow windows: the small-screen layout's breakpoint (as in `app.css`). */
export const NARROW = "(max-width: 760px)";

function subscribe(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

export function isNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

/** Whether the small-screen layout is in effect; follows the window as it resizes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrow);
}
