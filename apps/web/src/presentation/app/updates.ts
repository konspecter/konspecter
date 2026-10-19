/**
 * A new version of the app: a service worker waiting to take over (reload), or
 * on the desktop a newer release to download.
 */
export type Update = { readonly kind: "reload" } | { readonly kind: "download"; version: string };

/**
 * Desktop: asks for a newer release at once, whatever the setting says. Gives
 * the release, or null when this version is the latest; rejects when the
 * check fails.
 */
export type CheckForRelease = () => Promise<{
  readonly version: string;
  readonly url: string;
} | null>;

/** Tells the UI that a new version of the app is ready, and applies it on request. */
export type UpdateSource = {
  /** Calls `listener` once an update is waiting. Returns an unsubscribe function. */
  subscribe: (listener: (update: Update) => void) => () => void;
  /** Reloads into the waiting version, or opens the release's download page. */
  apply: () => void;
};
