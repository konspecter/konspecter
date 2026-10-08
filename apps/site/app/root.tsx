import { ChevronIcon, GlobeIcon, MoonIcon, SunIcon } from "@konspecter/ui/icons";
import "@konspecter/ui/fonts.css";
import "@konspecter/ui/tokens.css";
import "@konspecter/ui/base.css";
import "@konspecter/ui/controls.css";
import type { ReactNode } from "react";
import {
  data,
  isRouteErrorResponse,
  Link,
  Links,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { accountContext, loadAccount } from "./account.server";
import { siteConfig } from "./config.server";
import { LOCALE_NAMES, LOCALES, translator, useT, type Locale } from "./i18n/i18n";
import { expectedOrigin, isSameOriginRequest } from "./origin.server";
import {
  alternates,
  localizedPath,
  pageUrl,
  publicPage,
  useLocalePath,
  type Alternate,
} from "./pages";
import { forgetKeyThenSubmit } from "./remembered-key";
import {
  cookieNoticeSeen,
  preferredLocale,
  readPreferences,
  type Theme,
} from "./preferences.server";
import type { Route } from "./+types/root";
import "./site.css";

/** Refuses forms posted from other sites before any action runs (see origin.server.ts). */
export const middleware: Route.MiddlewareFunction[] = [
  ({ request }, next) => {
    if (!isSameOriginRequest(request, siteConfig().publicOrigin)) {
      throw data("Cross-site request refused", { status: 403 });
    }
    return next();
  },
  // Who is signed in, for every loader and action of this request.
  async ({ request, context }, next) => {
    await loadAccount(request, context);
    return next();
  },
];

export function loader({ request, context }: Route.LoaderArgs) {
  const url = pageUrl(request);
  const page = publicPage(url.pathname);
  // A public page in the visitor's language: the one chosen with the switch,
  // else the browser's when the address is the x-default (ADR-026). Crawlers
  // mostly send neither, and an address in another language is never moved by
  // the browser's, so every language stays reachable for them.
  const preferred = page ? preferredLocale(request, page.locale) : null;
  if (page && preferred) {
    throw redirect(localizedPath(preferred, page.page) + url.search, {
      headers: { Vary: "Cookie, Accept-Language" },
    });
  }
  const { user, enabled } = context.get(accountContext);
  const origin = expectedOrigin(request, siteConfig().publicOrigin);
  return {
    ...readPreferences(request),
    email: user?.email ?? null,
    name: user?.name ?? "",
    accounts: enabled,
    cookieNotice: !cookieNoticeSeen(request),
    search: page
      ? {
          canonical: origin + localizedPath(page.locale, page.page),
          alternates: alternates(origin, page.page),
        }
      : null,
  };
}

/**
 * Every page depends on the language cookie and the browser's language (its
 * language, or a redirect to another address): caches keep them apart.
 */
export function headers() {
  return { Vary: "Cookie, Accept-Language" };
}

interface RootData {
  readonly locale: Locale;
  readonly theme: Theme;
  readonly email: string | null;
  /** The account's name; "" when it has none. */
  readonly name: string;
  readonly accounts: boolean;
  /** Whether to show the cookie notice (not seen yet). */
  readonly cookieNotice?: boolean;
  /** A public page's own address and its translations; null keeps the page out of search. */
  readonly search?: SearchLinks | null;
}

interface SearchLinks {
  readonly canonical: string;
  readonly alternates: readonly Alternate[];
}

/**
 * What search engines read in the head (ADR-026): a public page's canonical
 * address and its translations; any other page, and an error, is noindex.
 */
export function SearchTags({ search }: { search: SearchLinks | null }) {
  if (!search) return <meta name="robots" content="noindex" />;
  return (
    <>
      <link rel="canonical" href={search.canonical} />
      {search.alternates.map((link) => (
        <link key={link.hreflang} rel="alternate" hrefLang={link.hreflang} href={link.href} />
      ))}
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  // Missing when the root loader itself failed: the error page then uses the defaults.
  const preferences = useRouteLoaderData<RootData>("root");
  const locale = preferences?.locale ?? "en";
  const theme = preferences?.theme ?? "system";
  return (
    <html lang={locale} {...(theme === "system" ? {} : { "data-theme": theme })}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="description" content={translator(locale).t("site.description")} />
        <SearchTags search={preferences?.search ?? null} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * The switches post to /preferences and come back here; plain forms, so no
 * script is needed. The language is a dropdown that sends itself once the
 * page's script runs; without it, a button next to it does.
 */
function Preferences({ locale }: { locale: Locale }) {
  const { t } = useT();
  const location = useLocation();
  const back = `${location.pathname}${location.search}`;
  return (
    <div className="site-preferences">
      <form method="post" action="/preferences" className="language-form">
        <input type="hidden" name="back" value={back} />
        <span className="select language-select">
          <GlobeIcon />
          <select
            name="lang"
            defaultValue={locale}
            aria-label={t("site.language")}
            title={t("site.language")}
            onChange={(event) => {
              event.currentTarget.form?.requestSubmit();
            }}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option} lang={option}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
          <ChevronIcon />
        </span>
        <noscript>
          <button type="submit" className="link-button">
            {t("site.languageApply")}
          </button>
        </noscript>
      </form>
      {/* Both buttons are rendered; CSS shows the one that leads away from the current scheme. */}
      <form method="post" action="/preferences" className="theme-switch">
        <input type="hidden" name="back" value={back} />
        <button
          type="submit"
          name="theme"
          value="dark"
          className="icon-button theme-to-dark"
          aria-label={t("site.toDark")}
          title={t("site.toDark")}
        >
          <MoonIcon />
        </button>
        <button
          type="submit"
          name="theme"
          value="light"
          className="icon-button theme-to-light"
          aria-label={t("site.toLight")}
          title={t("site.toLight")}
        >
          <SunIcon />
        </button>
      </form>
    </div>
  );
}

/**
 * Sign in, or who is signed in (the name if the account has one, else the
 * address; a link to the settings) and Sign out.
 */
function AccountLinks({
  email,
  name,
  accounts,
}: {
  email: string | null;
  name: string;
  accounts: boolean;
}) {
  const { t } = useT();
  if (email) {
    return (
      <form method="post" action="/logout" className="site-account" onSubmit={forgetKeyThenSubmit}>
        <Link
          to="/settings"
          className="site-account-email"
          title={name ? `${t("site.settings")} (${email})` : t("site.settings")}
        >
          {name || email}
        </Link>
        <button type="submit" className="link-button">
          {t("site.signOut")}
        </button>
      </form>
    );
  }
  if (!accounts) return null;
  return (
    <Link to="/login" className="button site-sign-in">
      {t("site.signIn")}
    </Link>
  );
}

function Header({ data }: { data: RootData }) {
  const { t } = useT();
  const localePath = useLocalePath();
  return (
    <header className="site-header">
      <div className="site-frame site-header-row">
        <Link to={localePath("/")} className="site-brand" aria-label={t("site.home")}>
          <img className="logo-light" src="/logo.svg" alt="" width="28" height="28" />
          <img className="logo-dark" src="/logo-dark.svg" alt="" width="28" height="28" />
          <span>Konspecter</span>
        </Link>
        <div className="site-header-end">
          <Preferences locale={data.locale} />
          <AccountLinks email={data.email} name={data.name} accounts={data.accounts} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useT();
  const localePath = useLocalePath();
  return (
    <footer className="site-footer">
      <div className="site-frame site-footer-row">
        <p>{t("site.footer")}</p>
        <nav aria-label={t("site.footerLinks")} className="site-footer-links">
          <Link to={localePath("/markdown")}>{t("site.markdown")}</Link>
          <Link to={localePath("/terms")}>{t("site.terms")}</Link>
          <Link to={localePath("/privacy")}>{t("site.privacy")}</Link>
        </nav>
      </div>
    </footer>
  );
}

/**
 * Says which cookies the site sets (only those it needs) until the visitor
 * says OK: a plain form, so it works without JavaScript.
 */
function CookieNotice() {
  const { t } = useT();
  const localePath = useLocalePath();
  const location = useLocation();
  return (
    <aside className="cookie-notice" aria-label={t("cookies.label")}>
      <form method="post" action="/preferences" className="cookie-notice-body">
        <p>
          {t("cookies.notice")}{" "}
          <Link to={`${localePath("/privacy")}#cookies`}>{t("cookies.more")}</Link>
        </p>
        <input type="hidden" name="back" value={`${location.pathname}${location.search}`} />
        <button type="submit" name="cookies" value="ok" className="button button-primary">
          {t("cookies.ok")}
        </button>
      </form>
    </aside>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { t } = translator(loaderData.locale);
  return (
    <>
      <a className="skip-link" href="#content">
        {t("site.skipToContent")}
      </a>
      <Header data={loaderData} />
      <main id="content">
        <Outlet />
      </main>
      <Footer />
      {loaderData.cookieNotice && <CookieNotice />}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const localePath = useLocalePath();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  if (!missing) console.error(error);
  return (
    <main id="content" className="site-frame message-page">
      <title>{`${t("error.title")} · Konspecter`}</title>
      <h1>{missing ? t("error.title") : "Konspecter"}</h1>
      <p>{missing ? t("error.notFound") : t("error.failed")}</p>
      <p>
        <Link to={localePath("/")}>{t("error.home")}</Link>
      </p>
    </main>
  );
}
