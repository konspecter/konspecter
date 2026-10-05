import { redirect } from "react-router";
import { callApi, withCookies } from "../api.server";
import type { Route } from "./+types/logout";

/** Sign out: the API ends the session and clears its cookie. */
export async function action({ request }: Route.ActionArgs) {
  const result = await callApi(request, "/api/auth/logout", { method: "POST" });
  return redirect("/", { headers: withCookies(result.cookies) });
}

export function loader() {
  return redirect("/");
}
