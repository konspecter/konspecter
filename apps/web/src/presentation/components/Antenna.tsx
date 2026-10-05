import { useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import type { Activity } from "../app/activity";
import { AntennaIcon, AntennaOffIcon } from "@konspecter/ui/icons";
import { t } from "../i18n/i18n";

const noSync = () => () => undefined;
const noStatus = (): SyncStatus | null => null;

/**
 * The only activity indicator: a small antenna, light gray while idle, darker
 * and transmitting while notes are being saved or synced, and crossed out in
 * orange while sync is set up but there is no connection (notes keep saving
 * on this device and sync once it is back). It never blocks or announces
 * anything; the app works the same whatever it shows.
 */
export function Antenna({ activity, sync }: { activity: Activity; sync?: SyncEngine | undefined }) {
  const busy = useSyncExternalStore(activity.subscribe, activity.getSnapshot);
  const status = useSyncExternalStore(sync?.subscribe ?? noSync, sync?.getStatus ?? noStatus);
  const state =
    status?.state === "offline"
      ? "offline"
      : busy || status?.state === "syncing"
        ? "active"
        : "idle";
  const label = t(`antenna.${state}`);
  return (
    <span
      className="antenna"
      data-state={state}
      data-active={state === "active"}
      role="img"
      aria-label={label}
      title={label}
    >
      {state === "offline" ? <AntennaOffIcon /> : <AntennaIcon />}
    </span>
  );
}
