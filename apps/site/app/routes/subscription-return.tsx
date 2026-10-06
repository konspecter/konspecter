import { CheckCircleIcon } from "@konspecter/ui/icons";
import { Link, redirect, useLoaderData } from "react-router";
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
 * still waiting (the page looks again by itself), or not paid.
 */

/** How often a waiting page looks again, in seconds. */
const RECHECK_SECONDS = 5;

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
  return { outcome, paidUntil: billing?.paidUntil ?? null };
}

export default function SubscriptionReturn() {
  const { t } = useT();
  const locale = useLocale();
  const { outcome, paidUntil } = useLoaderData<typeof loader>();

  if (outcome === "paid") {
    return (
      <AuthPage title={t("checkout.paidTitle")}>
        <div className="signed-in" role="status">
          <CheckCircleIcon className="signed-in-check" />
          <p>
            {paidUntil
              ? t("checkout.paid", { date: day(paidUntil, locale) })
              : t("checkout.paidNoDate")}
          </p>
        </div>
        <p className="auth-links">
          <Link to="/settings#subscription">{t("checkout.toSettings")}</Link>
        </p>
      </AuthPage>
    );
  }
  if (outcome === "waiting") {
    return (
      <AuthPage title={t("checkout.waitingTitle")}>
        <meta httpEquiv="refresh" content={String(RECHECK_SECONDS)} />
        <p className="form-notice" role="status">
          {t("checkout.waiting")}
        </p>
        <p className="auth-links">
          <Link to="/settings#subscription">{t("checkout.toSettings")}</Link>
        </p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={t("checkout.failedTitle")}>
      <p className="inline-error" role="alert">
        {outcome === "failed" ? t("checkout.failed") : t("checkout.unknown")}
      </p>
      <p className="auth-links">
        <Link to="/settings#subscription">{t("checkout.toSettings")}</Link>
      </p>
    </AuthPage>
  );
}
