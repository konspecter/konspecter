import { useLayoutEffect, useRef, useState } from "react";

const DURATION_MS = 160;

function canAnimate(element: HTMLElement): boolean {
  if (typeof element.animate !== "function") return false;
  return !(
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The edge of the body that stays put while it folds and opens. */
export type FoldEdge = "top" | "bottom";

/** The styles that hold the body while it moves, its content at the edge that stays put. */
function hold(element: HTMLElement, edge: FoldEdge): void {
  const bottom = edge === "bottom";
  element.style.overflow = "hidden";
  element.style.display = bottom ? "flex" : "";
  element.style.flexDirection = bottom ? "column" : "";
  element.style.justifyContent = bottom ? "flex-end" : "";
}

function release(element: HTMLElement): void {
  for (const property of ["overflow", "display", "flex-direction", "justify-content"]) {
    element.style.removeProperty(property);
  }
}

/**
 * Folds and opens `body` with an animation of its height (and its bottom
 * padding). Returns whether it is shown: while open, and while it folds. A
 * toggle during the animation turns it round from where it is. The content
 * keeps to the body's `edge` that stays put (the top, or the bottom of a body
 * held at the foot of its column, which grows and shrinks upwards), and the
 * other edge covers or uncovers it. Without animations (reduced motion,
 * tests) it folds and opens at once.
 */
export function useFold(
  element: HTMLElement | null,
  open: boolean,
  edge: FoldEdge = "top",
): boolean {
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
      if (element) release(element);
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
    release(element);
    // ...to its own height, or to nothing.
    const to = open
      ? {
          height: element.getBoundingClientRect().height,
          padding: getComputedStyle(element).paddingBottom,
        }
      : { height: 0, padding: "0px" };

    hold(element, edge);
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
      release(element);
      if (open) animation.current = null;
      else setFolding(false);
    };
  }, [element, open, edge]);

  return open || folding;
}
