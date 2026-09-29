import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { t } from "../i18n/i18n";

export function NotFoundPage() {
  return (
    <>
      <title>{t("app.title", { title: t("note.pageNotFound") })}</title>
      <EmptyState title={t("note.pageNotFound")}>
        <p>
          <Link to="/">{t("note.backToNotes")}</Link>
        </p>
      </EmptyState>
    </>
  );
}
