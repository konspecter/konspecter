import { DEFAULT_LOCALE, LOCALES, useLocale, type Locale } from "./i18n/i18n";

/**
 * The public pages, the ones search engines index (ADR-026). Each has an
 * address of its own in every language: English at the path itself (also the
 * x-default), Russian under /ru. Every other page (sign-in, settings…) has one
 * address, speaks the visitor's language and is kept out of search.
 */
export const PUBLIC_PAGES = ["/", "/markdown", "/terms", "/privacy"] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

/** A public page's address in a language: "/markdown" → "/ru/markdown", home → "/ru/". */
export function localizedPath(locale: Locale, page: PublicPage): string {
  if (locale === DEFAULT_LOCALE) return page;
  return page === "/" ? `/${locale}/` : `/${locale}${page}`;
}

/** The public page at a path and the language of that address; null for any other page. */
export function publicPage(pathname: string): { page: PublicPage; locale: Locale } | null {
  for (const locale of LOCALES) {
    let rest = pathname;
    if (locale !== DEFAULT_LOCALE) {
      const prefix = `/${locale}`;
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      rest = pathname.slice(prefix.length) || "/";
    }
    const page = PUBLIC_PAGES.find((candidate) => candidate === rest);
    if (page) return { page, locale };
  }
  return null;
}

/**
 * The address of the page a request is for. Navigating in the browser fetches
 * a page's data at its address plus ".data" ("/_root.data" for home), with a
 * `_routes` parameter; a loader sees that address as it is.
 */
export function pageUrl(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname === "/_root.data") url.pathname = "/";
  else if (url.pathname.endsWith(".data")) url.pathname = url.pathname.slice(0, -".data".length);
  url.searchParams.delete("_routes");
  return url;
}

export interface Alternate {
  /** A language, or "x-default" for visitors of any other one. */
  readonly hreflang: Locale | "x-default";
  readonly href: string;
}

/** A public page in every language, on the site's origin, then x-default (English). */
export function alternates(origin: string, page: PublicPage): Alternate[] {
  return [
    ...LOCALES.map((locale) => ({ hreflang: locale, href: origin + localizedPath(locale, page) })),
    { hreflang: "x-default", href: origin + localizedPath(DEFAULT_LOCALE, page) },
  ];
}

/** Links to public pages in the page's language: `localePath("/terms")`. */
export function useLocalePath(): (page: PublicPage) => string {
  const locale = useLocale();
  return (page) => localizedPath(locale, page);
}
