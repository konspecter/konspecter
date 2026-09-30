import { useErrorMessage } from "../hooks/use-error-message";
import { t } from "../i18n/i18n";

type ErrorStateProps = {
  title: string;
  error: unknown;
  onRetry?: () => void;
};

export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  const message = useErrorMessage(error);
  return (
    <section role="alert" className="error-state">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t("app.tryAgain")}
        </button>
      )}
    </section>
  );
}
