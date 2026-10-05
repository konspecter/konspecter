import { richText } from "@konspecter/i18n/rich";
import { data, Form, Link, redirect, useActionData } from "react-router";
import { redirectIfSignedIn } from "../account.server";
import { callApi, withCookies } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { pendingCookie } from "../pending.server";
import { readPreferences } from "../preferences.server";
import type { Route } from "./+types/register";

export function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  return null;
}

/** Asks for a code to the address; entering it creates the account with this password. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = textField(form, "email").trim();
  const password = textField(form, "password");
  const result = await callApi(request, "/api/auth/code", {
    method: "POST",
    body: { email, password, locale: readPreferences(request).locale },
  });
  if (result.error) {
    return data({ email, error: formError(result.error.code, result.retryAfter) }, result.status);
  }
  return redirect("/login/code", {
    headers: withCookies([], [pendingCookie({ mode: "register", email })]),
  });
}

export default function Register() {
  const { t } = useT();
  const result = useActionData<typeof action>();
  return (
    <AuthPage title={t("register.title")} lead={t("register.lead")}>
      <Form method="post" className="form">
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
          hint={t("auth.passwordHint")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FormMessage error={result?.error ?? null} />
        <div className="actions">
          <Submit>{t("register.submit")}</Submit>
        </div>
      </Form>
      <p className="auth-links">
        {richText(t("register.noPassword"), {
          link: <Link to="/login">{t("register.codeLink")}</Link>,
        })}
      </p>
      <p className="auth-links">
        {t("register.haveAccount")} <Link to="/login">{t("register.signIn")}</Link>
      </p>
    </AuthPage>
  );
}
