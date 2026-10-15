import { useLayoutEffect, useRef, useState } from "react";

const DURATION_MS = 160;

function canAnimate(element: HTMLElement): boolean {
  if (typeof element.animate !== "function") return false;
  return !(
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Folds and opens `body` with an animation of its height (and its bottom
 * padding). Returns whether it is shown: while open, and while it folds. A
 * toggle during the animation turns it round from where it is. Without
 * animations (reduced motion, tests) it folds and opens at once.
 */
export function useFold(element: HTMLElement | null, open: boolean): boolean {
  const [was, setWas] = useState(open);
  const [folding, setFolding] = useState(false);
  if (open !== was) {
    setWas(open);
    setFolding(!open);
  }
  // The animation whose effect is on the body: running, or holding it folded.
  const animation = useRef<Animation | null>(null);
  const toggled = useRef(open);

  useLayoutEffect(() => {
    // Only a toggle starts an animation (not the element arriving).
    if (toggled.current === open) return;
    toggled.current = open;
    const previous = animation.current;
    animation.current = null;
    if (!element || !canAnimate(element)) {
      previous?.cancel();
      setFolding(false);
      return;
    }
    // From where it is now (folded, or mid-way if it was moving)...
    const from = {
      height: element.getBoundingClientRect().height,
      padding: getComputedStyle(element).paddingBottom,
    };
    // Hidden until now, with no animation holding it: it starts from nothing.
    if (open && previous === null) Object.assign(from, { height: 0, padding: "0px" });
    previous?.cancel();
    // ...to its own height, or to nothing.
    const to = open
      ? {
          height: element.getBoundingClientRect().height,
          padding: getComputedStyle(element).paddingBottom,
        }
      : { height: 0, padding: "0px" };

    element.style.overflow = "hidden";
    const next = element.animate(
      [
        { height: `${String(from.height)}px`, paddingBottom: from.padding },
        { height: `${String(to.height)}px`, paddingBottom: to.padding },
      ],
      // Folded, it holds at nothing until it is hidden (and until it opens again).
      { duration: DURATION_MS, easing: "ease-out", fill: open ? "none" : "forwards" },
    );
    animation.current = next;
    next.onfinish = () => {
      if (open) {
        animation.current = null;
        element.style.overflow = "";
      } else {
        setFolding(false);
      }
    };
  }, [element, open]);

  return open || folding;
}
