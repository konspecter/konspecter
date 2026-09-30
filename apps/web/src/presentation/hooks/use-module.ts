import { useEffect, useState } from "react";

/** A module imported on demand, once, and kept for synchronous use after that. */
export type ModuleLoader<T> = {
  /** Imports the module (once; again after a failure, e.g. back online). */
  readonly load: () => Promise<T>;
  /** The module, once it has loaded. */
  readonly loaded: () => T | undefined;
};

export function moduleLoader<T>(importer: () => Promise<T>): ModuleLoader<T> {
  let module: T | undefined;
  let pending: Promise<T> | null = null;
  return {
    load() {
      pending ??= importer().then(
        (value) => (module = value),
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    loaded: () => module,
  };
}

export type ModuleState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "loaded"; readonly module: T };

/**
 * The module `loader` imports, loading it if it has not been yet. Unlike
 * React.lazy it does not suspend: React holds back content that follows a
 * Suspense fallback for up to 300 ms, which would delay a module that takes
 * a few milliseconds. A module already loaded is there on the first render.
 */
export function useModule<T>(loader: ModuleLoader<T>): ModuleState<T> {
  const [state, setState] = useState<ModuleState<T>>(() => {
    const module = loader.loaded();
    return module === undefined ? { status: "loading" } : { status: "loaded", module };
  });
  const loading = state.status === "loading";
  useEffect(() => {
    if (!loading) return;
    let active = true;
    loader.load().then(
      (module) => {
        if (active) setState({ status: "loaded", module });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
  }, [loader, loading]);
  return state;
}
