import { Link } from "react-router";
import { callApi } from "../api.server";
import { firstMarks, MARKDOWN_GUIDE } from "../cheatsheet";
import { siteConfig } from "../config.server";
import { useLocale, useT } from "../i18n/i18n";
import { guessPlatform, PLATFORMS, type Platform } from "../platform";
import { readPreferences } from "../preferences.server";
import { durationText, money, parsePlans, periodText } from "../subscription";
import { SPECIMENS } from "../specimen";
import { SpecimenSlider } from "../specimen-slider";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const { downloads } = siteConfig();
  const guess = guessPlatform(request.headers.get("User-Agent"));
  const plans = parsePlans(
    (await callApi(request, `/api/billing/plans?locale=${readPreferences(request).locale}`)).data,
  );
  // Where sync is paid: its first price, and the trial.
  const gateway = plans.gateways[0];
  const price = gateway?.prices[0];
  return {
    pricing:
      gateway && price
        ? {
            amount: price.amount,
            currency: gateway.currency,
            period: price.period,
            trial: plans.trial,
          }
        : null,
    downloads: PLATFORMS.flatMap((platform) => {
      const url = downloads[platform];
      return url ? [{ platform, url }] : [];
    }),
    suggested: guess && downloads[guess] ? guess : null,
  };
}

const FEATURES = ["write", "find", "tags", "offline", "devices", "private"] as const;

export default function Home({ loaderData }: Route.ComponentProps) {
  const translate = useT();
  const { t } = translate;
  const locale = useLocale();
  const { downloads, suggested } = loaderData;
  const pricing = loaderData.pricing;
  const platformName = (platform: Platform) => t(`home.platform.${platform}`);
  const web = downloads.find((download) => download.platform === "web");
  const apps = downloads.filter((download) => download.platform !== "web");
  const suggestedUrl = downloads.find((download) => download.platform === suggested)?.url;

  return (
    <>
      <title>{`${t("home.title")} · Konspecter`}</title>
      <section className="hero site-frame">
        <div className="hero-text">
          <h1>{t("home.title")}</h1>
          <p className="hero-lead">{t("home.lead")}</p>
          {(apps.length > 0 || web) && (
            <div className="actions hero-actions">
              {suggested && suggested !== "web" && suggestedUrl ? (
                <a className="button button-primary" href={suggestedUrl}>
                  {t("home.download", { platform: platformName(suggested) })}
                </a>
              ) : (
                apps.length > 0 && (
                  <a className="button button-primary" href="#download">
                    {t("home.get")}
                  </a>
                )
              )}
              {web && (
                <a className="button" href={web.url}>
                  {t("home.openWeb")}
                </a>
              )}
            </div>
          )}
          <p className="hero-note">
            {t("home.free")}
            {downloads.length > 1 && (
              <>
                {" "}
                <a href="#download">{t("home.allPlatforms")}</a>
              </>
            )}
          </p>
        </div>
        <SpecimenSlider specimens={SPECIMENS[locale]} />
      </section>

      <section className="features site-frame" aria-labelledby="features-title">
        <h2 id="features-title">{t("home.featuresTitle")}</h2>
        <dl className="feature-list">
          {FEATURES.map((feature) => (
            <div key={feature} className="feature">
              <dt>{t(`home.feature.${feature}.title`)}</dt>
              <dd>{t(`home.feature.${feature}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="markdown site-frame" aria-labelledby="markdown-title">
        <div className="markdown-text">
          <h2 id="markdown-title">{t("home.markdown.title")}</h2>
          <p className="section-lead">{t("home.markdown.text")}</p>
          <div className="actions">
            <Link className="button" to="/markdown">
              {t("home.markdown.cheatsheet")}
            </Link>
            <a className="button" href={MARKDOWN_GUIDE[locale]}>
              {t("home.markdown.guide")}
            </a>
          </div>
        </div>
        <ul className="markdown-marks" aria-label={t("home.markdown.marks")}>
          {firstMarks(locale).map((mark) => (
            <li key={mark}>
              <code>{mark}</code>
            </li>
          ))}
        </ul>
      </section>

      {pricing && (
        <section className="pricing site-frame" aria-labelledby="pricing-title">
          <h2 id="pricing-title">{t("home.price.title")}</h2>
          <div className="price-table">
            <div className="price-plan">
              <h3>{t("home.price.appsTitle")}</h3>
              <p className="price-amount">{t("home.price.free")}</p>
              <p className="price-text">{t("home.price.appsText")}</p>
            </div>
            <div className="price-plan">
              <h3>{t("home.price.syncTitle")}</h3>
              <p className="price-amount">
                {money(pricing.amount, pricing.currency, locale)}{" "}
                <span className="price-period">
                  {t("home.price.every", { period: periodText(translate, pricing.period) })}
                </span>
              </p>
              <p className="price-text">
                {t("home.price.syncText")}
                {pricing.trial &&
                  ` ${t("home.pricingTrial", { trial: durationText(translate, pricing.trial) })}`}
              </p>
              <div className="actions">
                <Link className="button button-primary" to="/settings">
                  {pricing.trial ? t("home.price.try") : t("home.price.get")}
                </Link>
                <Link className="price-terms" to="/terms">
                  {t("home.pricingTerms")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {downloads.length > 0 && (
        <section id="download" className="downloads site-frame" aria-labelledby="download-title">
          <h2 id="download-title">{t("home.downloadsTitle")}</h2>
          <p className="section-lead">{t("home.downloadsLead")}</p>
          <ul className="platform-list">
            {downloads.map(({ platform, url }) => (
              <li key={platform} className="platform">
                <span className="platform-name">{platformName(platform)}</span>
                <span className="platform-note">{t(`home.platformNote.${platform}`)}</span>
                <a
                  className={platform === suggested ? "button button-primary" : "button"}
                  href={url}
                  aria-label={
                    platform === "web"
                      ? t("home.openWeb")
                      : t("home.download", { platform: platformName(platform) })
                  }
                >
                  {platform === "web" ? t("home.open") : t("home.get")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
