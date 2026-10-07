/**
 * A connect link, as the account site shows it (as a QR code, or as text to
 * paste): `https://notes.example.com/connect#ksc_…`. The site's address is
 * the server to sync with; the fragment is a one-time code the server trades
 * for this device's token. A browser that holds the encryption key adds
 * `.<secret>`: the secret opens the key the server hands over with the
 * token, so the app needs no passphrase (ADR-025).
 */
export type ConnectLink = {
  readonly serverUrl: string;
  readonly code: string;
  /** Opens the content key sealed for this app; null when the link has none. */
  readonly keySecret: string | null;
};

const FRAGMENT = /^(ksc_[A-Za-z0-9_-]{32})(?:\.([A-Za-z0-9_-]{43}))?$/;
const PAGE = "/connect";

/** Reads a connect link; null for anything else (another QR code, a typo). */
export function parseConnectLink(text: string): ConnectLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "") return null;
  // The site may live under a path of its own: the server is what comes before /connect.
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(PAGE)) return null;
  const fragment = FRAGMENT.exec(url.hash.slice(1));
  if (!fragment?.[1]) return null;
  return {
    serverUrl: url.origin + path.slice(0, -PAGE.length),
    code: fragment[1],
    keySecret: fragment[2] ?? null,
  };
}
