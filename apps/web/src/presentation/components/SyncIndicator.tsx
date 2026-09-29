import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { SyncEngine } from "../../infrastructure/sync/sync-engine";

/** A quiet header hint when sync needs attention: offline, failing or held back. */
export function SyncIndicator({ sync }: { sync: SyncEngine }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus);
  const text =
    status.blocked > 0
      ? `${String(status.blocked)} not synced`
      : status.state === "offline"
        ? "Offline"
        : status.state === "error"
          ? "Sync failed"
          : null;
  if (!text) return null;
  return (
    <Link to="/settings" className="sync-indicator" aria-label={`Sync: ${text}`}>
      {text}
    </Link>
  );
}
