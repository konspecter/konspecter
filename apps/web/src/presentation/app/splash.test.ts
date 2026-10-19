import { applyStyles, hideSplash, showStage } from "./splash";

function splash(): HTMLElement {
  document.body.innerHTML = '<div id="splash" role="progressbar" aria-valuenow="0"></div>';
  const element = document.getElementById("splash");
  if (!element) throw new Error("no splash");
  return element;
}

describe("splash screen", () => {
  it("fills the bookmark by the stage of the start", () => {
    const element = splash();
    showStage("storage");
    expect(element.style.getPropertyValue("--splash-progress")).toBe("0.75");
    expect(element).toHaveAttribute("aria-valuenow", "75");
  });

  it("fills the rest, fades out and goes", () => {
    vi.useFakeTimers();
    const element = splash();
    hideSplash();
    expect(element).toHaveAttribute("aria-valuenow", "100");
    expect(element).not.toHaveClass("splash-out");
    vi.advanceTimersByTime(150);
    expect(element).toHaveClass("splash-out");
    hideSplash();
    vi.advanceTimersByTime(180);
    expect(document.getElementById("splash")).toBeNull();
    vi.useRealTimers();
  });

  it("does nothing without a splash", () => {
    document.body.innerHTML = "";
    expect(() => {
      showStage("library");
      hideSplash();
    }).not.toThrow();
  });

  it("applies the preloaded stylesheets once they have loaded", async () => {
    document.head.innerHTML =
      '<link rel="preload" as="style" href="/a.css"><link rel="preload" as="style" href="/b.css">' +
      '<link rel="modulepreload" href="/c.js">';
    const [a, b] = Array.from(document.head.querySelectorAll("link"));
    let applied = false;
    const styles = applyStyles().then(() => {
      applied = true;
    });
    expect(a).toHaveAttribute("rel", "stylesheet");
    expect(b).toHaveAttribute("rel", "stylesheet");
    a?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(applied).toBe(false);
    b?.dispatchEvent(new Event("error"));
    await styles;
    expect(applied).toBe(true);
    expect(document.head.querySelector('link[href="/c.js"]')).toHaveAttribute(
      "rel",
      "modulepreload",
    );
  });
});
