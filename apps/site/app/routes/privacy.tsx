import { useLoaderData } from "react-router";
import { LegalPage, privacy, updatedText } from "../legal";
import { loadLegal } from "../legal.server";
import { useLocale, useT } from "../i18n/i18n";
import type { Route } from "./+types/privacy";

/** The privacy policy, the cookies included (#cookies). */
export function loader({ request }: Route.LoaderArgs) {
  return loadLegal(request);
}

export default function Privacy() {
  const t = useT();
  const locale = useLocale();
  const { operator, host, plans } = useLoaderData<typeof loader>();
  const context = { locale, t, operator, host, plans };
  return <LegalPage document={privacy(context)} updated={updatedText(context)} />;
}
