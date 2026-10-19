import { richText } from "@konspecter/i18n/rich";
import { useEffect, useId, useRef, useState } from "react";
import { Form, Link, useSubmit } from "react-router";
import { FormMessage, Submit, type FormError } from "./auth-form";
import { useLocale, useT } from "./i18n/i18n";
import {
  day,
  durationText,
  money,
  periodText,
  pricePeriod,
  type Billing,
  type GatewayPlan,
  type Payment,
  type SetupStep,
} from "./subscription";

/**
 * The subscription on the settings page (paid sync): how long sync works,
 * subscribing (with consent to the terms and to automatic renewal) or
 * paying for one period (Auto renew unticked, and kept so for the next time),
 * cancelling (a confirm step that says nothing is lost), resuming, and the
 * payments. Sync is end-to-end encrypted, so paying is only the first of two
 * steps: the form says so, and once sync is paid the section names the step
 * left (until it is done) and folds the form behind a button. Where the server sells no sync in the page's language (no
 * gateways), it says so instead of offering to subscribe. Plain forms; the gateway's page is opened from the answer to
 * subscribing (a link, followed at once when the page's script runs).
 */
export function SubscriptionSection({
  billing,
  gateways,
  plan,
  autoRenew = true,
  startTrial = false,
  setup = null,
  now,
  error,
  notice,
  redirectUrl,
}: {
  billing: Billing;
  gateways: readonly GatewayPlan[];
  /** The plan ("gateway:period") to offer first; the first one when it is not on sale. */
  plan: string;
  /**
   * Auto renew ticked at first, unless its owner last chose it unticked; not
   * when renewing a period paid once from its email.
   */
  autoRenew?: boolean;
  /** Start the trial at once, if the account is due one (asked for before signing in). */
  startTrial?: boolean;
  /** What is left to set up before sync runs. */
  setup?: SetupStep | null;
  now: number;
  error: FormError | null;
  notice: string | null;
  redirectUrl: string | null;
}) {
  const t = useT();
  const sub = billing.subscription;
  const renewing = sub?.status === "active" || sub?.status === "past_due";
  const paid = billing.paidUntil !== null && Date.parse(billing.paidUntil) > now;
  // Folded once paid, unless the visitor came to buy: a period chosen on the
  // home page, a renewal from its email, or a try that failed.
  const subscribe = (
    <Subscribe
      gateways={gateways}
      plan={plan}
      autoRenew={autoRenew && billing.autoRenewChoice}
      steps={!paid}
    />
  );
  return (
    <section className="settings-section" id="subscription" aria-labelledby="subscription-heading">
      <h2 id="subscription-heading">{t.t("subscription.title")}</h2>
      <AccessText billing={billing} sold={gateways.length > 0} startTrial={startTrial} />
      {paid && setup && <SetupLeft step={setup} />}
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
          {billing.access.state === "lifetime" ? null : gateways.length > 0 ? (
            paid ? (
              <details className="buy-more" open={plan !== "" || !autoRenew || error !== null}>
                <summary className="button">{t.t("subscription.buyMore")}</summary>
                {subscribe}
              </details>
            ) : (
              subscribe
            )
          ) : (
            <p className="settings-text">{t.t("subscription.unavailable")}</p>
          )}
        </>
      )}
      {billing.payments.length > 0 && <Payments payments={billing.payments} />}
    </section>
  );
}

