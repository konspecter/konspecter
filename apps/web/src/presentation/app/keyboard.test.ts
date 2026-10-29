import { followKeyboard, keyboardInset } from "./keyboard";

describe("keyboardInset", () => {
  it("is what a keyboard covering the page hides of its bottom", () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(800, { height: 460, offsetTop: 0, scale: 1 })).toBe(340);
    // Safari scrolls the part seen to the field that took the focus.
    expect(keyboardInset(800, { height: 460, offsetTop: 120, scale: 1 })).toBe(220);
  });

  it("is 0 for a keyboard that shrinks the page, and while zoomed in", () => {
    expect(keyboardInset(460, { height: 460, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(800, { height: 400, offsetTop: 0, scale: 2 })).toBe(0);
  });
});

describe("followKeyboard", () => {
  it("keeps --keyboard-inset current as the keyboard opens and closes, until stopped", () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    const target = { innerHeight: 800, visualViewport: viewport, document } as unknown as Window;
    const inset = () => document.documentElement.style.getPropertyValue("--keyboard-inset");

    const stop = followKeyboard(target);
    expect(inset()).toBe("0px");
    viewport.height = 460;
    viewport.dispatchEvent(new Event("resize"));
    expect(inset()).toBe("340px");
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event("scroll"));
    expect(inset()).toBe("300px");

    stop();
    viewport.height = 800;
    viewport.dispatchEvent(new Event("resize"));
    expect(inset()).toBe("300px");
    document.documentElement.style.removeProperty("--keyboard-inset");
  });

  it("does nothing where the browser cannot say what is seen", () => {
    const target = { innerHeight: 800, visualViewport: null, document } as unknown as Window;
    followKeyboard(target)();
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");
  });
});
