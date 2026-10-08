# ADR-026: One canonical domain, an address per language

Status: accepted (2026-10-08).

## Context

Konspecter's own service has its names: `konspecter.com`, `konspecter.ru` and their `www.`
forms. The site (`apps/site`) served English and Russian at the same address, choosing by the
`lang` cookie, then `Accept-Language` ([i18n](../i18n.md)). A search engine crawls without
either, so it saw only the English pages, and the same page under several host names would be
indexed as several pages. Nothing told it which address is the page's own, which pages are
translations of each other, or that the sign-in and settings pages are not worth indexing.

## Decision

1. **`konspecter.com` is the canonical name** of the site and the API
   (`KONSPECTER_PUBLIC_URL=https://konspecter.com`). The web app is `app.konspecter.com`
   ([ADR-018](ADR-018-web-app-origin.md)).
2. **The other names redirect for good (301):** `www.konspecter.com` to the same path on
   `konspecter.com`; `konspecter.ru` and `www.konspecter.ru` to the same path under `/ru` (a
   path already under `/ru` as it is). Caddy does it (`deploy/Caddyfile`:
   `KONSPECTER_REDIRECT_ADDRESSES`, `KONSPECTER_RU_REDIRECT_ADDRESSES`), so a self-hosted
   server can do the same for its names.
3. **The public pages have an address per language:** home, the Markdown cheatsheet, the
   terms and the privacy policy (`apps/site/app/pages.ts`). English is at the path itself
   (`/`, `/markdown`) and is the `x-default`; Russian is under `/ru` (`/ru/`, `/ru/markdown`).
   A public page speaks its address's language, whatever the cookie or the browser say.
4. **Every public page says what it is:** `<link rel="canonical">` to its own address on
   `KONSPECTER_PUBLIC_URL`, `<link rel="alternate" hreflang>` for `en`, `ru` and `x-default`,
   and `<html lang>`. `/sitemap.xml` lists them with the same alternates; `/robots.txt` points
   at it and keeps crawlers off `/api/`.
5. **Every other page is one address and `noindex`:** sign-in, registration, settings,
   activation, the connect page, 404 and error pages. They speak the visitor's language as
   before (cookie, then `Accept-Language`, then English). Any other path under `/ru`
   (`konspecter.ru/login` lands on `/ru/login`) redirects (301) to the path without it.
6. **A public page opens in the visitor's language** (302, `Vary: Cookie, Accept-Language`
   on every page):
   - a language chosen with the switch (the `lang` cookie) wins: a public page in another
     language is sent to its address in the chosen one; the switch sets the cookie and goes
     there itself;
   - otherwise, on an English address (the x-default), the browser's language
     (`Accept-Language`) decides: a Russian browser opening `/markdown` gets `/ru/markdown`;
     a language the site lacks, or none, stays on English;
   - an address in another language (`/ru/…`) is never moved by the browser's language: it
     was picked on purpose (a link, a search result, `konspecter.ru`). So every language
     stays reachable for crawlers, which mostly send no `Accept-Language` and no cookie.
7. **The web app is `noindex, nofollow`** (`X-Robots-Tag` in `apps/web/Caddyfile`): it is a
   tool with the reader's own notes, and the site is what search should find.
8. Links within the site to a public page, and redirects home (signing out, a password reset,
   a deleted account), go to the page in the page's language. Emails link to the home page in
   their language.

## Alternatives

- **One address per page, the language by cookie** (as before), with `Vary: Accept-Language`:
  no URL change, but search engines index one language only, and `hreflang` cannot name
  translations that have no address of their own.
- **A domain per language** (`konspecter.ru` serving Russian): two sites to keep apart, two
  origins for sign-in cookies and CORS, and the account site and API would be split or
  duplicated. One canonical domain keeps one origin.
- **A prefix for every language, `/en/` too:** symmetric, but every English address moves and
  `/` becomes a page that only chooses.
- **No redirect by `Accept-Language`, only by an explicit choice:** safest for crawlers, but a
  first-time visitor would read a language other than their browser's until they switch.
- **Redirect every address by `Accept-Language`, `/ru/…` to English too:** a crawler that
  sends English (or nothing, read as English) could never fetch the Russian pages, and a
  shared link would not open as it was sent.

## Consequences

- The Russian pages are found and indexed in Russian, and links to `konspecter.ru` and `www.`
  keep their weight on `konspecter.com`.
- A first-time Russian visitor who opens `konspecter.com` reads Russian at `/ru/`; to read
  English they switch, and the choice is kept. A crawler that sends a Russian
  `Accept-Language` is redirected from the English addresses too, and finds them through
  `hreflang` and the sitemap only when it crawls without one.
- A new public page is added in `PUBLIC_PAGES` and in both branches of `routes.ts`. A new
  language adds its prefix branch there and its dictionary: the browser's language then
  leads to it like to Russian (`detectLocale` over `LOCALES`).
