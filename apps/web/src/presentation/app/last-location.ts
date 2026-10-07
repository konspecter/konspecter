/**
 * Where the app was when it was last used, so it opens there again: the page
 * and its query (a note, the list with a search, settings). Kept per device
 * in localStorage, like the sidebar's state; without storage the app simply
 * opens on the list.
 */
const KEY = "konspecter.lastLocation";

/** Remembers `path` (pathname and search). A new, still empty note is not a place to return to. */
export function rememberLocation(path: string): void {
  if (path.startsWith("/conspects/new")) return;
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // A per-device convenience.
  }
}

/**
 * On start, before the router reads the address: if the app was opened on
 * its start page (not on a link or a reload of another page), goes back to
 * where it was, provided that note still exists.
 */
export async function restoreLocation(noteExists: (id: string) => Promise<boolean>) {
  if (window.location.pathname !== "/" || window.location.search !== "") return;
  let saved: string | null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (saved === null || !saved.startsWith("/") || saved.startsWith("//")) return;
  // Saved before conspects had their own paths.
  const url = new URL(saved.replace(/^\/notes\//, "/conspects/"), window.location.origin);
  if (url.origin !== window.location.origin || url.pathname + url.search === "/") return;
  const note = /^\/conspects\/([^/]+)$/.exec(url.pathname)?.[1];
  if (note !== undefined && !(await noteExists(decodeURIComponent(note)).catch(() => false))) {
    return;
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}
