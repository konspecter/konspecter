import { Link } from "react-router";
import { EmptyState } from "./EmptyState";
import { t } from "../i18n/i18n";

export function NoteNotFound() {
  return (
    <>
      <title>{t("app.title", { title: t("note.notFound") })}</title>
      <EmptyState title={t("note.notFound")}>
        <p>{t("note.notFoundText")}</p>
        <p>
          <Link to="/">{t("note.backToNotes")}</Link>
        </p>
      </EmptyState>
    </>
  );
}
