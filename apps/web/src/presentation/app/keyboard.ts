/**
 * The on-screen keyboard. Where it shrinks the page (Chrome, which the
 * viewport's `interactive-widget=resizes-content` asks to, and the Android
 * app, whose window Capacitor pads), what is fixed at the bottom of the page
 * rises with it by itself. Elsewhere (Safari on iOS, Firefox) it covers the
 * page's bottom: the part of the page that can be seen (`visualViewport`)
 * then ends above it, and `--keyboard-inset` on the root element says how far
 * up, so the island and the room kept for it stay above the keyboard.
 */

type Viewport = Pick<VisualViewport, "height" | "offsetTop" | "scale">;

/**
 * How much of the bottom of a page `windowHeight` tall the keyboard covers:
 * 0 with no keyboard, or one that shrinks the page. Zoomed in, the part seen
 * is smaller for the zoom, not a keyboard: 0 too.
 */
export function keyboardInset(windowHeight: number, viewport: Viewport): number {
  if (Math.abs(viewport.scale - 1) > 0.01) return 0;
  return Math.max(0, Math.round(windowHeight - viewport.offsetTop - viewport.height));
}

/** Keeps `--keyboard-inset` current as the keyboard opens and closes. Returns a function that stops. */
export function followKeyboard(target: Window = window): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => undefined;
  const root = target.document.documentElement;
  const update = () => {
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
