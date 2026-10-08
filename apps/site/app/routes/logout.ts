import { redirect } from "react-router";
import { callApi, withCookies } from "../api.server";
import { textField } from "../auth-form";
import { homePath, safeReturnPath } from "../preferences.server";
import type { Route } from "./+types/logout";

/**
 * Sign out: the API ends the session and clears its cookie. `next` (a path
 * on the site) is where to go then, e.g. back to sign in again.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const result = await callApi(request, "/api/auth/logout", { method: "POST" });
  const next = textField(form, "next");
  return redirect(next ? safeReturnPath(next) : homePath(request), {
    headers: withCookies(result.cookies),
  });
}

export function loader({ request }: Route.LoaderArgs) {
  return redirect(homePath(request));
}
