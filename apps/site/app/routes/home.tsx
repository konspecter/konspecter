import { richText } from "@konspecter/i18n/rich";
import { useId, useState } from "react";
import { data, Form, Link, redirect, useActionData } from "react-router";
import { accountContext } from "../account.server";
import { callApi } from "../api.server";
import { formError, FormMessage, Submit, textField, type FormError } from "../auth-form";
import { startCheckout } from "../checkout.server";
import { firstMarks, MARKDOWN_GUIDE } from "../cheatsheet";
import { downloadsFor } from "../downloads.server";
import { useLocale, useT } from "../i18n/i18n";
import { SELF_HOSTING } from "../links";
import { useLocalePath } from "../pages";
import type { Platform } from "../platform";
import { PlatformList } from "../platform-list";
import { readPreferences } from "../preferences.server";
import { discounts, durationText, money, parsePlans, periodText } from "../subscription";
import { SPECIMENS } from "../specimen";
import { SpecimenSlider } from "../specimen-slider";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const plans = parsePlans(
    (await callApi(request, `/api/billing/plans?locale=${readPreferences(request).locale}`)).data,
  );
  // Where sync is paid: every price on sale, each with what it saves, and the trial.
  const options = plans.gateways.flatMap((gateway) => {
    const saves = discounts(gateway.prices);
    return gateway.prices.map((price, index) => ({
      plan: `${gateway.id}:${price.period}`,
      gateway: gateway.name,
      amount: price.amount,
      currency: gateway.currency,
      period: price.period,
      discount: saves[index] ?? 0,
    }));
  });
  // Paid sync that the page's language has no gateway for is as good as off.
  const sync: SyncOffer = !plans.paid ? "free" : options.length > 0 ? "paid" : "none";
  return {
    sync,
    pricing:
      options.length > 0
        ? { options, several: plans.gateways.length > 1, trial: plans.trial }
        : null,
    ...downloadsFor(request),
  };
}

/**
 * Buying sync from the home page: the chosen period, straight to the
 * gateway's page. A signed-out visitor signs in first and lands on the
 * settings page with that period chosen.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const settings = `/settings?plan=${encodeURIComponent(textField(form, "plan"))}#subscription`;
  const signIn = `/login?next=${encodeURIComponent(settings)}`;
  if (!context.get(accountContext).user) throw redirect(signIn);
  const { url, result } = await startCheckout(request, form);
  if (result.status === 401) throw redirect(signIn);
  if (url) return redirect(url);
  const error = result.error ?? { code: "internal" };
  return data({ error: formError(error.code, result.retryAfter) }, result.status);
}

/** How this server offers sync: free, for a subscription, or not at all. */
type SyncOffer = "free" | "paid" | "none";

const FEATURES = ["write", "find", "tags", "offline", "devices", "private"] as const;

/**
 * The features about sync speak of syncing your own way too; where this
 * server offers no sync, of that way alone.
 */
const SYNC_TEXT = {
  devices: {
    free: "home.feature.devices.text",
    paid: "home.feature.devices.text",
    none: "home.feature.devices.textNone",
  },
  private: {
    free: "home.feature.private.text",
    paid: "home.feature.private.text",
    none: "home.feature.private.textNone",
  },
} as const;

