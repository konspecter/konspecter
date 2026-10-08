import { redirect } from "react-router";
import { pageUrl } from "../pages";
import type { Route } from "./+types/ru-other";

/**
 * Any other address under /ru (konspecter.ru/login lands on /ru/login):
 * pages other than the public ones have one address, so it moves there for
 * good. An unknown one becomes a 404 at its new address.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  return redirect(`/${params["*"]}${pageUrl(request).search}`, 301);
}
