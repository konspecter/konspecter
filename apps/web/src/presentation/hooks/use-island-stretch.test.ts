import { describe, expect, it } from "vitest";
import {
  APPEAR_MS,
  ease,
  FADE_MS,
  STRETCH_MS,
  stretchFrames,
  UNFOLD_MS,
  unfoldFrames,
  type StretchLayout,
} from "./use-island-stretch";

/** A 360px phone: the row from 16 to 344, the panel open to 276, the tools' bar 288–344. */
const layout: StretchLayout = {
  centre: 180,
  size: 56,
  panel: { left: 16, right: 276 },
  tools: { left: 288, rest: 252 },
};

/** Where the stretching starts and ends in the whole. */
const start = APPEAR_MS / UNFOLD_MS;
const end = (APPEAR_MS + STRETCH_MS) / UNFOLD_MS;

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

  it("fades in as a circle in the middle, then stretches to as laid out", () => {
    const { panel } = stretchFrames(layout, 10);
    // The circle appearing, 11 steps, then held while the search box fades in.
    expect(panel).toHaveLength(13);
    expect(panel[0]).toMatchObject({ offset: 0, opacity: 0, width: "56px" });
    // Its left edge at 180 - 28, from 16 where it is laid out.
    expect(shift(panel[0])).toBe(136);
    expect(panel[1]).toMatchObject({ opacity: 1, width: "56px" });
    expect(panel[1]?.offset).toBeCloseTo(start);
    expect(shift(panel[1])).toBe(136);
    expect(panel[11]?.offset).toBeCloseTo(end);
    expect(width(panel[11])).toBe(260);
    expect(shift(panel[11])).toBe(0);
    expect(panel[12]).toMatchObject({
      offset: 1,
      opacity: 1,
      width: "260px",
      transform: "translateX(0px)",
    });
    // Wider at every step.
    const widths = panel.map(width);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it("keeps the tools over Settings until the panel's edge pushes them to the row's end", () => {
    const { panel, tools } = stretchFrames(layout, 10);
    if (!tools) throw new Error("no tools");
    expect(tools).toHaveLength(panel.length);
    // Over Settings at first, while the circle appears: 36px left of where they are laid out.
    expect(shift(tools[0])).toBe(-36);
    expect(shift(tools[1])).toBe(-36);
    expect(shift(tools[11])).toBe(0);
    for (const [index, frame] of tools.entries()) {
      const right = 16 + shift(panel[index]) + width(panel[index]);
      const left = 288 + shift(frame);
      // Never back past Settings, never closer to the panel than the 12px they end at.
      expect(left).toBeGreaterThanOrEqual(252);
      expect(left - right).toBeGreaterThanOrEqual(12 - 0.05);
    }
    // Pushed, they move with the panel's edge.
    const pushed = tools.findIndex((frame) => shift(frame) > -36);
    expect(pushed).toBeGreaterThan(1);
  });

  it("shows the search box only once stretched, fading it in", () => {
    const { content } = stretchFrames(layout, 10);
    expect(content).toEqual([
      { offset: 0, opacity: 0 },
      { offset: end, opacity: 0, easing: "ease" },
      { offset: 1, opacity: 1 },
    ]);
    // Quick fades around a quick stretch.
    expect(APPEAR_MS).toBe(100);
    expect(FADE_MS).toBe(100);
    expect(STRETCH_MS).toBeLessThan(260);
  });

  it("has nothing to move without the tools", () => {
    expect(stretchFrames({ ...layout, tools: null }).tools).toBeNull();
  });
});

describe("unfolding the editor's toolbar", () => {
  const height = (frame: Keyframe | undefined) => Number.parseFloat(String(frame?.height));

  it("fades in as a circle, grows up to its height, then fades its tools in", () => {
    const { panel, content } = unfoldFrames(500, 56, 10);
    expect(panel).toHaveLength(13);
    expect(panel[0]).toMatchObject({ offset: 0, opacity: 0, height: "56px" });
    expect(panel[1]).toMatchObject({ opacity: 1, height: "56px" });
    expect(panel[1]?.offset).toBeCloseTo(start);
    expect(panel[11]?.offset).toBeCloseTo(end);
    expect(height(panel[11])).toBe(500);
    expect(panel[12]).toEqual({ offset: 1, opacity: 1, height: "500px" });
    // Taller at every step.
    const heights = panel.map(height);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(content).toEqual(stretchFrames(layout, 10).content);
  });
});
