import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import { t, tn } from "../i18n/i18n";

/**
 * A quiet header hint when sync needs attention: failing, held back,
 * stopped because the server disconnected this device, locked until the
 * passphrase is entered, or paused until it is paid. No connection shows
 * only on the antenna (crossed out).
 */
export function SyncIndicator({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const text =
    status.blocked > 0
      ? tn("syncHint.blocked", status.blocked)
      : status.state === "error"
        ? t("syncHint.failed")
        : status.state === "disconnected"
          ? t("syncHint.disconnected")
          : status.state === "locked"
            ? t("syncHint.locked")
            : status.state === "unpaid"
              ? t("syncHint.unpaid")
              : null;
  if (!text) return null;
  return (
    <Link to="/settings" className="sync-indicator" aria-label={t("syncHint.label", { text })}>
      {text}
    </Link>
  );
}
