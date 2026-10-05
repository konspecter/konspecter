import { useEffect, useRef } from "react";

export type Swipe = "left" | "right";

/** Where and when a touch was. */
export type TouchPoint = { readonly x: number; readonly y: number; readonly time: number };

/** A swipe moves at least this far sideways (px)… */
const MIN_DISTANCE = 60;
/** …this many times as far sideways as up or down… */
const MIN_RATIO = 2;
/** …within this time (ms). */
const MAX_DURATION = 600;

/** The direction of a touch that went from `start` to `end`, if it was a swipe. */
export function swipeDirection(start: TouchPoint, end: TouchPoint): Swipe | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.time - start.time > MAX_DURATION) return null;
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < MIN_RATIO * Math.abs(dy)) return null;
  return dx > 0 ? "right" : "left";
}

/**
 * Whether a touch starting on `target` is for something else: it is in a
 * dialog, or in something that scrolls sideways (a code block, a table).
 */
function takenElsewhere(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.matches("dialog, [role='dialog']")) return true;
    if (
      node.scrollWidth > node.clientWidth &&
      /auto|scroll/.test(getComputedStyle(node).overflowX)
    ) {
      return true;
    }
  }
  return false;
}

/** Text is being selected (the selection's handles are dragged with a touch too). */
function selecting(): boolean {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * Calls `onSwipe` when a single touch swipes sideways anywhere in the page
 * (`swipeDirection`), unless it starts in a dialog or in something that
 * scrolls sideways, or text is selected.
 */
export function useSwipe(onSwipe: (direction: Swipe) => void): void {
  const latest = useRef(onSwipe);
  useEffect(() => {
    latest.current = onSwipe;
  });
  useEffect(() => {
    let start: TouchPoint | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start =
        event.touches.length === 1 && touch && !takenElsewhere(event.target)
          ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp }
          : null;
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const from = start;
      start = null;
      if (!from || !touch || event.touches.length > 0 || selecting()) return;
      const direction = swipeDirection(from, {
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
      });
      if (direction) latest.current(direction);
    };
    const onCancel = () => {
      start = null;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, []);
}
