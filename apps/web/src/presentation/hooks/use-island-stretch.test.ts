import { describe, expect, it } from "vitest";
import { ease, FADE_MS, STRETCH_MS, stretchFrames, type StretchLayout } from "./use-island-stretch";

/** A 360px phone: the row from 16 to 344, the panel open to 276, the tools' bar 288–344. */
const layout: StretchLayout = {
  centre: 180,
  size: 56,
  panel: { left: 16, right: 276 },
  tools: { left: 288, rest: 252 },
};

const shift = (frame: Keyframe | undefined) =>
  Number(/translateX\((-?[\d.]+)px\)/.exec(String(frame?.transform))?.[1]);
const width = (frame: Keyframe | undefined) => Number.parseFloat(String(frame?.width));

describe("stretching the island's search", () => {
  it("eases in and out, not evenly", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });

  it("starts as a circle in the middle and ends as laid out", () => {
    const { panel } = stretchFrames(layout, 10);
    // 11 steps, then held while the search box fades in.
    expect(panel).toHaveLength(12);
    expect(panel[0]?.offset).toBe(0);
    expect(width(panel[0])).toBe(56);
    // Its left edge at 180 - 28, from 16 where it is laid out.
    expect(shift(panel[0])).toBe(136);
    expect(panel[10]?.offset).toBeCloseTo(STRETCH_MS / (STRETCH_MS + FADE_MS));
    expect(width(panel[10])).toBe(260);
    expect(shift(panel[10])).toBe(0);
    expect(panel[11]).toMatchObject({ offset: 1, width: "260px", transform: "translateX(0px)" });
    // Wider at every step.
    const widths = panel.map(width);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it("keeps the tools over Settings until the panel's edge pushes them to the row's end", () => {
    const { panel, tools } = stretchFrames(layout, 10);
    if (!tools) throw new Error("no tools");
    // Over Settings at first: 36px left of where they are laid out.
    expect(shift(tools[0])).toBe(-36);
    expect(shift(tools[10])).toBe(0);
    for (const [index, frame] of tools.entries()) {
      const right = 16 + shift(panel[index]) + width(panel[index]);
      const left = 288 + shift(frame);
      // Never back past Settings, never closer to the panel than the 12px they end at.
      expect(left).toBeGreaterThanOrEqual(252);
      expect(left - right).toBeGreaterThanOrEqual(12 - 0.05);
    }
    // Pushed, they move with the panel's edge.
    const pushed = tools.findIndex((frame) => shift(frame) > -36);
    expect(pushed).toBeGreaterThan(0);
  });

  it("shows the search box only once stretched, fading it in", () => {
    const { panel, content } = stretchFrames(layout, 10);
    const stretched = panel[10]?.offset;
    expect(content).toEqual([
      { offset: 0, opacity: 0 },
      { offset: stretched, opacity: 0, easing: "ease" },
      { offset: 1, opacity: 1 },
    ]);
    // A quick fade after a quick stretch.
    expect(FADE_MS).toBe(100);
    expect(STRETCH_MS).toBeLessThan(260);
  });

  it("has nothing to move without the tools", () => {
    expect(stretchFrames({ ...layout, tools: null }).tools).toBeNull();
  });
});
