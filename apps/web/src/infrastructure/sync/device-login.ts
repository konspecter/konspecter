import {
  authorizeDevice,
  NetworkError,
  pollDeviceToken,
  type DeviceAuthorization,
  type DeviceDescription,
} from "../http/api-client";

/** Signing in through the browser ended without a token: the owner denied it, or it ran out. */
export class DeviceLoginError extends Error {
  override readonly name = "DeviceLoginError";
  constructor(readonly reason: "denied" | "expired") {
    super(reason === "denied" ? "The request to connect was denied" : "The code expired");
  }
}

/** RFC 8628: after "slow_down", wait this much longer between polls. */
const SLOW_DOWN_MS = 5_000;

export type DeviceLoginOptions = {
  fetch?: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;
  /** Waits; rejects when the sign-in is cancelled. */
  sleep: (ms: number) => Promise<void>;
  /** Called once with the codes: show the user code and open the approval page. */
  onCode: (authorization: DeviceAuthorization) => void;
};

/**
 * Signs this app in through the browser: asks the server for a pair of
 * codes, lets the owner approve the user code on the site, and polls until
 * the server hands over the device's token. Throws DeviceLoginError when
 * the owner denies it or the code expires; a lost connection meanwhile only
 * delays the next poll.
 */
export async function deviceLogin(
  serverUrl: string,
  device: DeviceDescription,
  options: DeviceLoginOptions,
): Promise<string> {
  const authorization = await authorizeDevice(serverUrl, device, options.fetch);
  options.onCode(authorization);
  let interval = authorization.intervalSeconds * 1000;
  for (;;) {
    await options.sleep(interval);
    let poll;
    try {
      poll = await pollDeviceToken(serverUrl, authorization.deviceCode, options.fetch);
    } catch (error) {
      if (error instanceof NetworkError) continue;
      throw error;
    }
    switch (poll.status) {
      case "approved":
        return poll.token;
      case "pending":
        break;
      case "slow_down":
        interval += SLOW_DOWN_MS;
        break;
      case "denied":
      case "expired":
        throw new DeviceLoginError(poll.status);
    }
  }
}

/** The build's version, from package.json (vite.config.ts). */
const VERSION = __KONSPECTER_VERSION__;

/** The server the build suggests (VITE_KONSPECTER_SERVER_URL), or "". */
export function defaultServerUrl(): string {
  return import.meta.env.VITE_KONSPECTER_SERVER_URL ?? "";
}

/**
 * The server to suggest: the one the web app's host names in `/config.json`
 * (its image writes it there when it starts, ADR-023), else the build's.
 * The desktop and mobile apps have no host to ask. Offline, or with no such
 * file (the dev server answers with `index.html`), the build's.
 */
export async function suggestedServerUrl(options: {
  native: boolean;
  fetch?: ((input: string) => Promise<Response>) | undefined;
}): Promise<string> {
  if (options.native) return defaultServerUrl();
  try {
    const response = await (options.fetch ?? fetch)("/config.json");
    if (response.ok) {
      const serverUrl = configServerUrl(await response.json());
      if (serverUrl) return serverUrl;
    }
  } catch {
    // Offline, or not JSON: the build's suggestion stands.
  }
  return defaultServerUrl();
}

function configServerUrl(config: unknown): string | null {
  if (typeof config !== "object" || config === null || !("serverUrl" in config)) return null;
  const { serverUrl } = config;
  if (typeof serverUrl !== "string" || !URL.canParse(serverUrl)) return null;
  const url = new URL(serverUrl);
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
}

/**
 * How this app introduces itself to the server: a name its owner recognises
 * in the site's device list ("Firefox on Linux", "Konspecter for macOS"),
 * the platform and the version.
 */
export function describeDevice(where: {
  desktopOs?: string | null;
  mobile?: boolean;
  userAgent: string;
}): DeviceDescription {
  if (where.desktopOs) {
    const platform = DESKTOP_PLATFORMS[where.desktopOs] ?? "other";
    const os = OS_NAMES[platform] ?? where.desktopOs;
    return { name: `Konspecter for ${os}`, platform, clientVersion: VERSION };
  }
  if (where.mobile) {
    return { name: "Konspecter for Android", platform: "android", clientVersion: VERSION };
  }
  const browser = browserName(where.userAgent);
  const os = osName(where.userAgent);
  return {
    name: os ? `${browser} on ${os}` : browser,
    platform: "web",
    clientVersion: VERSION,
  };
}

/** Tauri's OS names (`std::env::consts::OS`) as the server's platforms. */
const DESKTOP_PLATFORMS: Record<string, string> = {
  macos: "macos",
  windows: "windows",
  linux: "linux",
};

const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
}

function osName(userAgent: string): string | null {
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone|iPad/.test(userAgent)) return "iOS";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}
