import { detectLocale } from "@konspecter/i18n";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n/i18n";

/**
 * The visitor's language and theme, kept in two plain cookies so the server
 * renders the right page on the first request (no flash, no script).
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export interface Preferences {
  readonly locale: Locale;
  readonly theme: Theme;
}

const LANG_COOKIE = "lang";
const THEME_COOKIE = "theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

export function readCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.split("=");
    const key = name?.trim();
    if (!key) continue;
    try {
      cookies.set(key, decodeURIComponent(rest.join("=").trim()));
    } catch {
      // A malformed value is ignored like a missing cookie.
    }
  }
  return cookies;
}

/** The languages of an Accept-Language header, most preferred first. */
export function acceptedLanguages(header: string | null): string[] {
  return (header ?? "")
    .split(",")
    .map((entry) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry) => entry.tag !== "" && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

/** The chosen language (cookie), else the browser's (Accept-Language), else English. */
export function readPreferences(request: Request): Preferences {
  const cookies = readCookies(request.headers.get("Cookie"));
  const lang = cookies.get(LANG_COOKIE);
  const theme = cookies.get(THEME_COOKIE);
  return {
    locale: isLocale(lang)
      ? lang
      : detectLocale(
          acceptedLanguages(request.headers.get("Accept-Language")),
          LOCALES,
          DEFAULT_LOCALE,
        ),
    theme: isTheme(theme) ? theme : "system",
  };
}

/** A Set-Cookie value remembering one preference for a year. */
export function preferenceCookie(name: "lang" | "theme", value: string, secure: boolean): string {
  return [
    `${name === "lang" ? LANG_COOKIE : THEME_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${String(ONE_YEAR)}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** A same-site path to go back to after changing a preference; anything else becomes "/". */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}
