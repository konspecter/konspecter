import { callApi } from "./api.server";
import type { FormError } from "./auth-form";
import { readPreferences } from "./preferences.server";
import { isProviderId, type ProviderId } from "./providers";

/** The sign-in providers the server offers in the visitor's language; none when it cannot say. */
export async function loginProviders(request: Request): Promise<ProviderId[]> {
  const locale = readPreferences(request).locale;
  const result = await callApi<{ providers?: unknown }>(
    request,
    `/api/auth/providers?locale=${locale}`,
  );
  const list = result.data?.providers;
  return Array.isArray(list) ? list.filter(isProviderId) : [];
}

/** Errors the API's provider sign-in sends the visitor back with (/login?error=…). */
const RETURNED_ERRORS = new Set([
  "oauth_failed",
  "oauth_cancelled",
  "provider_unavailable",
  "identity_expired",
  "registration_closed",
  "rate_limited",
  "internal",
]);

/** Minutes until sign-ins work again after too many failures (the API's window). */
const RATE_LIMIT_MINUTES = 15;

export function returnedError(request: Request): FormError | null {
  const code = new URL(request.url).searchParams.get("error");
  if (code === null || !RETURNED_ERRORS.has(code)) return null;
  return code === "rate_limited" ? { code, minutes: RATE_LIMIT_MINUTES } : { code };
}
