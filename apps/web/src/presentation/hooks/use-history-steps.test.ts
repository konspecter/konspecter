import { NavigationType } from "react-router";
import { stepHistory } from "./use-history-steps";

describe("stepHistory", () => {
  const start = { keys: ["a"], index: 0 };

  it("adds an entry on a push, dropping the ones ahead", () => {
    const pushed = stepHistory(
      stepHistory(start, NavigationType.Push, "b"),
      NavigationType.Push,
      "c",
    );
    expect(pushed).toEqual({ keys: ["a", "b", "c"], index: 2 });
    const back = stepHistory(pushed, NavigationType.Pop, "a");
    expect(back).toEqual({ keys: ["a", "b", "c"], index: 0 });
    expect(stepHistory(back, NavigationType.Push, "d")).toEqual({ keys: ["a", "d"], index: 1 });
  });

  it("swaps the current entry on a replace", () => {
    const steps = { keys: ["a", "b", "c"], index: 1 };
    expect(stepHistory(steps, NavigationType.Replace, "x")).toEqual({
      keys: ["a", "x", "c"],
      index: 1,
    });
  });

  it("starts anew at an entry it has not seen", () => {
    expect(stepHistory({ keys: ["a", "b"], index: 1 }, NavigationType.Pop, "z")).toEqual({
      keys: ["z"],
      index: 0,
    });
  });
});
