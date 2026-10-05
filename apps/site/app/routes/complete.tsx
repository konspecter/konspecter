import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { nextPath, redirectIfSignedIn } from "../account.server";
import { callApi, withCookies } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { pendingCookie } from "../pending.server";
import { readPreferences } from "../preferences.server";
import { isProviderId } from "../providers";
import type { Route } from "./+types/complete";

/**
 * The provider signed the visitor in but vouched for no email address: they
 * enter one and prove it with a code, which also links the provider's
 * account to theirs. The API keeps the provider's side (a cookie of its own).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  const result = await callApi<{ provider?: unknown; email?: unknown }>(
    request,
    "/api/auth/complete",
  );
  const provider = result.data?.provider;
  if (!isProviderId(provider)) {
    const code = result.error?.code === "identity_expired" ? "identity_expired" : "internal";
    throw redirect(`/login?error=${code}`);
  }
  // The provider's unconfirmed address, as a suggestion.
  const suggested = typeof result.data?.email === "string" ? result.data.email : "";
  return { provider, suggested };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = textField(form, "email").trim();
  const result = await callApi(request, "/api/auth/complete", {
    method: "POST",
    body: { email, locale: readPreferences(request).locale },
  });
  if (result.error) {
    if (result.error.code === "identity_expired") throw redirect("/login?error=identity_expired");
    return data({ email, error: formError(result.error.code, result.retryAfter) }, result.status);
  }
  return redirect(`/login/code?next=${encodeURIComponent(nextPath(request))}`, {
    headers: withCookies([], [pendingCookie({ mode: "complete", email })]),
  });
}

export default function Complete() {
  const { t } = useT();
  const { provider, suggested } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <AuthPage
      title={t("complete.title")}
      lead={t("complete.lead", { provider: t(`providerName.${provider}`) })}
    >
      <Form method="post" className="form">
        <Field
          label={t("auth.email")}
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          defaultValue={result?.email ?? suggested}
        />
        <FormMessage error={result?.error ?? null} />
        <div className="actions">
          <Submit>{t("complete.submit")}</Submit>
        </div>
      </Form>
      <p className="auth-links">
        <Link to="/login">{t("complete.cancel")}</Link>
      </p>
    </AuthPage>
  );
}
