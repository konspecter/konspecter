import { useId, type ReactNode, type Ref } from "react";
import { useNavigation } from "react-router";
import { useT, type SiteTranslator } from "./i18n/i18n";

/**
 * Pieces of the sign-in pages: a narrow page, labelled fields and a submit
 * button that shows it is working. Forms are plain posts to the route's
 * action, so they work before JavaScript loads.
 */

/** A text field of a posted form; "" when it is missing (or, oddly, a file). */
export function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** An API error as an action returns it to the page. */
export interface FormError {
  readonly code: string;
  /** For rate_limited: how long to wait. */
  readonly minutes?: number;
}

const KNOWN = new Set([
  "invalid_credentials",
  "invalid_email",
  "weak_password",
  "password_required",
  "invalid_code",
  "registration_closed",
  "invalid_token",
  "not_configured",
  "oauth_failed",
  "oauth_cancelled",
  "provider_unavailable",
  "identity_expired",
]);

export function errorText(t: SiteTranslator["t"], error: FormError): string {
  if (error.code === "rate_limited") {
    return t("authError.rate_limited", { minutes: Math.max(1, error.minutes ?? 1) });
  }
  if (error.code === "mail_unavailable" || error.code === "mail_failed") return t("authError.mail");
  if (KNOWN.has(error.code)) return t(`authError.${error.code}` as Parameters<typeof t>[0]);
  return t("authError.unknown");
}

/** The error as the page shows it; turns the API's Retry-After seconds into minutes. */
export function formError(code: string, retryAfter: number | null = null): FormError {
  return retryAfter === null ? { code } : { code, minutes: Math.ceil(retryAfter / 60) };
}

export function AuthPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="auth site-frame" aria-labelledby="auth-title">
      <title>{`${title} · Konspecter`}</title>
      <h1 id="auth-title">{title}</h1>
      {lead && <p className="auth-lead">{lead}</p>}
      {children}
    </section>
  );
}

export function FormMessage({
  error,
  notice,
}: {
  error?: FormError | null;
  notice?: string | null;
}) {
  const { t } = useT();
  if (error) {
    return (
      <p className="inline-error" role="alert">
        {errorText(t, error)}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="form-notice" role="status">
        {notice}
      </p>
    );
  }
  return null;
}

export function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...(hint ? { "aria-describedby": hintId } : {})} {...input} />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A submit button that says "One moment…" while its own form is being sent. */
export function Submit({
  children,
  intent,
  primary = true,
  formNoValidate,
  ref,
}: {
  children: string;
  intent?: string;
  primary?: boolean;
  formNoValidate?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useT();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" &&
    (intent === undefined || navigation.formData?.get("intent") === intent);
  return (
    <button
      ref={ref}
      type="submit"
      className={primary ? "button button-primary" : "button"}
      disabled={navigation.state === "submitting"}
      {...(intent ? { name: "intent", value: intent } : {})}
      {...(formNoValidate ? { formNoValidate: true } : {})}
    >
      {busy ? t("auth.working") : children}
    </button>
  );
}
