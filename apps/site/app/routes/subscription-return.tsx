import { CheckCircleIcon } from "@konspecter/ui/icons";
import { useEffect } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import { requireUser, signInPath } from "../account.server";
import { callApi } from "../api.server";
import { AuthPage } from "../auth-form";
import { useLocale, useT } from "../i18n/i18n";
import { day, parseBilling } from "../subscription";
import type { Route } from "./+types/subscription-return";

/**
 * Where the payment gateway sends the payer back
 * (`/subscription/return?id=…`). The server reads the payment from the
 * gateway, so the page knows even before the gateway's notification: paid,
 * still waiting (the page looks again by itself while it is open), or not
 * paid. The cross closes it for the subscription in the settings, which
 * shows the payment from then on: a payer who left the gateway without
 * paying is not kept waiting here.
 */

/** How often a waiting page looks again, in milliseconds. */
const RECHECK_MS = 5000;

/** Where the page closes to. */
const SETTINGS = "/settings#subscription";

export async function loader({ request, context }: Route.LoaderArgs) {
  requireUser(request, context);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const result = await callApi(request, `/api/subscription/checkouts/${encodeURIComponent(id)}`);
  if (result.status === 401) throw redirect(signInPath(request));
  const billing = parseBilling(result.data);
  const checkout = billing?.checkout ?? null;
  const outcome =
    checkout === null
      ? ("unknown" as const)
      : checkout.status === "pending"
        ? ("waiting" as const)
        : checkout.status === "ended"
          ? ("failed" as const)
          : ("paid" as const);
  return { outcome, paidUntil: billing?.paidUntil ?? null, once: checkout?.autoRenew === false };
}

export default function SubscriptionReturn() {
  const { t } = useT();
  const locale = useLocale();
  const { outcome, paidUntil, once } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();
  const close = { to: SETTINGS, label: t("checkout.close") };

  // Not a <meta> refresh: the browser keeps one scheduled after the page is
  // left in the app, and brings the payer back to it.
  const waiting = outcome === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const check = setInterval(() => {
      void revalidate();
    }, RECHECK_MS);
    return () => {
      clearInterval(check);
    };
  }, [waiting, revalidate]);

  if (outcome === "paid") {
    return (
      <AuthPage title={t("checkout.paidTitle")} close={close}>
        <div className="signed-in" role="status">
          <CheckCircleIcon className="signed-in-check" />
          <p>
            {paidUntil
              ? t(once ? "checkout.paidOnce" : "checkout.paid", { date: day(paidUntil, locale) })
              : t("checkout.paidNoDate")}
          </p>
        </div>
        <p className="auth-links">
          <Link to={SETTINGS}>{t("checkout.toSettings")}</Link>
        </p>
      </AuthPage>
    );
  }
  if (outcome === "waiting") {
    return (
      <AuthPage title={t("checkout.waitingTitle")} close={close}>
        <p className="form-notice" role="status">
          {t("checkout.waiting")}
        </p>
        <p className="auth-links">
          <Link to={SETTINGS}>{t("checkout.toSettings")}</Link>
        </p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={t("checkout.failedTitle")} close={close}>
      <p className="inline-error" role="alert">
        {outcome === "failed" ? t("checkout.failed") : t("checkout.unknown")}
      </p>
      <p className="auth-links">
        <Link to={SETTINGS}>{t("checkout.toSettings")}</Link>
      </p>
    </AuthPage>
  );
}
