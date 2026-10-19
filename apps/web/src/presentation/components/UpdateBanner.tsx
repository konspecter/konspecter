import { useEffect, useState } from "react";
import type { Update, UpdateSource } from "../app/updates";
import { t } from "../i18n/i18n";

export function UpdateBanner({ updates }: { updates: UpdateSource }) {
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => updates.subscribe(setUpdate), [updates]);

  if (!update) return null;
  return (
    <div role="status" className="update-banner">
      <span>
        {update.kind === "download"
          ? t("app.releaseAvailable", { version: update.version })
          : t("app.updateAvailable")}
      </span>
      <button type="button" className="button" onClick={updates.apply}>
        {update.kind === "download" ? t("app.download") : t("app.reload")}
      </button>
      <button
        type="button"
        className="button"
        onClick={() => {
          setUpdate(null);
        }}
      >
        {t("app.later")}
      </button>
    </div>
  );
}
