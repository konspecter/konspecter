import { redirect } from "react-router";
import { callApi, withCookies } from "../api.server";
import { textField } from "../auth-form";
import { safeReturnPath } from "../preferences.server";
import type { Route } from "./+types/logout";

/**
 * Sign out: the API ends the session and clears its cookie. `next` (a path
 * on the site) is where to go then, e.g. back to sign in again.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const result = await callApi(request, "/api/auth/logout", { method: "POST" });
  return redirect(safeReturnPath(textField(form, "next") || "/"), {
    headers: withCookies(result.cookies),
  });
}

export function loader() {
  return redirect("/");
}
