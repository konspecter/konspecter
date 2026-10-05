import { redirect } from "react-router";
import { siteConfig } from "../config.server";
import { isLocale, isTheme, preferenceCookie, safeReturnPath } from "../preferences.server";
import type { Route } from "./+types/preferences";

/**
 * The language and theme switches post here (plain forms, so they work
 * without JavaScript). The choice goes into a cookie and the visitor goes
 * back to the page they were on.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const secure = siteConfig().publicOrigin?.startsWith("https:") ?? false;
  const headers = new Headers();
  const lang = form.get("lang");
  const theme = form.get("theme");
  if (isLocale(lang)) headers.append("Set-Cookie", preferenceCookie("lang", lang, secure));
  if (isTheme(theme)) headers.append("Set-Cookie", preferenceCookie("theme", theme, secure));
  return redirect(safeReturnPath(form.get("back")), { headers });
}

// A GET (someone opening /preferences) has nothing to show.
export function loader() {
  return redirect("/");
}
