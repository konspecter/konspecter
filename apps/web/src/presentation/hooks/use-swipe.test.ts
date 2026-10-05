import { fireEvent, renderHook } from "@testing-library/react";
import { swipeDirection, useSwipe } from "./use-swipe";

const at = (x: number, y: number, time = 0) => ({ x, y, time });

describe("swipeDirection", () => {
  it("reads a quick sideways move as a swipe", () => {
    expect(swipeDirection(at(10, 100), at(120, 110, 200))).toBe("right");
    expect(swipeDirection(at(300, 100), at(200, 90, 200))).toBe("left");
  });

  it("ignores short, slow and mostly vertical moves", () => {
    expect(swipeDirection(at(10, 100), at(50, 100, 100))).toBeNull();
    expect(swipeDirection(at(10, 100), at(200, 100, 900))).toBeNull();
    expect(swipeDirection(at(10, 100), at(110, 160, 100))).toBeNull();
  });
});

function swipe(target: Element, fromX: number, toX: number, y = 100) {
  fireEvent.touchStart(target, { touches: [{ clientX: fromX, clientY: y }] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: toX, clientY: y }] });
}

describe("useSwipe", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
  });

  it("reports swipes anywhere in the page", () => {
    const onSwipe = vi.fn();
    renderHook(() => {
      useSwipe(onSwipe);
    });

    swipe(document.body, 20, 200);
    swipe(document.body, 200, 20);
    expect(onSwipe.mock.calls).toEqual([["right"], ["left"]]);
  });

  it("leaves swipes that start in something scrolling sideways, or in a dialog", () => {
    const onSwipe = vi.fn();
    renderHook(() => {
      useSwipe(onSwipe);
    });
    const code = document.createElement("pre");
    code.style.overflowX = "auto";
    Object.defineProperty(code, "scrollWidth", { value: 800 });
    Object.defineProperty(code, "clientWidth", { value: 300 });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    document.body.append(code, dialog);

    swipe(code, 20, 200);
    swipe(inside, 20, 200);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("is not a swipe with two fingers, or while text is selected", () => {
    const onSwipe = vi.fn();
    renderHook(() => {
      useSwipe(onSwipe);
    });
    fireEvent.touchStart(document.body, {
      touches: [
        { clientX: 20, clientY: 100 },
        { clientX: 40, clientY: 100 },
      ],
    });
    fireEvent.touchEnd(document.body, {
      touches: [],
      changedTouches: [{ clientX: 200, clientY: 100 }],
    });
    const text = document.createElement("p");
    text.textContent = "selected text";
    document.body.append(text);
    document.getSelection()?.selectAllChildren(text);
    swipe(document.body, 20, 200);

    expect(onSwipe).not.toHaveBeenCalled();
  });
});
