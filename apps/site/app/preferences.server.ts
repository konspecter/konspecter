import { detectLocale } from "@konspecter/i18n";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n/i18n";
import { localizedPath, pageUrl, publicPage } from "./pages";

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
/** Set once the visitor has seen the cookie notice. */
const NOTICE_COOKIE = "cookies";
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

/** The language the visitor chose with the switch (cookie), or null. */
export function chosenLocale(request: Request): Locale | null {
  const lang = readCookies(request.headers.get("Cookie")).get(LANG_COOKIE);
  return isLocale(lang) ? lang : null;
}

/** The browser's language (Accept-Language) among the site's, else English. */
export function browserLocale(request: Request): Locale {
  return detectLocale(
    acceptedLanguages(request.headers.get("Accept-Language")),
    LOCALES,
    DEFAULT_LOCALE,
  );
}

/**
 * The language a public page should be shown in, when it differs from the
 * page's address (`at`): the chosen one, or — on a default-language address,
 * the x-default — the browser's. An address in another language was picked on
 * purpose (a link, the switch, a search result), so the browser's language
 * never moves the visitor off it; null keeps the page where it is.
 */
export function preferredLocale(request: Request, at: Locale): Locale | null {
  const preferred = chosenLocale(request) ?? (at === DEFAULT_LOCALE ? browserLocale(request) : at);
  return preferred === at ? null : preferred;
}

/**
 * The page's language: a public page's is its address's (pages.ts); any other
 * page takes the chosen one (cookie), else the browser's (Accept-Language),
 * else English.
 */
export function readPreferences(request: Request): Preferences {
  const theme = readCookies(request.headers.get("Cookie")).get(THEME_COOKIE);
  return {
    locale:
      publicPage(pageUrl(request).pathname)?.locale ??
      chosenLocale(request) ??
      browserLocale(request),
    theme: isTheme(theme) ? theme : "system",
  };
}

/** Whether the visitor has seen the cookie notice. */
export function cookieNoticeSeen(request: Request): boolean {
  return readCookies(request.headers.get("Cookie")).get(NOTICE_COOKIE) === "ok";
}

const COOKIE_NAMES = { lang: LANG_COOKIE, theme: THEME_COOKIE, cookies: NOTICE_COOKIE } as const;

/** A Set-Cookie value remembering one preference for a year. */
export function preferenceCookie(
  name: keyof typeof COOKIE_NAMES,
  value: string,
  secure: boolean,
): string {
  return [
    `${COOKIE_NAMES[name]}=${encodeURIComponent(value)}`,
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

/** The same page in another language: a public page's own address in it; any other path as is. */
export function pathInLocale(path: string, locale: Locale): string {
  const url = new URL(path, "http://site.invalid");
  const page = publicPage(url.pathname);
  return page ? localizedPath(locale, page.page) + url.search + url.hash : path;
}

/** Home in the visitor's language: where signing out and the like lead. */
export function homePath(request: Request): string {
  return localizedPath(readPreferences(request).locale, "/");
}
