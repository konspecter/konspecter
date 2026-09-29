import { useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "../../infrastructure/sync/sync-engine";
import type { Activity } from "../app/activity";
import { AntennaIcon } from "./icons";

const noSync = () => () => undefined;
const noStatus = (): SyncStatus | null => null;

/**
 * The only activity indicator: a small antenna, light gray while idle, darker
 * and transmitting while notes are being saved or synced. It never blocks or
 * announces anything; the app works the same whatever it shows.
 */
export function Antenna({ activity, sync }: { activity: Activity; sync?: SyncEngine | undefined }) {
  const busy = useSyncExternalStore(activity.subscribe, activity.getSnapshot);
  const status = useSyncExternalStore(sync?.subscribe ?? noSync, sync?.getStatus ?? noStatus);
  const active = busy || status?.state === "syncing";
  const label = active ? "Saving and syncing" : "Everything is stored on this device";
  return (
    <span className="antenna" data-active={active} role="img" aria-label={label} title={label}>
      <AntennaIcon />
    </span>
  );
}