function bySync(feature: (typeof FEATURES)[number]): feature is keyof typeof SYNC_TEXT {
  return Object.hasOwn(SYNC_TEXT, feature);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const translate = useT();
  const { t } = translate;
  const locale = useLocale();
  const localePath = useLocalePath();
  const { downloads, suggested, sync } = loaderData;
  const pricing = loaderData.pricing;
  const actionData = useActionData<typeof action>();
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
                // One short word, so both buttons fit on a line in every
                // language; the platform is in its accessible name.
                <a
                  className="button button-primary"
                  href={suggestedUrl}
                  aria-label={t("home.download", { platform: platformName(suggested) })}
                >
                  {t("home.get")}
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

      <section id="sync" className="pricing site-frame" aria-labelledby="sync-title">
        <h2 id="sync-title">{t("home.sync.title")}</h2>
        <p className="section-lead">
          {t(sync === "none" ? "home.sync.leadNone" : "home.sync.lead")}
        </p>
        <div className="price-table">
          <div className="price-plan">
            <h3>{t("home.sync.own.title")}</h3>
            <p className="price-amount">{t("home.sync.own.headline")}</p>
            <ul className="sync-ways">
              <li>{t("home.sync.own.folder")}</li>
              <li>{t("home.sync.own.transfer")}</li>
              <li>{t("home.sync.own.server")}</li>
            </ul>
            <div className="actions">
              <a className="button" href={SELF_HOSTING}>
                {t("home.sync.own.guide")}
              </a>
            </div>
          </div>
          {sync !== "none" && (
            <div className="price-plan">
              <h3>{t("home.sync.service.title")}</h3>
              {pricing ? (
                <BuySync pricing={pricing} error={actionData?.error ?? null} />
              ) : (
                <>
                  <p className="price-amount">{t("home.sync.free")}</p>
                  <p className="price-text">{t("home.sync.service.text")}</p>
                  <div className="actions">
                    <Link className="button button-primary" to="/settings">
                      {t("home.sync.connect")}
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="features site-frame" aria-labelledby="features-title">
        <h2 id="features-title">{t("home.featuresTitle")}</h2>
        <dl className="feature-list">
          {FEATURES.map((feature) => (
            <div key={feature} className="feature">
              <dt>{t(`home.feature.${feature}.title`)}</dt>
              <dd>
                {t(bySync(feature) ? SYNC_TEXT[feature][sync] : `home.feature.${feature}.text`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="markdown site-frame" aria-labelledby="markdown-title">
        <div className="markdown-text">
          <h2 id="markdown-title">{t("home.markdown.title")}</h2>
          <p className="section-lead">{t("home.markdown.text")}</p>
          <div className="actions">
            <Link className="button" to={localePath("/markdown")}>
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

      {downloads.length > 0 && (
        <section id="download" className="downloads site-frame" aria-labelledby="download-title">
          <h2 id="download-title">{t("home.downloadsTitle")}</h2>
          <p className="section-lead">{t("home.downloadsLead")}</p>
          <PlatformList downloads={downloads} suggested={suggested} />
          <p className="platform-more">
            <Link to={localePath("/download")}>{t("home.downloadsMore")}</Link>
          </p>
        </section>
      )}
    </>
  );
}

type Pricing = NonNullable<Route.ComponentProps["loaderData"]["pricing"]>;

/**
 * Sync for a subscription: every period on sale with what it saves, the
 * consent, and buying the chosen one at once. The price on top follows the
 * choice; the trial, where there is one, starts from the settings page.
 */
function BuySync({ pricing, error }: { pricing: Pricing; error: FormError | null }) {
  const translate = useT();
  const { t } = translate;
  const locale = useLocale();
  const localePath = useLocalePath();
  const consentId = useId();
  const { options, several, trial } = pricing;
  const [chosen, setChosen] = useState(0);
  const option = options[chosen] ?? options[0];
  if (!option) return null;
  const every = (period: string) => t("home.sync.every", { period: periodText(translate, period) });
  return (
    <Form method="post" className="price-buy">
      <p className="price-amount">
        {money(option.amount, option.currency, locale)}{" "}
        <span className="price-period">{every(option.period)}</span>
      </p>
      <p className="price-text">
        {t("home.sync.service.text")} {t("home.sync.cancel")}
        {trial && ` ${t("home.sync.trial", { trial: durationText(translate, trial) })}`}
      </p>
      {options.length > 1 ? (
        <fieldset className="price-options">
          <legend>{t("subscription.choose")}</legend>
          {options.map((item, index) => (
            <label key={item.plan} className="price-option">
              <input
                type="radio"
                name="plan"
                value={item.plan}
                checked={index === chosen}
                onChange={() => {
                  setChosen(index);
                }}
              />
              <span>
                {money(item.amount, item.currency, locale)} {every(item.period)}
                {several && (
                  <span className="price-gateway">
                    {t("subscription.via", { gateway: item.gateway })}
                  </span>
                )}
              </span>
              {item.discount > 0 && " "}
              {item.discount > 0 && (
                <span className="price-discount">
                  {new Intl.NumberFormat(locale, { style: "percent" }).format(-item.discount / 100)}
                </span>
              )}
            </label>
          ))}
        </fieldset>
      ) : (
        <input type="hidden" name="plan" value={option.plan} />
      )}
      <div className="consent">
        <input id={consentId} type="checkbox" name="accept" value="yes" required />
        <label htmlFor={consentId}>
          {richText(t("subscription.consent"), {
            terms: <Link to={localePath("/terms")}>{t("subscription.consentTerms")}</Link>,
            privacy: <Link to={localePath("/privacy")}>{t("subscription.consentPrivacy")}</Link>,
          })}
        </label>
      </div>
      <FormMessage error={error} />
      <div className="actions">
        <Submit>{t("home.sync.buy")}</Submit>
        {trial && (
          <Link className="button" to="/settings">
            {t("home.sync.try")}
          </Link>
        )}
        <Link className="price-terms" to={localePath("/terms")}>
          {t("home.sync.terms")}
        </Link>
      </div>
    </Form>
  );
}
