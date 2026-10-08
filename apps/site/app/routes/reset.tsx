import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { callApi, withCookies } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { homePath } from "../preferences.server";
import type { Route } from "./+types/reset";

/** The link from the reset email: /reset?token=… */
export function loader({ request }: Route.LoaderArgs) {
  return { hasToken: (new URL(request.url).searchParams.get("token") ?? "") !== "" };
}

export async function action({ request }: Route.ActionArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const form = await request.formData();
  const result = await callApi(request, "/api/auth/password/reset", {
    method: "POST",
    body: { token, password: textField(form, "password") },
  });
  if (result.error)
    return data({ error: formError(result.error.code, result.retryAfter) }, result.status);
  return redirect(homePath(request), { headers: withCookies(result.cookies) });
}

export default function Reset() {
  const { t } = useT();
  const { hasToken } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (!hasToken) {
    return (
      <AuthPage title={t("reset.title")}>
        <p className="inline-error">{t("reset.missing")}</p>
        <p className="auth-links">
          <Link to="/forgot">{t("reset.requestNew")}</Link>
        </p>
      </AuthPage>
    );
  }
  const expired = result?.error.code === "invalid_token";
  return (
    <AuthPage title={t("reset.title")} lead={t("reset.lead")}>
      <Form method="post" className="form">
        <Field
          label={t("auth.newPassword")}
          hint={t("auth.passwordHint")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FormMessage error={result?.error ?? null} />
        <div className="actions">
          <Submit>{t("reset.submit")}</Submit>
        </div>
      </Form>
      {expired && (
        <p className="auth-links">
          <Link to="/forgot">{t("reset.requestNew")}</Link>
        </p>
      )}
    </AuthPage>
  );
}
