import { Link } from "react-router";
import { AuthPage } from "../auth-form";
import { useT } from "../i18n/i18n";
import { useLocalePath } from "../pages";

/**
 * What a phone's camera opens when it scans a connect code (settings): the
 * code is for the app's scanner. It sits in the link's fragment, so it never
 * reaches the server and this page never sees it.
 */
export default function Connect() {
  const { t } = useT();
  const localePath = useLocalePath();
  return (
    <AuthPage title={t("connect.title")} lead={t("connect.lead")}>
      <p className="auth-links">
        {t("connect.noApp")} <Link to={`${localePath("/")}#download`}>{t("connect.get")}</Link>
      </p>
    </AuthPage>
  );
}
