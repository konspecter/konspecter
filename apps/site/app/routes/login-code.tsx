import { richText } from "@konspecter/i18n/rich";
import { useRef, type ClipboardEvent, type InputEvent } from "react";
import { data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import { nextPath, redirectIfSignedIn } from "../account.server";
import { callApi, withCookies } from "../api.server";
import { AuthPage, Field, FormMessage, formError, Submit, textField } from "../auth-form";
import { useT } from "../i18n/i18n";
import { clearPendingCookie, readPending } from "../pending.server";
import { readPreferences } from "../preferences.server";
import type { Route } from "./+types/login-code";

export function loader({ request, context }: Route.LoaderArgs) {
  redirectIfSignedIn(request, context);
  const pending = readPending(request);
  if (!pending) throw redirect("/login");
  return pending;
}

export async function action({ request }: Route.ActionArgs) {
  const pending = readPending(request);
  if (!pending) throw redirect("/login");
  const form = await request.formData();

  if (form.get("intent") === "resend") {
    // Finishing a provider sign-in, the new code must carry it along too.
    const path = pending.mode === "complete" ? "/api/auth/complete" : "/api/auth/code";
    const result = await callApi(request, path, {
      method: "POST",
      body: { email: pending.email, locale: readPreferences(request).locale },
    });
    if (result.error)
      return data(
        { error: formError(result.error.code, result.retryAfter), resent: false },
        result.status,
      );
    return { error: null, resent: true };
  }

  const result = await callApi(request, "/api/auth/code/verify", {
    method: "POST",
    body: { email: pending.email, code: textField(form, "code") },
  });
  if (result.error) {
    return data(
      { error: formError(result.error.code, result.retryAfter), resent: false },
      result.status,
    );
  }
  return redirect(nextPath(request), {
    headers: withCookies(result.cookies, [clearPendingCookie()]),
  });
}

/** Digits in an email code (accounts.CodeLength on the server). */
const CODE_LENGTH = 6;

/** Inputs that put a whole value in at once: a drop or an autofill. */
const WHOLE_INPUTS = new Set(["insertFromDrop", "insertReplacementText", ""]);

/** The code in text that holds a whole one, with the spaces and dashes people copy; else null. */
function wholeCode(text: string): string | null {
  const digits = text.replace(/[\s\u200b-\u200d-]/g, "");
  return digits.length === CODE_LENGTH && /^[0-9]+$/.test(digits) ? digits : null;
}

export default function LoginCode() {
  const { t } = useT();
  const pending = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const register = pending.mode === "register";
  const complete = pending.mode === "complete";
  const verify = useRef<HTMLButtonElement>(null);

  // A pasted or autofilled code is sent at once; typed digits wait for Continue.
  function send(input: HTMLInputElement, code: string) {
    input.value = code;
    input.form?.requestSubmit(verify.current);
  }

  // Pastes are read from the clipboard: copied from the email they carry the
  // line's indent, and the field's length limit would cut the code short.
  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const code = wholeCode(event.clipboardData.getData("text"));
    if (code === null) return;
    event.preventDefault();
    send(event.currentTarget, code);
  }

  function autofillCode(event: InputEvent<HTMLInputElement>) {
    // Some browsers autofill with a plain Event: no inputType at all.
    const inputType = (event.nativeEvent.inputType as string | undefined) ?? "";
    if (!WHOLE_INPUTS.has(inputType)) return;
    const code = wholeCode(event.currentTarget.value);
    if (code !== null) send(event.currentTarget, code);
  }

  return (
    <AuthPage
      title={t("code.title")}
      lead={richText(
        t(register ? "code.leadRegister" : complete ? "code.leadComplete" : "code.lead"),
        {
          email: <strong className="auth-email">{pending.email}</strong>,
        },
      )}
    >
      <Form method="post" className="form">
        <Field
          label={t("code.label")}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 \-]*"
          maxLength={9}
          required
          autoFocus
          className="code-input"
          onPaste={pasteCode}
          onInput={autofillCode}
        />
        <FormMessage
          error={result?.error ?? null}
          notice={result?.resent ? t("code.resent") : null}
        />
        <div className="actions">
          <Submit intent="verify" ref={verify}>
            {t("code.submit")}
          </Submit>
          {/* A new code without the password would drop it: sign-ups start over instead. */}
          {!register && (
            <Submit intent="resend" primary={false} formNoValidate>
              {t("code.resend")}
            </Submit>
          )}
        </div>
      </Form>
      <p className="auth-links">
        <Link to={register ? "/register" : complete ? "/complete" : "/login"}>
          {register ? t("code.startOver") : t("code.otherEmail")}
        </Link>
      </p>
    </AuthPage>
  );
}
