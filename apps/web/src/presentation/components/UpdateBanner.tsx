import { useEffect, useState } from "react";
import type { UpdateSource } from "../app/updates";
import { t } from "../i18n/i18n";

export function UpdateBanner({ updates }: { updates: UpdateSource }) {
  const [available, setAvailable] = useState(false);

  useEffect(
    () =>
      updates.subscribe(() => {
        setAvailable(true);
      }),
    [updates],
  );

  if (!available) return null;
  return (
    <div role="status" className="update-banner">
      <span>{t("app.updateAvailable")}</span>
      <button type="button" className="button" onClick={updates.apply}>
        {t("app.reload")}
      </button>
      <button
        type="button"
        className="button"
        onClick={() => {
          setAvailable(false);
        }}
      >
        {t("app.later")}
      </button>
    </div>
  );
}
