import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import { t, tn } from "../i18n/i18n";

/**
 * A quiet header hint when sync needs attention: failing or held back. No
 * connection shows only on the antenna (crossed out).
 */
export function SyncIndicator({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const text =
    status.blocked > 0
      ? tn("syncHint.blocked", status.blocked)
      : status.state === "error"
        ? t("syncHint.failed")
        : null;
  if (!text) return null;
  return (
    <Link to="/settings" className="sync-indicator" aria-label={t("syncHint.label", { text })}>
      {text}
    </Link>
  );
}
