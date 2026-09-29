import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "success"; readonly value: T };

type Settled<T> = {
  readonly load: () => Promise<T>;
  readonly attempt: number;
  readonly state: AsyncState<T>;
};

/**
 * Runs `load` when the component mounts, whenever `load` changes (wrap it in
 * useCallback), and on `retry()`. Results from superseded runs are ignored.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let current = true;
    load().then(
      (value) => {
        if (current) setSettled({ load, attempt, state: { status: "success", value } });
      },
      (error: unknown) => {
        if (current) setSettled({ load, attempt, state: { status: "error", error } });
      },
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);

  // A reload of the same data keeps showing the last value until the new one arrives.
  const fresh = settled?.load === load && settled.attempt === attempt;
  const stale = settled?.load === load && settled.state.status === "success";
  const state: AsyncState<T> = fresh || stale ? settled.state : { status: "loading" };
  return {
    ...state,
    retry: () => {
      setAttempt((previous) => previous + 1);
    },
  };
}
