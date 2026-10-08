import { useState } from "react";
import type { FactoryReset } from "../app/factory-reset";
import { useErrorMessage } from "../hooks/use-error-message";
import { t, tn } from "../i18n/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Returns the app to how it was when installed. Asks first, naming how many
 * conspects of the app library go with it; files outside the app stay.
 */
export function FactoryResetSettings({ reset }: { reset: FactoryReset }) {
  /** How many conspects the question is about, while it is asked. */
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const failureText = useErrorMessage(failure);

  function fail(error: unknown) {
    setFailure(error);
    setBusy(false);
    setResetting(false);
  }

  return (
    <section className="setting-block" aria-labelledby="factory-reset">
      <h3 id="factory-reset" className="setting-heading">
        {t("reset.title")}
      </h3>
      <p className="setting-hint">{t("reset.hint")}</p>
      <div className="actions">
        <button
          type="button"
          className="button button-danger"
          disabled={busy}
          onClick={() => {
            setFailure(null);
            setBusy(true);
            reset.appNotes().then((count) => {
              setAsking(count);
              setBusy(false);
            }, fail);
          }}
        >
          {t("reset.start")}
        </button>
      </div>
      {asking !== null && (
        <ConfirmDialog
          title={t("reset.confirmTitle")}
          message={asking === 0 ? t("reset.confirmEmpty") : tn("reset.confirm", asking)}
          confirmLabel={t("reset.confirmButton")}
          danger
          onConfirm={() => {
            setAsking(null);
            setBusy(true);
            setResetting(true);
            reset.run().catch(fail);
          }}
          onCancel={() => {
            setAsking(null);
          }}
        />
      )}
      {resetting && (
        <p role="status" className="setting-hint">
          {t("reset.resetting")}
        </p>
      )}
      {failureText !== null && (
        <p role="alert" className="inline-error">
          {failureText}
        </p>
      )}
    </section>
  );
}
