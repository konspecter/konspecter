/**
 * A connect link, as the account site shows it (as a QR code, or as text to
 * paste): `https://notes.example.com/connect#ksc_…`. The site's address is
 * the server to sync with; the fragment is a one-time code the server trades
 * for this device's token.
 */
export type ConnectLink = {
  readonly serverUrl: string;
  readonly code: string;
};

const CODE = /^ksc_[A-Za-z0-9_-]{32}$/;
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
  const code = url.hash.slice(1);
  if (!CODE.test(code)) return null;
  return { serverUrl: url.origin + path.slice(0, -PAGE.length), code };
}
