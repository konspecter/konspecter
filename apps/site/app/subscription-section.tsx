import { richText } from "@konspecter/i18n/rich";
import { useEffect, useId } from "react";
import { Form, Link } from "react-router";
import { FormMessage, Submit, type FormError } from "./auth-form";
import { useLocale, useT } from "./i18n/i18n";
import {
  day,
  durationText,
  money,
  periodText,
  type Billing,
  type GatewayPlan,
  type Payment,
} from "./subscription";

/**
 * The subscription on the settings page (paid sync): how long sync works,
 * subscribing (with consent to the terms and to automatic renewal),
 * cancelling (a confirm step that says nothing is lost), resuming, and the
 * payments. Plain forms; the gateway's page is opened from the answer to
 * subscribing (a link, followed at once when the page's script runs).
 */
export function SubscriptionSection({
  billing,
  gateways,
  error,
  notice,
  redirectUrl,
}: {
  billing: Billing;
  gateways: readonly GatewayPlan[];
  error: FormError | null;
  notice: string | null;
  redirectUrl: string | null;
}) {
  const t = useT();
  const sub = billing.subscription;
  const renewing = sub?.status === "active" || sub?.status === "past_due";
  return (
    <section className="settings-section" id="subscription" aria-labelledby="subscription-heading">
      <h2 id="subscription-heading">{t.t("subscription.title")}</h2>
      <AccessText billing={billing} />
      <FormMessage error={error} notice={notice} />
      {redirectUrl ? (
        <Checkout url={redirectUrl} />
      ) : renewing ? (
        <Cancel billing={billing} />
      ) : (
        <>
          {sub?.status === "pending" && (
            <p className="settings-text">{t.t("subscription.pending")}</p>
          )}
          {sub?.resumable && (
            <Form method="post" className="settings-form">
              <p className="settings-text">{t.t("subscription.resumeLead")}</p>
              <div className="actions">
                <Submit intent="resume">{t.t("subscription.resume")}</Submit>
              </div>
            </Form>
          )}
          <Subscribe gateways={gateways} />
        </>
      )}
      {billing.payments.length > 0 && <Payments payments={billing.payments} />}
    </section>
  );
}

function AccessText({ billing }: { billing: Billing }) {
  const t = useT();
  const locale = useLocale();
  const { state, until } = billing.access;
  const date = until ? day(until, locale) : "";
  const sub = billing.subscription;
  switch (state) {
    case "trialing":
      return <p className="settings-text">{t.t("subscription.state.trialing", { date })}</p>;
    case "active":
      return (
        <p className="settings-text">
          {sub
            ? t.t("subscription.state.active", {
                price: money(sub.amount, sub.currency, locale),
                period: periodText(t, sub.period),
                gateway: sub.gatewayName,
                date: day(sub.nextChargeAt ?? until ?? "", locale),
              })
            : t.t("subscription.state.paidUntil", {
                date: day(billing.paidUntil ?? until ?? "", locale),
              })}
        </p>
      );
    case "canceled":
      return <p className="settings-text">{t.t("subscription.state.canceled", { date })}</p>;
    case "past_due":
      return <p className="settings-text">{t.t("subscription.state.past_due", { date })}</p>;
    case "expired":
      // An account that had time is paused; one that never had any is asked to subscribe.
      if (until) return <p className="settings-text">{t.t("subscription.state.paused")}</p>;
      return (
        <p className="settings-text">
          {billing.trial
            ? t.t("subscription.state.unpaidTrial", { trial: durationText(t, billing.trial) })
            : t.t("subscription.state.unpaid")}
        </p>
      );
    default:
      return null;
  }
}

function Subscribe({ gateways }: { gateways: readonly GatewayPlan[] }) {
  const t = useT();
  const locale = useLocale();
  const consentId = useId();
  const options = gateways.flatMap((gateway) =>
    gateway.prices.map((price) => ({ gateway, price })),
  );
  if (options.length === 0) return null;
  const several = gateways.length > 1;
  return (
    <Form method="post" className="settings-form subscribe-form">
      <fieldset className="price-options">
        <legend>{t.t("subscription.choose")}</legend>
        {options.map(({ gateway, price }, index) => {
          const label = t.t("subscription.option", {
            price: money(price.amount, gateway.currency, locale),
            period: periodText(t, price.period),
          });
          return (
            <label key={`${gateway.id}:${price.period}`} className="price-option">
              <input
                type="radio"
                name="plan"
                value={`${gateway.id}:${price.period}`}
                defaultChecked={index === 0}
                required
              />
              <span>
                {label}
                {several && (
                  <span className="price-gateway">
                    {t.t("subscription.via", { gateway: gateway.name })}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="consent">
        <input id={consentId} type="checkbox" name="accept" value="yes" required />
        <label htmlFor={consentId}>
          {richText(t.t("subscription.consent"), {
            terms: <Link to="/terms">{t.t("subscription.consentTerms")}</Link>,
            privacy: <Link to="/privacy">{t.t("subscription.consentPrivacy")}</Link>,
          })}
        </label>
      </div>
      <p className="field-hint">
        {several
          ? t.t("subscription.payHintSeveral")
          : t.t("subscription.payHint", { gateway: gateways[0]?.name ?? "" })}
      </p>
      <div className="actions">
        <Submit intent="subscribe">{t.t("subscription.subscribe")}</Submit>
      </div>
    </Form>
  );
}

/** Cancelling asks once more, saying what stays. */
function Cancel({ billing }: { billing: Billing }) {
  const t = useT();
  const locale = useLocale();
  const until = billing.paidUntil ? day(billing.paidUntil, locale) : "";
  return (
    <details className="cancel-subscription">
      <summary className="button">{t.t("subscription.cancel")}</summary>
      <Form method="post" className="settings-form">
        <p className="settings-text">
          {until
            ? t.t("subscription.cancelLead", { date: until })
            : t.t("subscription.cancelLeadNoTime")}
        </p>
        <div className="actions">
          <button type="submit" name="intent" value="cancel" className="button button-danger">
            {t.t("subscription.cancelConfirm")}
          </button>
        </div>
      </Form>
    </details>
  );
}

/** Off to the gateway: at once with JavaScript, by the link without. */
function Checkout({ url }: { url: string }) {
  const t = useT();
  useEffect(() => {
    window.location.assign(url);
  }, [url]);
  return (
    <div className="actions">
      <a className="button button-primary" href={url}>
        {t.t("subscription.continue")}
      </a>
    </div>
  );
}

function Payments({ payments }: { payments: readonly Payment[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <h3 className="settings-subheading">{t.t("subscription.payments")}</h3>
      <ul className="payment-list">
        {payments.map((payment, index) => (
          <li key={`${payment.at}-${String(index)}`} className="payment">
            <span>{day(payment.at, locale)}</span>
            <span>{money(payment.amount, payment.currency, locale)}</span>
            <span className={`payment-status payment-${payment.status}`}>
              {t.t(`subscription.payment.${payment.status}`)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
