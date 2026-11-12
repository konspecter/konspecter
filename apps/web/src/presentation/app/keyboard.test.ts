import { followKeyboard, keyboardInset, pastEnd } from "./keyboard";

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

describe("pastEnd", () => {
  const island = document.createElement("div");
  island.setAttribute("data-above-keyboard", "");
  const field = island.appendChild(document.createElement("input"));
  const elsewhere = document.createElement("input");

  it("is how far Safari moved the page up to a field that rises by itself", () => {
    expect(pastEnd({ height: 460, offsetTop: 340, scale: 1 }, field)).toBe(340);
    expect(pastEnd({ height: 460, offsetTop: 0, scale: 1 }, field)).toBe(0);
  });

  it("is 0 for any other field, no focus at all, and while zoomed in", () => {
    expect(pastEnd({ height: 460, offsetTop: 340, scale: 1 }, elsewhere)).toBe(0);
    expect(pastEnd({ height: 460, offsetTop: 340, scale: 1 }, null)).toBe(0);
    expect(pastEnd({ height: 400, offsetTop: 200, scale: 2 }, field)).toBe(0);
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

  it("scrolls back a page moved up to the island's field", () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    const scrollTo = vi.fn((_x: number, y: number) => {
      viewport.offsetTop = 0;
      target.scrollY = y;
    });
    const target = {
      innerHeight: 800,
      scrollY: 0,
      scrollTo,
      visualViewport: viewport,
      document,
    } as unknown as Window & { scrollY: number };
    const island = document.body.appendChild(document.createElement("div"));
    island.setAttribute("data-above-keyboard", "");
    const field = island.appendChild(document.createElement("input"));
    field.focus();

    const stop = followKeyboard(target);
    // The keyboard is up and Safari moved the whole page 340px up to the field.
    viewport.height = 460;
    viewport.offsetTop = 340;
    target.scrollY = 340;
    viewport.dispatchEvent(new Event("scroll"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    // Back in place, the island rises above the keyboard instead.
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("340px");

    stop();
    island.remove();
    document.documentElement.style.removeProperty("--keyboard-inset");
  });

  it("does nothing where the browser cannot say what is seen", () => {
    const target = { innerHeight: 800, visualViewport: null, document } as unknown as Window;
    followKeyboard(target)();
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("");
  });
});
