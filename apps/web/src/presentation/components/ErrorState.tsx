type ErrorStateProps = {
  title: string;
  error: unknown;
  onRetry?: () => void;
};

export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  return (
    <section role="alert" className="error-state">
      <h2>{title}</h2>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
