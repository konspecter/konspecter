import { callApi, type ApiResult } from "./api.server";
import { textField } from "./auth-form";
import { readPreferences } from "./preferences.server";

/**
 * Starts paying for sync from a form's chosen `plan` ("gateway:period"),
 * consent (`accept`) and `auto_renew` (unticked: one period, which never
 * renews): the gateway's page to pay on, or null with the API's answer when
 * there is none.
 */
export async function startCheckout(
  request: Request,
  form: FormData,
): Promise<{ url: string | null; result: ApiResult<{ redirect_url?: unknown }> }> {
  const [gateway = "", period = ""] = textField(form, "plan").split(":");
  const result = await callApi<{ redirect_url?: unknown }>(request, "/api/subscription", {
    method: "POST",
    body: {
      gateway,
      period,
      locale: readPreferences(request).locale,
      accept: textField(form, "accept") === "yes",
      auto_renew: textField(form, "auto_renew") === "yes",
    },
  });
  const url = result.data?.redirect_url;
  return {
    url: !result.error && typeof url === "string" && /^https:\/\//.test(url) ? url : null,
    result,
  };
}

/**
 * Starts the account's free trial, as an app's first sync would. An account
 * that has had its trial, or has time, is left as it is.
 */
export function startTrial(request: Request): Promise<ApiResult<unknown>> {
  return callApi(request, "/api/subscription/trial", { method: "POST" });
}
