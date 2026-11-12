/**
 * The on-screen keyboard. Where it shrinks the page (Chrome, which the
 * viewport's `interactive-widget=resizes-content` asks to, and the Android
 * app, whose window Capacitor pads), what is fixed at the bottom of the page
 * rises with it by itself. Elsewhere (Safari on iOS, Firefox) it covers the
 * page's bottom: the part of the page that can be seen (`visualViewport`)
 * then ends above it, and `--keyboard-inset` on the root element says how far
 * up, so the island and the room kept for it stay above the keyboard.
 *
 * Safari also scrolls to the field that takes the focus. Where the page can
 * scroll no further (a short list), it moves the part seen past the page's
 * end instead, and the whole page, its top bar too, goes up off the screen.
 * For a field in an element that rises above the keyboard on its own
 * (`data-above-keyboard`: the island) that is not needed: it is scrolled back.
 */

type Viewport = Pick<VisualViewport, "height" | "offsetTop" | "scale">;

/** The attribute of an element that stays above the keyboard by itself (`--keyboard-inset`). */
const ABOVE_KEYBOARD = "data-above-keyboard";

/**
 * How much of the bottom of a page `windowHeight` tall the keyboard covers:
 * 0 with no keyboard, or one that shrinks the page. Zoomed in, the part seen
 * is smaller for the zoom, not a keyboard: 0 too.
 */
export function keyboardInset(windowHeight: number, viewport: Viewport): number {
  if (zoomed(viewport)) return 0;
  return Math.max(0, Math.round(windowHeight - viewport.offsetTop - viewport.height));
}

/**
 * How far to scroll back up a page the browser moved past its end to show
 * the focused field: 0 unless that field stays above the keyboard by itself.
 * Zoomed in, the part seen is wherever the zoom took it: 0 too.
 */
export function pastEnd(viewport: Viewport, focus: Element | null): number {
  if (zoomed(viewport) || !focus?.closest(`[${ABOVE_KEYBOARD}]`)) return 0;
  return Math.max(0, Math.round(viewport.offsetTop));
}

function zoomed(viewport: Viewport): boolean {
  return Math.abs(viewport.scale - 1) > 0.01;
}

/** Keeps `--keyboard-inset` current as the keyboard opens and closes. Returns a function that stops. */
export function followKeyboard(target: Window = window): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => undefined;
  const root = target.document.documentElement;
  const update = () => {
    const back = pastEnd(viewport, target.document.activeElement);
    if (back > 0) target.scrollTo(0, target.scrollY - back);
    root.style.setProperty(
      "--keyboard-inset",
      `${String(keyboardInset(target.innerHeight, viewport))}px`,
    );
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}
