import { NavigationType } from "react-router";
import { stepHistory, stepsBack, type HistorySteps } from "./use-history-steps";

const at = (key: string, path = `/${key}`) => ({ key, path });

describe("stepHistory", () => {
  const start: HistorySteps = { entries: [at("a")], index: 0 };

  it("adds an entry on a push, dropping the ones ahead", () => {
    const pushed = stepHistory(
      stepHistory(start, NavigationType.Push, at("b")),
      NavigationType.Push,
      at("c"),
    );
    expect(pushed).toEqual({ entries: [at("a"), at("b"), at("c")], index: 2 });
    const back = stepHistory(pushed, NavigationType.Pop, at("a"));
    expect(back).toEqual({ entries: [at("a"), at("b"), at("c")], index: 0 });
    expect(stepHistory(back, NavigationType.Push, at("d"))).toEqual({
      entries: [at("a"), at("d")],
      index: 1,
    });
  });

  it("swaps the current entry on a replace", () => {
    const steps = { entries: [at("a"), at("b"), at("c")], index: 1 };
    expect(stepHistory(steps, NavigationType.Replace, at("x"))).toEqual({
      entries: [at("a"), at("x"), at("c")],
      index: 1,
    });
  });

  it("starts anew at an entry it has not seen", () => {
    const steps = { entries: [at("a"), at("b")], index: 1 };
    expect(stepHistory(steps, NavigationType.Pop, at("z"))).toEqual({
      entries: [at("z")],
      index: 0,
    });
  });
});

describe("stepsBack", () => {
  const settings = (path: string) => path === "/settings";

  it("goes back one step, or past the skipped pages", () => {
    const steps = {
      entries: [at("a", "/"), at("b", "/settings"), at("c", "/settings"), at("d", "/conspects/d")],
      index: 3,
    };
    expect(stepsBack(steps, () => false)).toBe(-1);
    expect(stepsBack(steps, settings)).toBe(-3);
  });

  it("finds nothing at the start, or with only skipped pages behind", () => {
    expect(stepsBack({ entries: [at("a", "/")], index: 0 }, settings)).toBeNull();
    const steps = { entries: [at("b", "/settings"), at("d", "/conspects/d")], index: 1 };
    expect(stepsBack(steps, settings)).toBeNull();
  });
});
