/**
 * Devices as the settings and activation pages show them: an app connected
 * to the account, or one waiting to be.
 */

/** What an app says about itself. */
export interface DeviceClient {
  readonly name: string;
  readonly platform: Platform;
  readonly clientVersion: string;
}

/** A connected app. Times are ISO 8601. */
export interface Device extends DeviceClient {
  readonly id: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly lastSyncAt: string | null;
}

export const PLATFORMS = ["web", "macos", "windows", "linux", "android", "ios", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function time(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function platform(value: unknown): Platform {
  return PLATFORMS.find((p) => p === value) ?? "other";
}

/** The API's description of a waiting app (`{name, platform, client_version}`), or null. */
export function parseClient(value: unknown): DeviceClient | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return {
    name: value.name,
    platform: platform(value.platform),
    clientVersion: text(value.client_version),
  };
}

/** The API's device list; malformed entries are left out. */
export function parseDevices(value: unknown): Device[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) return [];
  const devices: Device[] = [];
  for (const entry of value.devices as unknown[]) {
    const client = parseClient(entry);
    if (!client || !isRecord(entry) || typeof entry.id !== "string") continue;
    const createdAt = time(entry.created_at);
    if (!createdAt) continue;
    devices.push({
      ...client,
      id: entry.id,
      createdAt,
      lastUsedAt: time(entry.last_used_at),
      lastSyncAt: time(entry.last_sync_at),
    });
  }
  return devices;
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * How long ago `iso` was, from `now`, in words of the locale ("5 minutes
 * ago"); under a minute is "now". `now` comes from the server's render so
 * the browser shows the same words.
 */
export function timeAgo(iso: string, now: number, locale: string): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }
  return format.format(0, "second");
}
