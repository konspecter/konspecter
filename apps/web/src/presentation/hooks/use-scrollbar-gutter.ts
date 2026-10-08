import { useEffect } from "react";

/**
 * The width a scrollbar takes, measured on a hidden box that always scrolls
 * (0 with overlay scrollbars). Not `innerWidth` minus the body's width: on a
 * phone the layout viewport widens to fit anything that sticks out, and that
 * difference would read as a scrollbar hundreds of pixels wide.
 */
export function scrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden";
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return Math.max(0, width);
}

/**
 * Keeps `--scrollbar-gutter` on `<html>` at the width the page's scrollbar
 * takes, so the layout can mirror it on the left. Measured on start and on
 * every resize (zooming changes the scrollbar's width in CSS pixels).
 */
export function useScrollbarGutter(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--scrollbar-gutter", `${String(scrollbarWidth())}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      root.style.removeProperty("--scrollbar-gutter");
    };
  }, []);
}
