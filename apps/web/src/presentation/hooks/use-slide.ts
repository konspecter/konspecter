import { useLayoutEffect, useRef, useState } from "react";
import { canAnimate } from "./use-fold";

/** The full-screen sidebar slides in and out this fast (ms)… */
const PANEL_MS = 220;
/** …and a page gone to by a swipe comes in this fast, from this far aside. */
const PAGE_MS = 240;
const PAGE_OFFSET = "30%";
/** Quick at first, settling gently. */
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Slides `panel` in from the left edge as `open` turns true and out to it as
 * it turns false, while `enabled` (the full-screen sidebar of small screens).
 * Returns whether it is shown: while open, and while it slides out. A toggle
 * mid-way turns it round from where it is. Disabled, or without animations
 * (reduced motion, tests), it shows and hides at once.
 */
export function useSlide(panel: HTMLElement | null, open: boolean, enabled: boolean): boolean {
  const [was, setWas] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== was) {
    setWas(open);
    setClosing(!open);
  }
  // The one animation from out of sight (start) to in place (end): playing
  // either way, or holding the panel out of sight until it is hidden.
  const animation = useRef<Animation | null>(null);
  const toggled = useRef(open);

  useLayoutEffect(() => {
    if (toggled.current === open) return;
    toggled.current = open;
    const current = animation.current;
    if (!panel || !enabled || !canAnimate(panel)) {
      current?.cancel();
      animation.current = null;
      setClosing(false);
      return;
    }
    if (current) {
      current.reverse();
      return;
    }
    const next = panel.animate([{ transform: "translateX(-100%)" }, { transform: "none" }], {
      duration: PANEL_MS,
      easing: EASING,
      fill: "both",
    });
    if (!open) next.reverse();
    animation.current = next;
    next.onfinish = () => {
      if (toggled.current) {
        next.cancel();
        animation.current = null;
      } else {
        setClosing(false);
      }
    };
  }, [panel, open, enabled]);

  return open || closing;
}

/**
 * Brings `page` in from the left (back) or the right (forward), as after a
 * swipe that way. Without animations (reduced motion, tests) it does nothing.
 */
export function slideIn(page: HTMLElement, from: "left" | "right"): void {
  if (!canAnimate(page)) return;
  const offset = from === "left" ? `-${PAGE_OFFSET}` : PAGE_OFFSET;
  page.animate(
    [
      { transform: `translateX(${offset})`, opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: PAGE_MS, easing: EASING },
  );
}
