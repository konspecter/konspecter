import { useState } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router";

/** The app's history as far as it has seen it: the entries' keys and where it is. */
export type HistorySteps = { readonly keys: readonly string[]; readonly index: number };

/**
 * The history after the router went to the entry `key` by `type`: a push
 * drops the entries ahead and adds one, a replace swaps the current one, and a
 * pop moves to a known entry (an unknown one, from before the app started,
 * starts the history anew).
 */
export function stepHistory(steps: HistorySteps, type: NavigationType, key: string): HistorySteps {
  const { keys, index } = steps;
  if (type === NavigationType.Push)
    return { keys: [...keys.slice(0, index + 1), key], index: index + 1 };
  if (type === NavigationType.Replace) return { keys: keys.with(index, key), index };
  const known = keys.indexOf(key);
  return known === -1 ? { keys: [key], index: 0 } : { keys, index: known };
}

/** Whether the app can go back and forward in its history (the top bar's ‹ and ›). */
export function useHistorySteps(): { readonly back: boolean; readonly forward: boolean } {
  const { key } = useLocation();
  const type = useNavigationType();
  const [steps, setSteps] = useState<HistorySteps>(() => ({ keys: [key], index: 0 }));
  let current = steps;
  if (steps.keys[steps.index] !== key) {
    current = stepHistory(steps, type, key);
    setSteps(current);
  }
  return { back: current.index > 0, forward: current.index < current.keys.length - 1 };
}
