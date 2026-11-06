import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { slideIn, useSlide } from "./use-slide";

/** A stand-in for the Web Animations API: records each animation, finished by the test. */
function fakeAnimations(element: HTMLElement) {
  const started: {
    keyframes: Keyframe[];
    animation: Animation;
    cancelled: boolean;
    reversed: number;
  }[] = [];
  element.animate = (keyframes) => {
    const entry = {
      keyframes: keyframes as Keyframe[],
      cancelled: false,
      reversed: 0,
      animation: {
        onfinish: null,
        cancel: () => {
          entry.cancelled = true;
        },
        reverse: () => {
          entry.reversed += 1;
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

describe("useSlide", () => {
  it("slides the panel in from the left edge, without a jump on arrival", () => {
    const panel = document.createElement("aside");
    const { started, finish } = fakeAnimations(panel);
    const { result, rerender } = renderHook(({ open }) => useSlide(panel, open, true), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);
    expect(started).toHaveLength(0);

    rerender({ open: true });
    expect(result.current).toBe(true);
    expect(started[0]?.keyframes.map(({ transform }) => transform)).toEqual([
      "translateX(-100%)",
      "none",
    ]);
    expect(started[0]?.reversed).toBe(0);
    finish();
    // In place, the animation lets go of it.
    expect(started[0]?.cancelled).toBe(true);
    expect(result.current).toBe(true);
  });

  it("keeps the panel shown while it slides out, then hides it", () => {
    const panel = document.createElement("aside");
    const { started, finish } = fakeAnimations(panel);
    const { result, rerender } = renderHook(({ open }) => useSlide(panel, open, true), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current).toBe(true);
    // The same slide, played backwards.
    expect(started[0]?.reversed).toBe(1);
    finish();
    expect(result.current).toBe(false);
    // Held out of sight until it opens again, which plays it forwards.
    expect(started[0]?.cancelled).toBe(false);
    rerender({ open: true });
    expect(started).toHaveLength(1);
    expect(started[0]?.reversed).toBe(2);
  });

  it("turns round mid-way", () => {
    const panel = document.createElement("aside");
    const { started } = fakeAnimations(panel);
    const { result, rerender } = renderHook(({ open }) => useSlide(panel, open, true), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    rerender({ open: false });
    expect(started).toHaveLength(1);
    expect(started[0]?.reversed).toBe(1);
    expect(result.current).toBe(true);
  });

  it("shows and hides at once when disabled (a wide screen)", () => {
    const panel = document.createElement("aside");
    const { started } = fakeAnimations(panel);
    const { result, rerender } = renderHook(({ open }) => useSlide(panel, open, false), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    expect(result.current).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("shows and hides at once without the Web Animations API", () => {
    const panel = document.createElement("aside");
    const { result, rerender } = renderHook(({ open }) => useSlide(panel, open, true), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    expect(result.current).toBe(false);
  });
});

describe("slideIn", () => {
  it("brings the page in from the side it came from, fading in", () => {
    const page = document.createElement("main");
    const { started } = fakeAnimations(page);
    slideIn(page, "left");
    slideIn(page, "right");
    expect(started.map(({ keyframes }) => keyframes[0])).toEqual([
      { transform: "translateX(-30%)", opacity: 0 },
      { transform: "translateX(30%)", opacity: 0 },
    ]);
    expect(started.map(({ keyframes }) => keyframes[1])).toEqual([
      { transform: "none", opacity: 1 },
      { transform: "none", opacity: 1 },
    ]);
  });
});