function AccessText({
  billing,
  sold,
  startTrial,
}: {
  billing: Billing;
  sold: boolean;
  startTrial: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { state, until } = billing.access;
  const date = until ? day(until, locale) : "";
  const sub = billing.subscription;
  switch (state) {
    case "trialing":
      return <p className="settings-text">{t.t("subscription.state.trialing", { date })}</p>;
    case "granted":
      return <p className="settings-text">{t.t("subscription.state.granted", { date })}</p>;
    case "lifetime":
      return <p className="settings-text">{t.t("subscription.state.lifetime")}</p>;
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
      return (
        <p className="settings-text">
          {sub && !sub.autoRenew
            ? t.t("subscription.state.paidOnce", {
                period: durationText(t, sub.period),
                date: billing.paidUntil ? day(billing.paidUntil, locale) : date,
              })
            : t.t("subscription.state.canceled", { date })}
        </p>
      );
    case "past_due":
      return <p className="settings-text">{t.t("subscription.state.past_due", { date })}</p>;
    case "expired":
      // An account that had time is paused; one that never had any is asked to
      // subscribe, where the language sells sync.
      if (until) return <p className="settings-text">{t.t("subscription.state.paused")}</p>;
      if (!sold) return null;
      if (!billing.trial) {
        return <p className="settings-text">{t.t("subscription.state.unpaid")}</p>;
      }
      return (
        <>
          <p className="settings-text">
            {t.t("subscription.state.unpaidTrial", { trial: durationText(t, billing.trial) })}
          </p>
          <TryTrial now={startTrial} />
        </>
      );
    default:
      return null;
  }
}

/**
 * Starts the free trial; `now`, as the page's script runs (the visitor
 * asked for it on the home page before signing in).
 */
function TryTrial({ now }: { now: boolean }) {
  const t = useT();
  const submit = useSubmit();
  const started = useRef(false);
  useEffect(() => {
    if (!now || started.current) return;
    started.current = true;
    void submit({ intent: "trial" }, { method: "post" });
  }, [now, submit]);
  return (
    <Form method="post" className="actions">
      <Submit intent="trial" primary={false}>
        {t.t("subscription.try")}
      </Submit>
    </Form>
  );
}

/**
 * The step left before paid sync runs, with the way to it: `page` is where
 * its section is, the settings page itself when empty.
 */
export function SetupLeft({ step, page = "" }: { step: SetupStep; page?: string }) {
  const t = useT();
  return (
    <div className="setup-left">
      <p>{t.t(`subscription.setup.${step}`)}</p>
      <a className="button button-primary" href={`${page}#${step}`}>
        {t.t(`subscription.setup.${step}Go`)}
      </a>
    </div>
  );
}

/** `steps`: say first that paying is one of two steps (before sync is paid). */
function Subscribe({
  gateways,
  plan,
  autoRenew,
  steps,
}: {
  gateways: readonly GatewayPlan[];
  plan: string;
  autoRenew: boolean;
  steps: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const consentId = useId();
  const renewId = useId();
  const [accepted, setAccepted] = useState(false);
  const [renew, setRenew] = useState(autoRenew);
  const options = gateways.flatMap((gateway) =>
    gateway.prices.map((price) => ({ gateway, price })),
  );
  if (options.length === 0) return null;
  const chosen = Math.max(
    0,
    options.findIndex(({ gateway, price }) => `${gateway.id}:${price.period}` === plan),
  );
  const several = gateways.length > 1;
  return (
    <Form method="post" className="settings-form subscribe-form">
      {steps && (
        <div className="sync-steps">
          <p>{t.t("subscription.steps")}</p>
          <ol>
            <li>{t.t("subscription.stepPay")}</li>
            <li>{t.t("subscription.stepSetUp")}</li>
          </ol>
          <p>{t.t("subscription.stepsWhy")}</p>
        </div>
      )}
      <fieldset className="price-options">
        <legend>{t.t("subscription.choose")}</legend>
        {options.map(({ gateway, price }, index) => {
          const label = `${money(price.amount, gateway.currency, locale)} ${pricePeriod(t, price.period, renew)}`;
          return (
            <label key={`${gateway.id}:${price.period}`} className="price-option">
              <input
                type="radio"
                name="plan"
                value={`${gateway.id}:${price.period}`}
                defaultChecked={index === chosen}
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
        <input
          id={consentId}
          type="checkbox"
          name="accept"
          value="yes"
          required
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.target.checked);
          }}
        />
        <label htmlFor={consentId}>
          {richText(t.t(renew ? "subscription.consent" : "subscription.consentOnce"), {
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
        <span className="auto-renew">
          <input
            id={renewId}
            type="checkbox"
            name="auto_renew"
            value="yes"
            checked={renew}
            onChange={(event) => {
              setRenew(event.target.checked);
            }}
          />
          <label htmlFor={renewId}>{t.t("subscription.autoRenew")}</label>
        </span>
        <Submit disabled={!accepted} intent="subscribe">
          {t.t(renew ? "subscription.subscribe" : "subscription.pay")}
        </Submit>
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
