import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFold } from "./use-fold";

/** A stand-in for the Web Animations API: records each animation, finished by the test. */
function fakeAnimations(element: HTMLElement) {
  const started: { keyframes: Keyframe[]; animation: Animation; cancelled: boolean }[] = [];
  element.animate = (keyframes) => {
    const entry = {
      keyframes: keyframes as Keyframe[],
      cancelled: false,
      animation: {
        onfinish: null,
        cancel: () => {
          entry.cancelled = true;
        },
      } as unknown as Animation,
    };
    started.push(entry);
    return entry.animation;
  };
  const finish = () => {
    const { animation } = started.at(-1) ?? {};
    act(() => {
      animation?.onfinish?.call(animation, new Event("finish") as AnimationPlaybackEvent);
    });
  };
  return { started, finish };
}

describe("useFold", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the body shown while it folds, then hides it", () => {
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: 120 } as DOMRect);
    const { started, finish } = fakeAnimations(element);
    const { result, rerender } = renderHook(({ open }) => useFold(element, open), {
      initialProps: { open: true },
    });
    expect(result.current).toBe(true);
    expect(started).toHaveLength(0);

    rerender({ open: false });
    expect(result.current).toBe(true);
    expect(started[0]?.keyframes.map(({ height }) => height)).toEqual(["120px", "0px"]);
    finish();
    expect(result.current).toBe(false);
  });

  it("opens from nothing to its height, and turns round mid-way", () => {
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: 80 } as DOMRect);
    const { started } = fakeAnimations(element);
    const { result, rerender } = renderHook(({ open }) => useFold(element, open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);

    rerender({ open: true });
    expect(result.current).toBe(true);
    expect(started[0]?.keyframes.map(({ height }) => height)).toEqual(["0px", "80px"]);

    // Folded again before it is open: that animation stops, the next goes on from here.
    rerender({ open: false });
    expect(started[0]?.cancelled).toBe(true);
    expect(started[1]?.keyframes.map(({ height }) => height)).toEqual(["80px", "0px"]);
    expect(result.current).toBe(true);
  });

  it("folds at once without animations", () => {
    const element = document.createElement("div");
    const { result, rerender } = renderHook(({ open }) => useFold(element, open), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current).toBe(false);
  });
});
