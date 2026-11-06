import { CloseIcon } from "@konspecter/ui/icons";
import type { ReactNode } from "react";
import { t } from "../i18n/i18n";

/** A notice under the top bar: what it says and what to do, then a button that closes it. */
export function Banner({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div role="status" className="update-banner">
      {children}
      <button
        type="button"
        className="icon-button"
        aria-label={t("app.close")}
        title={t("app.close")}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
