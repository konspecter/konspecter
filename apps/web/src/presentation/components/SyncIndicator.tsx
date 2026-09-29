import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";
import { t, tn } from "../i18n/i18n";

/** A quiet header hint when sync needs attention: offline, failing or held back. */
export function SyncIndicator({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const text =
    status.blocked > 0
      ? tn("syncHint.blocked", status.blocked)
      : status.state === "offline"
        ? t("syncHint.offline")
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
