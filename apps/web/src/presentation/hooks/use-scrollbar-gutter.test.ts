import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollbarGutter } from "./use-scrollbar-gutter";

const gutter = () => document.documentElement.style.getPropertyValue("--scrollbar-gutter");

describe("useScrollbarGutter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the scrollbar's width, not how far the page sticks out past the screen", () => {
    // A phone whose layout viewport widened to fit an overflowing page.
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(808);
    vi.spyOn(document.body, "clientWidth", "get").mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);

    const { unmount } = renderHook(() => {
      useScrollbarGutter();
    });

    expect(gutter()).toBe("0px");
    unmount();
    expect(gutter()).toBe("");
  });

  it("mirrors a classic scrollbar", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(85);

    renderHook(() => {
      useScrollbarGutter();
    });

    expect(gutter()).toBe("15px");
  });
});
