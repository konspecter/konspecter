import { redirect } from "react-router";
import { accountContext } from "../account.server";
import { callApi } from "../api.server";
import { siteConfig } from "../config.server";
import { isLocale, isTheme, preferenceCookie, safeReturnPath } from "../preferences.server";
import type { Route } from "./+types/preferences";

/**
 * The language and theme switches, and the cookie notice's OK, post here
 * (plain forms, so they work without JavaScript). The choice goes into a
 * cookie and the visitor goes back to the page they were on. A signed-in
 * visitor's language also becomes the language of the account's emails.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const secure = siteConfig().publicOrigin?.startsWith("https:") ?? false;
  const headers = new Headers();
  const lang = form.get("lang");
  const theme = form.get("theme");
  if (isLocale(lang)) {
    headers.append("Set-Cookie", preferenceCookie("lang", lang, secure));
    if (context.get(accountContext).user) {
      // Best effort: the page changes language either way.
      await callApi(request, "/api/account", { method: "PATCH", body: { locale: lang } });
    }
  }
  if (isTheme(theme)) headers.append("Set-Cookie", preferenceCookie("theme", theme, secure));
  if (form.get("cookies") === "ok") {
    headers.append("Set-Cookie", preferenceCookie("cookies", "ok", secure));
  }
  return redirect(safeReturnPath(form.get("back")), { headers });
}

// A GET (someone opening /preferences) has nothing to show.
export function loader() {
  return redirect("/");
}
