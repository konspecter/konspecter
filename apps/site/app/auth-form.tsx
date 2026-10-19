import { CloseIcon } from "@konspecter/ui/icons";
import { PasswordInput } from "@konspecter/ui/password-input";
import { useId, type ReactNode, type Ref } from "react";
import { Link, useNavigation } from "react-router";
import { useT, type SiteTranslator } from "./i18n/i18n";

/**
 * Pieces of the sign-in pages: a card on the page, the email form beside
 * the other services, labelled fields and a submit button that shows it is
 * working. Forms are plain posts to the route's action, so they work before
 * JavaScript loads.
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
  "invalid_name",
  "email_mismatch",
  "reauthentication_required",
  "invalid_user_code",
  "consent_required",
  "already_subscribed",
  "gateway_failed",
  "unknown_price",
  "unknown_gateway",
  "not_subscribed",
  "not_resumable",
  "billing_off",
  "sync_unavailable",
  "billing_unavailable",
  "subscription_required",
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

/**
 * A sign-in page: its title, lead and form on a card. `wide` makes room for
 * two columns; `close` puts a cross in the card's corner that leaves for it.
 */
export function AuthPage({
  title,
  lead,
  wide = false,
  close,
  children,
}: {
  title: string;
  lead?: ReactNode;
  wide?: boolean;
  close?: { readonly to: string; readonly label: string };
  children: ReactNode;
}) {
  return (
    <section
      className={wide ? "auth auth-wide site-frame" : "auth site-frame"}
      aria-labelledby="auth-title"
    >
      <title>{`${title} · Konspecter`}</title>
      <div className={close ? "auth-card auth-closable" : "auth-card"}>
        {close && (
          <Link to={close.to} className="icon-button auth-close" aria-label={close.label}>
            <CloseIcon />
          </Link>
        )}
        <h1 id="auth-title">{title}</h1>
        {lead && <p className="auth-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/**
 * The two ways in: the email form (children) and, when the server offers
 * any, the other services. Side by side on wide screens, the services on
 * the right; on narrow ones the services come first, as in the markup.
 */
export function AuthWays({ others, children }: { others: ReactNode; children: ReactNode }) {
  const { t } = useT();
  if (!others) return children;
  return (
    <div className="auth-ways">
      <div className="auth-others">{others}</div>
      <p className="auth-or">
        <span className="auth-or-long">{t("providers.or")}</span>
        <span className="auth-or-short">{t("providers.orShort")}</span>
      </p>
      <div className="auth-email-way">{children}</div>
    </div>
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
  const { t } = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const described = hint ? { "aria-describedby": hintId } : {};
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input.type === "password" ? (
        <PasswordInput id={id} showLabel={t("auth.showPassword")} {...described} {...input} />
      ) : (
        <input id={id} {...described} {...input} />
      )}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A submit button that says "One moment…" while its own form is being sent;
 * `disabled` holds it back until the form may be sent.
 */
export function Submit({
  children,
  intent,
  primary = true,
  formNoValidate,
  disabled = false,
  ref,
}: {
  children: string;
  intent?: string;
  primary?: boolean;
  formNoValidate?: boolean;
  disabled?: boolean;
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
      disabled={disabled || navigation.state === "submitting"}
      {...(intent ? { name: "intent", value: intent } : {})}
      {...(formNoValidate ? { formNoValidate: true } : {})}
    >
      {busy ? t("auth.working") : children}
    </button>
  );
}
