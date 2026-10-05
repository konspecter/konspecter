import { data, Form, Link, redirect, useActionData } from "react-router";
import { nextPath, redirectIfSignedIn } from "../account.server";
import { callApi, withCookies } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { pendingCookie } from "../pending.server";
import { readPreferences } from "../preferences.server";
import type { Route } from "./+types/login";

export function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  return null;
}

/**
 * One form, two ways in: "Sign in" checks the password; "Email me a code"
 * sends a one-time code (which also creates the account if there is none).
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = textField(form, "email").trim();
  const password = textField(form, "password");
  const next = nextPath(request);

  if (form.get("intent") === "code") {
    const result = await callApi(request, "/api/auth/code", {
      method: "POST",
      body: { email, locale: readPreferences(request).locale },
    });
    if (result.error) {
      return data({ email, error: formError(result.error.code, result.retryAfter) }, result.status);
    }
    return redirect(`/login/code?next=${encodeURIComponent(next)}`, {
      headers: withCookies([], [pendingCookie({ mode: "login", email })]),
    });
  }

  if (password === "") return data({ email, error: formError("password_required") }, 400);
  const result = await callApi(request, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (result.error) {
    return data({ email, error: formError(result.error.code, result.retryAfter) }, result.status);
  }
  return redirect(next, { headers: withCookies(result.cookies) });
}

export default function Login() {
  const { t } = useT();
  const result = useActionData<typeof action>();
  return (
    <AuthPage title={t("login.title")} lead={t("login.lead")}>
      <Form method="post" className="form" noValidate={false}>
        <Field
          label={t("auth.email")}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={result?.email ?? ""}
        />
        <Field
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <FormMessage error={result?.error ?? null} />
        <div className="actions">
          <Submit intent="password">{t("login.submit")}</Submit>
          <Submit intent="code" primary={false}>
            {t("login.sendCode")}
          </Submit>
        </div>
      </Form>
      <p className="auth-links">
        <Link to="/forgot">{t("login.forgot")}</Link>
      </p>
      <p className="auth-links">
        {t("login.noAccount")} <Link to="/register">{t("login.register")}</Link>
      </p>
    </AuthPage>
  );
}
