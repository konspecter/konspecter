import { callApi } from "./api.server";
import { siteConfig } from "./config.server";
import { readPreferences } from "./preferences.server";
import { parsePlans } from "./subscription";

/**
 * What the terms and the privacy policy show: the operator, the site, the
 * prices, and how much each account may store (as the server enforces it).
 */
export async function loadLegal(request: Request) {
  const { locale } = readPreferences(request);
  const { operators, publicOrigin } = siteConfig();
  const [plans, quota] = await Promise.all([
    callApi(request, `/api/billing/plans?locale=${locale}`),
    callApi(request, "/api/quota"),
  ]);
  return {
    operator: operators[locale],
    host: new URL(publicOrigin ?? request.url).host,
    plans: parsePlans(plans.data),
    quota: parseQuota(quota.data),
  };
}

/** The server's storage quota in bytes, or null if it did not say. */
export function parseQuota(data: unknown): number | null {
  const quota = (data as { quota?: unknown } | null)?.quota;
  return typeof quota === "number" && Number.isSafeInteger(quota) && quota > 0 ? quota : null;
}
