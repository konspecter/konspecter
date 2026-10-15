import { useState } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

/** An entry of the history: the router's key for it and its path. */
export type HistoryEntry = { readonly key: string; readonly path: string };

/** The app's history as far as it has seen it: the entries and where it is. */
export type HistorySteps = { readonly entries: readonly HistoryEntry[]; readonly index: number };

/**
 * The history after the router went to `entry` by `type`: a push drops the
 * entries ahead and adds one, a replace swaps the current one, and a pop
 * moves to a known entry (an unknown one, from before the app started,
 * starts the history anew).
 */
export function stepHistory(
  steps: HistorySteps,
  type: NavigationType,
  entry: HistoryEntry,
): HistorySteps {
  const { entries, index } = steps;
  if (type === NavigationType.Push)
    return { entries: [...entries.slice(0, index + 1), entry], index: index + 1 };
  if (type === NavigationType.Replace) return { entries: entries.with(index, entry), index };
  const known = entries.findIndex(({ key }) => key === entry.key);
  return known === -1 ? { entries: [entry], index: 0 } : { entries, index: known };
}

/**
 * How many steps back the nearest earlier entry is whose path is not
 * `skipped` (a negative delta for `navigate`), or null when there is none.
 */
export function stepsBack(steps: HistorySteps, skipped: (path: string) => boolean): number | null {
  for (let index = steps.index - 1; index >= 0; index--) {
    const entry = steps.entries[index];
    if (entry && !skipped(entry.path)) return index - steps.index;
  }
  return null;
}

/**
 * Whether the app can go back and forward in its history (the top bar's ‹
 * and ›), and the history itself (Escape goes back past some pages).
 */
export function useHistorySteps(): {
  readonly back: boolean;
  readonly forward: boolean;
  readonly steps: HistorySteps;
} {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  const [steps, setSteps] = useState<HistorySteps>(() => ({
    entries: [{ key, path: pathname }],
    index: 0,
  }));
  let current = steps;
  if (steps.entries[steps.index]?.key !== key) {
    current = stepHistory(steps, type, { key, path: pathname });
    setSteps(current);
  }
  return {
    back: current.index > 0,
    forward: current.index < current.entries.length - 1,
    steps: current,
  };
}
