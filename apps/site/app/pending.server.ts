import { siteConfig } from "./config.server";
import { readCookies } from "./preferences.server";

/**
 * Between asking for a sign-in code and entering it, the site remembers the
 * address (and whether this is a sign-up, or finishes a sign-in with another
 * service) in a short-lived cookie, so the address stays out of URLs and logs.
 */
export type PendingMode = "login" | "register" | "complete";

export interface Pending {
  readonly mode: PendingMode;
  readonly email: string;
}

const COOKIE = "ksp_pending";
const LIFETIME_SECONDS = 15 * 60;

function attributes(maxAge: number): string {
  const secure = siteConfig().publicOrigin?.startsWith("https:") ?? false;
  return `; Path=/; Max-Age=${String(maxAge)}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function pendingCookie(pending: Pending): string {
  return `${COOKIE}=${encodeURIComponent(`${pending.mode}:${pending.email}`)}${attributes(LIFETIME_SECONDS)}`;
}

export function clearPendingCookie(): string {
  return `${COOKIE}=${attributes(0)}`;
}

export function readPending(request: Request): Pending | null {
  const value = readCookies(request.headers.get("Cookie")).get(COOKIE) ?? "";
  const separator = value.indexOf(":");
  const mode = value.slice(0, separator);
  const email = value.slice(separator + 1);
  if (
    separator < 0 ||
    (mode !== "login" && mode !== "register" && mode !== "complete") ||
    !email.includes("@")
  )
    return null;
  return { mode, email };
}
