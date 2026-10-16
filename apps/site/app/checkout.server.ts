import { callApi, type ApiResult } from "./api.server";
import { textField } from "./auth-form";
import { readPreferences } from "./preferences.server";

/**
 * Starts paying for sync from a form's chosen `plan` ("gateway:period") and
 * consent (`accept`): the gateway's page to pay on, or null with the API's
 * answer when there is none.
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
    },
  });
  const url = result.data?.redirect_url;
  return {
    url: !result.error && typeof url === "string" && /^https:\/\//.test(url) ? url : null,
    result,
  };
}
