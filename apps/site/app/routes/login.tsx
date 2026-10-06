import { useState, type MouseEvent } from "react";
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { nextPath, redirectIfSignedIn } from "../account.server";
import { callApi, withCookies } from "../api.server";
import {
  AuthPage,
  AuthWays,
  Field,
  FormMessage,
  formError,
  Submit,
  textField,
  type FormError,
} from "../auth-form";
import { useT } from "../i18n/i18n";
import { pendingCookie } from "../pending.server";
import { readPreferences } from "../preferences.server";
import { ProviderButtons } from "../providers";
import { loginProviders, returnedError } from "../providers.server";
import type { Route } from "./+types/login";

/** A one-time code by email (the default), or the password field. */
type Mode = "code" | "password";

interface LoginResult {
  readonly email: string;
  readonly mode: Mode;
  readonly error: FormError | null;
}

/** The providers to offer, and the error a provider sign-in came back with. */
export async function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  return {
    providers: await loginProviders(request),
    next: nextPath(request),
    error: returnedError(request),
  };
}

/**
 * One form, two ways in: "Email me a code" sends a one-time code (which also
 * creates the account if there is none); "Sign in" checks the password.
 * "Use password" and "Without password" only switch the form: the page's
 * script does that by itself, and without it they post here.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = textField(form, "email").trim();
  const password = textField(form, "password");
  const next = nextPath(request);
  const intent = form.get("intent");
  const failed = (mode: Mode, error: FormError, status: number) =>
    data<LoginResult>({ email, mode, error }, status);

  if (intent === "use-password" || intent === "use-code") {
    return {
      email,
      mode: intent === "use-password" ? "password" : "code",
      error: null,
    } satisfies LoginResult;
  }

  if (intent === "code") {
    const result = await callApi(request, "/api/auth/code", {
      method: "POST",
      body: { email, locale: readPreferences(request).locale },
    });
    if (result.error)
      return failed("code", formError(result.error.code, result.retryAfter), result.status);
    return redirect(`/login/code?next=${encodeURIComponent(next)}`, {
      headers: withCookies([], [pendingCookie({ mode: "login", email })]),
    });
  }

  if (password === "") return failed("password", formError("password_required"), 400);
  const result = await callApi(request, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (result.error)
    return failed("password", formError(result.error.code, result.retryAfter), result.status);
  return redirect(next, { headers: withCookies(result.cookies) });
}

export default function Login() {
  const { t } = useT();
  const { providers, next, error } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [mode, setMode] = useState<Mode>(result?.mode ?? "code");
  // A switch the page's script handles; without it the button posts its intent.
  const switchTo = (to: Mode) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setMode(to);
  };

  return (
    <AuthPage title={t("login.title")} lead={t("login.lead")} wide={providers.length > 0}>
      {!result && error && (
        <div className="auth-returned">
          <FormMessage error={error} />
        </div>
      )}
      <AuthWays
        others={providers.length > 0 && <ProviderButtons providers={providers} next={next} />}
      >
        <Form method="post" className="form">
          <Field
            label={t("auth.email")}
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={result?.email ?? ""}
          />
          {mode === "password" ? (
            <>
              <Field
                label={t("auth.password")}
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
              />
              <FormMessage error={result?.error ?? null} />
              <div className="actions">
                <Submit intent="password">{t("login.submit")}</Submit>
                <button
                  type="submit"
                  name="intent"
                  value="use-code"
                  className="button"
                  formNoValidate
                  onClick={switchTo("code")}
                >
                  {t("login.withoutPassword")}
                </button>
              </div>
            </>
          ) : (
            <>
              <FormMessage error={result?.error ?? null} />
              <div className="actions">
                <Submit intent="code">{t("login.sendCode")}</Submit>
                <button
                  type="submit"
                  name="intent"
                  value="use-password"
                  className="button"
                  formNoValidate
                  onClick={switchTo("password")}
                >
                  {t("login.usePassword")}
                </button>
              </div>
            </>
          )}
        </Form>
        {mode === "password" && (
          <p className="auth-links">
            <Link to="/forgot">{t("login.forgot")}</Link>
          </p>
        )}
        <p className="auth-links">
          {t("login.noAccount")} <Link to="/register">{t("login.register")}</Link>
        </p>
      </AuthWays>
    </AuthPage>
  );
}
