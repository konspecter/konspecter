import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The island's search opening and closing (small screens). Opening, the panel
 * starts as a circle in the middle of the row above the island, as big as the
 * editor tools' bar, and stretches to both sides until it is as wide as it
 * is laid out; the tools' bar, over Settings, is pushed by its right edge to
 * the end of the row. Only then does its search box fade in. Closing plays
 * the same backwards (the search box fades out, then the panel shrinks), and
 * the panel stays until it has.
 */

/** How long the panel takes to stretch (or shrink back), in ms. */
export const STRETCH_MS = 200;

/** How long its search box then takes to fade in (or, first, out), in ms. */
export const FADE_MS = 100;

/** The part of the whole that the stretching takes. */
const STRETCH_SHARE = STRETCH_MS / (STRETCH_MS + FADE_MS);

/** Quick and smooth: slow out of the start, fast in the middle, settling at the end. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Where things are, in window coordinates, with the search laid out open. */
export type StretchLayout = {
  /** The middle of the row above the island. */
  readonly centre: number;
  /** The panel's height: the circle it starts as is that wide. */
  readonly size: number;
  /** The panel, open. */
  readonly panel: { readonly left: number; readonly right: number };
  /** The tools' bar, when there is one: its left edge open, and over Settings. */
  readonly tools: { readonly left: number; readonly rest: number } | null;
};

/**
 * The keyframes of the whole, to be played linearly over `STRETCH_MS` +
 * `FADE_MS`. First the stretching, `steps` + 1 evenly in time and eased in
 * place: the panel's width and shift from where it is laid out, and the
 * tools' bar's shift. The bar stays over Settings until the panel's right
 * edge reaches it, then is pushed by it, as far from it as it is when open.
 * Then the search box (hidden until then) fades in.
 */
export function stretchFrames(
  layout: StretchLayout,
  steps = 24,
): { panel: Keyframe[]; tools: Keyframe[] | null; content: Keyframe[] } {
  const { centre, size, panel, tools } = layout;
  const panelFrames: Keyframe[] = [];
  const toolsFrames: Keyframe[] = [];
  for (let step = 0; step <= steps; step++) {
    const offset = (step / steps) * STRETCH_SHARE;
    const done = ease(step / steps);
    const left = centre - size / 2 + (panel.left - (centre - size / 2)) * done;
    const right = centre + size / 2 + (panel.right - (centre + size / 2)) * done;
    panelFrames.push({
      offset,
      width: `${String(px(right - left))}px`,
      transform: `translateX(${String(px(left - panel.left))}px)`,
    });
    if (tools) {
      const gap = tools.left - panel.right;
      const rest = Math.min(tools.rest, tools.left);
      const x = Math.max(rest, Math.min(right + gap, tools.left));
      toolsFrames.push({ offset, transform: `translateX(${String(px(x - tools.left))}px)` });
    }
  }
  // Stretched, it holds while the search box fades in.
  const hold = (frames: Keyframe[]) => [...frames, { ...frames.at(-1), offset: 1 }];
  return {
    panel: hold(panelFrames),
    tools: tools ? hold(toolsFrames) : null,
    content: [
      { offset: 0, opacity: 0 },
      { offset: STRETCH_SHARE, opacity: 0, easing: "ease" },
      { offset: 1, opacity: 1 },
    ],
  };
}

/** Rounded to a hundredth of a pixel, so the keyframes stay short. */
function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Where things are now, the search laid out open; null without a panel. */
function measure(
  dock: HTMLElement,
  panel: HTMLElement,
  tools: HTMLElement | null,
): StretchLayout | null {
  const row = dock.getBoundingClientRect();
  const open = panel.getBoundingClientRect();
  if (open.width === 0) return null;
  const bar = tools?.getBoundingClientRect();
  const settings = dock.querySelector(".island-settings")?.getBoundingClientRect();
  return {
    centre: row.left + row.width / 2,
    size: open.height,
    panel: { left: open.left, right: open.right },
    tools:
      bar && bar.width > 0 && settings
        ? { left: bar.left, rest: settings.left + settings.width / 2 - bar.width / 2 }
        : null,
  };
}

/** Whether to animate: the browser can, and the person has not asked for less motion. */
function canAnimate(): boolean {
  return (
    typeof Element.prototype.animate === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Stretches the island's search open as `shown` turns true and shrinks it
 * back as it turns false (turning around mid-way, if it changes again).
 * Returns whether the panel is to be rendered: while shown, and while it
 * shrinks. Off (`enabled` false, no island), or with less motion asked
 * for, it comes and goes at once.
 */
export function useIslandStretch(
  shown: boolean,
  enabled: boolean,
  dock: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  tools: HTMLElement | null,
): boolean {
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    setLeaving(!shown && enabled && canAnimate());
  }
  const rendered = shown || leaving;
  const running = useRef<{ animations: Animation[]; forward: boolean } | null>(null);
  // What the last change animated to: nothing to do on mount, or when run again for the same.
  const animatedTo = useRef(shown);

  const stop = () => {
    running.current?.animations.forEach((animation) => {
      animation.cancel();
    });
    running.current = null;
    if (panel.current) delete panel.current.dataset.stretching;
  };

  useLayoutEffect(() => {
    if (animatedTo.current === shown) return;
    animatedTo.current = shown;
    const now = running.current;
    if (now) {
      // Turning around mid-way: on from where it is.
      if (now.forward !== shown) {
        now.forward = shown;
        now.animations.forEach((animation) => {
          animation.reverse();
        });
      }
      return;
    }
    const element = panel.current;
    const layout =
      enabled && canAnimate() && dock.current && element
        ? measure(dock.current, element, tools)
        : null;
    if (!layout || !element) {
      if (!shown) setLeaving(false);
      return;
    }
    const frames = stretchFrames(layout);
    // While it stretches, the panel clips its search box, which keeps its open width, centred.
    const box = element.querySelector(".search-box");
    if (box) {
      element.style.setProperty(
        "--stretch-width",
        `${String(box.getBoundingClientRect().width)}px`,
      );
    }
    element.dataset.stretching = "";
    const options: KeyframeAnimationOptions = {
      duration: STRETCH_MS + FADE_MS,
      easing: "linear",
      fill: "both",
    };
    const animations = [element.animate(frames.panel, options)];
    if (box) animations.push(box.animate(frames.content, options));
    if (frames.tools && tools) animations.push(tools.animate(frames.tools, options));
    const state = { animations, forward: shown };
    running.current = state;
    if (!shown) {
      animations.forEach((animation) => {
        animation.reverse();
      });
    }
    const [main] = animations;
    if (main) {
      main.onfinish = () => {
        if (running.current !== state) return;
        // Open, it is as laid out. Closed, it holds until it is gone (below).
        if (state.forward) stop();
        else setLeaving(false);
      };
    }
    // Runs as `shown` changes only: the rest is read as it is then.
  }, [shown]);

  // Gone (or off): the tools' bar goes back to its place as the panel goes, before paint.
  useLayoutEffect(() => {
    if (!rendered || !enabled) stop();
    if (!enabled && leaving) setLeaving(false);
  }, [rendered, enabled, leaving]);

  return rendered;
}
