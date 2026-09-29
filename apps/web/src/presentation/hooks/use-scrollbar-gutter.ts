import { useEffect } from "react";

/**
 * Keeps `--scrollbar-gutter` on `<html>` at the width the page's scrollbar
 * takes (0 with overlay scrollbars), so the layout can mirror it on the left.
 * Measured on start, and whenever the body's width changes (a resize, or a
 * scrollbar appearing where the gutter is not reserved in advance).
 */
export function useScrollbarGutter(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const width = Math.max(0, window.innerWidth - document.body.clientWidth);
      root.style.setProperty("--scrollbar-gutter", `${String(width)}px`);
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(document.body);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--scrollbar-gutter");
    };
  }, []);
}
