import { MoonIcon, SunIcon } from "@konspecter/ui/icons";
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
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { accountContext, loadAccount } from "./account.server";
import { siteConfig } from "./config.server";
import { translator, useT, type Locale } from "./i18n/i18n";
import { isSameOriginRequest } from "./origin.server";
import { readPreferences, type Theme } from "./preferences.server";
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
  const { user, enabled } = context.get(accountContext);
  return { ...readPreferences(request), email: user?.email ?? null, accounts: enabled };
}

interface RootData {
  readonly locale: Locale;
  readonly theme: Theme;
  readonly email: string | null;
  readonly accounts: boolean;
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

/** The switches post to /preferences and come back here; plain forms, so no script is needed. */
function Preferences({ locale }: { locale: Locale }) {
  const { t } = useT();
  const location = useLocation();
  const back = `${location.pathname}${location.search}`;
  return (
    <div className="site-preferences">
      <form method="post" action="/preferences">
        <input type="hidden" name="back" value={back} />
        <button
          type="submit"
          name="lang"
          value={locale === "en" ? "ru" : "en"}
          className="language-switch"
          lang={locale === "en" ? "ru" : "en"}
          title={t("site.otherLanguageHint")}
        >
          {t("site.otherLanguage")}
        </button>
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

/** Sign in, or the signed-in address and Sign out. */
function AccountLinks({ email, accounts }: { email: string | null; accounts: boolean }) {
  const { t } = useT();
  if (email) {
    return (
      <form method="post" action="/logout" className="site-account">
        <span className="site-account-email">{email}</span>
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
  return (
    <header className="site-header">
      <div className="site-frame site-header-row">
        <Link to="/" className="site-brand" aria-label={t("site.home")}>
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>Konspecter</span>
        </Link>
        <div className="site-header-end">
          <Preferences locale={data.locale} />
          <AccountLinks email={data.email} accounts={data.accounts} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useT();
  return (
    <footer className="site-footer">
      <div className="site-frame">
        <p>{t("site.footer")}</p>
      </div>
    </footer>
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
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  if (!missing) console.error(error);
  return (
    <main id="content" className="site-frame message-page">
      <title>{`${t("error.title")} · Konspecter`}</title>
      <h1>{missing ? t("error.title") : "Konspecter"}</h1>
      <p>{missing ? t("error.notFound") : t("error.failed")}</p>
      <p>
        <Link to="/">{t("error.home")}</Link>
      </p>
    </main>
  );
}
