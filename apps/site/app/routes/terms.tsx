import { useLoaderData } from "react-router";
import { LegalPage, terms, updatedText } from "../legal";
import { loadLegal } from "../legal.server";
import { useLocale, useT } from "../i18n/i18n";
import type { Route } from "./+types/terms";

/** The terms of service; where sync is paid, the public offer of the subscription. */
export function loader({ request }: Route.LoaderArgs) {
  return loadLegal(request);
}

export default function Terms() {
  const t = useT();
  const locale = useLocale();
  const { operator, host, plans } = useLoaderData<typeof loader>();
  const context = { locale, t, operator, host, plans };
  return <LegalPage document={terms(context)} updated={updatedText(context)} />;
}
