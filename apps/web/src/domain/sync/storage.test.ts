import { usedPercent } from "./storage";

describe("usedPercent", () => {
  it.each([
    [0, 100, 0],
    [1, 1_000_000, 1],
    [37, 100, 37],
    [999, 1000, 99],
    [100, 100, 100],
    [150, 100, 150],
    [5, 0, 100],
    [0, 0, 0],
  ])("%d of %d is %d%%", (used, quota, percent) => {
    expect(usedPercent({ used, quota })).toBe(percent);
  });
});
