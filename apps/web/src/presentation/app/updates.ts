/** Tells the UI that a new version of the app is ready, and applies it on request. */
export type UpdateSource = {
  /** Calls `listener` once an update is waiting. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  /** Activates the new version and reloads the page. */
  apply: () => void;
};
