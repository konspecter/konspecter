import { data, Form, Link, useActionData } from "react-router";
import { redirectIfSignedIn } from "../account.server";
import { callApi } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { readPreferences } from "../preferences.server";
import type { Route } from "./+types/forgot";

export function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = textField(form, "email").trim();
  const result = await callApi(request, "/api/auth/password/forgot", {
    method: "POST",
    body: { email, locale: readPreferences(request).locale },
  });
  if (result.error) {
    return data(
      { email, sent: false, error: formError(result.error.code, result.retryAfter) },
      result.status,
    );
  }
  return { email, sent: true, error: null };
}

export default function Forgot() {
  const { t } = useT();
  const result = useActionData<typeof action>();
  if (result?.sent) {
    return (
      <AuthPage title={t("forgot.title")}>
        <p className="form-notice" role="status">
          {t("forgot.sent", { email: result.email })}
        </p>
        <p className="auth-links">
          <Link to="/login">{t("forgot.back")}</Link>
        </p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={t("forgot.title")} lead={t("forgot.lead")}>
      <Form method="post" className="form">
        <Field
          label={t("auth.email")}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={result?.email ?? ""}
        />
        <FormMessage error={result?.error ?? null} />
        <div className="actions">
          <Submit>{t("forgot.submit")}</Submit>
        </div>
      </Form>
      <p className="auth-links">
        <Link to="/login">{t("forgot.back")}</Link>
      </p>
    </AuthPage>
  );
}
