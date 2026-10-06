import { callApi } from "./api.server";
import { siteConfig } from "./config.server";
import { readPreferences } from "./preferences.server";
import { parsePlans } from "./subscription";

/** What the terms and the privacy policy show: the operator, the site and the prices. */
export async function loadLegal(request: Request) {
  const { locale } = readPreferences(request);
  const { operator, publicOrigin } = siteConfig();
  const plans = await callApi(request, `/api/billing/plans?locale=${locale}`);
  return {
    operator,
    host: new URL(publicOrigin ?? request.url).host,
    plans: parsePlans(plans.data),
  };
}
