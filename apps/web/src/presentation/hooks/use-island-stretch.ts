import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The island's panels opening and closing (small screens), each out of a
 * circle as big as the editor tools' bar, which first fades in.
 *
 * The search: the circle sits in the middle of the row above the island and
 * stretches to both sides until it is as wide as the panel is laid out; the
 * tools' bar, over Settings, is pushed by its right edge to the end of the
 * row. The editor's toolbar: the circle sits at its foot, just above the
 * tools' bar, and grows upwards until the column is as tall as it is laid out.
 *
 * Only then does what the panel holds fade in. Closing plays the same
 * backwards (what it holds fades out, the panel shrinks, the circle fades
 * out), and the panel stays until it has.
 */

/** How long the circle takes to fade in (or, last, out), in ms. */
export const APPEAR_MS = 100;

/** How long the panel then takes to stretch (or shrink back), in ms. */
export const STRETCH_MS = 200;

/** How long what it holds then takes to fade in (or, first, out), in ms. */
export const FADE_MS = 100;

/** The whole, in ms. */
export const UNFOLD_MS = APPEAR_MS + STRETCH_MS + FADE_MS;

/** Where in the whole the stretching starts and ends. */
const STRETCH_START = APPEAR_MS / UNFOLD_MS;
const STRETCH_END = (APPEAR_MS + STRETCH_MS) / UNFOLD_MS;

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
 * The keyframes of the whole, to be played linearly over `UNFOLD_MS`. First
 * the circle fades in. Then the stretching, `steps` + 1 evenly in time and
 * eased in place: the panel's width and shift from where it is laid out, and the
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
    const offset = stretchOffset(step / steps);
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
  return {
    panel: appear(hold(panelFrames)),
    tools: tools ? still(hold(toolsFrames)) : null,
    content: fadeFrames(),
  };
}

/**
 * The keyframes of the editor's toolbar, played as the search's: the circle
 * fades in, then its height, `steps` + 1 evenly in time and eased in place, from `size` (a circle, as
 * wide as it is) to `height`, as laid out. Its foot stays where it is, so it
 * grows upwards. Then its tools (hidden until then) fade in.
 */
export function unfoldFrames(
  height: number,
  size: number,
  steps = 24,
): { panel: Keyframe[]; content: Keyframe[] } {
  const frames: Keyframe[] = [];
  for (let step = 0; step <= steps; step++) {
    const now = size + (height - size) * ease(step / steps);
    frames.push({ offset: stretchOffset(step / steps), height: `${String(px(now))}px` });
  }
  return { panel: appear(hold(frames)), content: fadeFrames() };
}

/** Where a point of the stretching, from 0 to 1, falls in the whole. */
function stretchOffset(progress: number): number {
  return STRETCH_START + progress * (STRETCH_END - STRETCH_START);
}

/** Stretched, it holds while what it holds fades in. */
function hold(frames: Keyframe[]): Keyframe[] {
  return [...frames, { ...frames.at(-1), offset: 1 }];
}

/** Before the stretching, the circle fades in where it starts. */
function appear(frames: Keyframe[]): Keyframe[] {
  return [
    { ...frames[0], offset: 0, opacity: 0, easing: "ease" },
    ...frames.map((frame) => ({ ...frame, opacity: 1 })),
  ];
}

/** Before the stretching, it stays where it starts. */
function still(frames: Keyframe[]): Keyframe[] {
  return [{ ...frames[0], offset: 0 }, ...frames];
}

/** Hidden while the panel appears and opens, then fading in. */
function fadeFrames(): Keyframe[] {
  return [
    { offset: 0, opacity: 0 },
    { offset: STRETCH_END, opacity: 0, easing: "ease" },
    { offset: 1, opacity: 1 },
  ];
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

/** What a panel's opening animates: the panel, and the elements and keyframes that move. */
type Unfolding = {
  readonly panel: HTMLElement;
  readonly parts: readonly (readonly [Element, Keyframe[]])[];
};

/**
 * Opens a panel as `shown` turns true and closes it as it turns false
 * (turning around mid-way, if it changes again), with what `plan` returns,
 * asked for with the panel laid out open (null: no animation). The panel
 * carries `data-stretching` meanwhile. Returns whether the panel is to be
 * rendered: while shown, and while it closes. Off (`enabled` false, no
 * island), or with less motion asked for, it comes and goes at once.
 */
function useUnfolding(shown: boolean, enabled: boolean, plan: () => Unfolding | null): boolean {
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) {
    setWasShown(shown);
    setLeaving(!shown && enabled && canAnimate());
  }
  const rendered = shown || leaving;
  const running = useRef<{
    animations: Animation[];
    panel: HTMLElement;
    forward: boolean;
  } | null>(null);
  // What the last change animated to: nothing to do on mount, or when run again for the same.
  const animatedTo = useRef(shown);

  const stop = () => {
    running.current?.animations.forEach((animation) => {
      animation.cancel();
    });
    if (running.current) delete running.current.panel.dataset.stretching;
    running.current = null;
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
    const unfolding = enabled && canAnimate() ? plan() : null;
    if (!unfolding) {
      if (!shown) setLeaving(false);
      return;
    }
    unfolding.panel.dataset.stretching = "";
    const options: KeyframeAnimationOptions = {
      duration: UNFOLD_MS,
      easing: "linear",
      fill: "both",
    };
    const animations = unfolding.parts.map(([element, frames]) => element.animate(frames, options));
    const state = { animations, panel: unfolding.panel, forward: shown };
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

  // Gone (or off): what moved goes back to its place as the panel goes, before paint.
  useLayoutEffect(() => {
    if (!rendered || !enabled) stop();
    if (!enabled && leaving) setLeaving(false);
  }, [rendered, enabled, leaving]);

  return rendered;
}

/**
 * Stretches the island's search open as `shown` turns true and shrinks it
 * back as it turns false. Returns whether the panel is to be rendered.
 */
export function useIslandStretch(
  shown: boolean,
  enabled: boolean,
  dock: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  tools: HTMLElement | null,
): boolean {
  return useUnfolding(shown, enabled, () => {
    const element = panel.current;
    const layout = dock.current && element ? measure(dock.current, element, tools) : null;
    if (!layout || !element) return null;
    const frames = stretchFrames(layout);
    // While it stretches, the panel clips its search box, which keeps its open width, centred.
    const box = element.querySelector(".search-box");
    if (box) {
      element.style.setProperty(
        "--stretch-width",
        `${String(box.getBoundingClientRect().width)}px`,
      );
    }
    const parts: (readonly [Element, Keyframe[]])[] = [[element, frames.panel]];
    if (box) parts.push([box, frames.content]);
    if (frames.tools && tools) parts.push([tools, frames.tools]);
    return { panel: element, parts };
  });
}

/**
 * Grows the editor's toolbar upwards out of a circle as `shown` turns true and
 * shrinks it back down as it turns false. Returns whether it is to be rendered.
 */
export function useToolbarUnfold(shown: boolean, toolbar: RefObject<HTMLElement | null>): boolean {
  return useUnfolding(shown, true, () => {
    const element = toolbar.current;
    const open = element?.getBoundingClientRect();
    if (!element || !open || open.width === 0) return null;
    const frames = unfoldFrames(open.height, open.width);
    return {
      panel: element,
      parts: [
        [element, frames.panel],
        ...[...element.children].map((tool) => [tool, frames.content] as const),
      ],
    };
  });
}
