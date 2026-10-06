/**
 * The site's settings, read at runtime from the environment and from an
 * optional .env file (KONSPECTER_ENV_FILE, default ./.env). Variables set in
 * the real environment win over the file, as for the Go server.
 */
import { PLATFORMS, type Platform } from "./platform";

export interface SiteConfig {
  /** The public origin of the site and API (KONSPECTER_PUBLIC_URL), or null when unset (development). */
  readonly publicOrigin: string | null;
  /** The Go API as the site's server reaches it (KONSPECTER_API_URL). */
  readonly apiUrl: string;
  /** Download links by platform (KONSPECTER_DOWNLOAD_<PLATFORM>_URL); unset platforms are left out. */
  readonly downloads: Readonly<Partial<Record<Platform, string>>>;
  /** Who runs the site, as the terms and the privacy policy name them. */
  readonly operator: Operator;
}

/**
 * The site's operator (KONSPECTER_LEGAL_NAME, _ID, _ADDRESS, _EMAIL); ""
 * where unset. The ID is a registration number (in Russia ИНН/ОГРН(ИП)).
 */
export interface Operator {
  readonly name: string;
  readonly id: string;
  readonly address: string;
  readonly email: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Loads the .env file into `process.env` without overriding variables already set. */
export function loadEnvFile(env: Env = process.env): void {
  const named = env.KONSPECTER_ENV_FILE;
  try {
    process.loadEnvFile(named ?? ".env");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing || named !== undefined) throw error;
  }
}

function httpUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an http(s) URL: ${value}`);
  }
  return url;
}

export function readConfig(env: Env): SiteConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const publicUrl = value("KONSPECTER_PUBLIC_URL");
  const downloads: Partial<Record<Platform, string>> = {};
  for (const platform of PLATFORMS) {
    const name = `KONSPECTER_DOWNLOAD_${platform.toUpperCase()}_URL`;
    const link = value(name);
    if (link) downloads[platform] = httpUrl(name, link).href;
  }
  return {
    publicOrigin: publicUrl ? httpUrl("KONSPECTER_PUBLIC_URL", publicUrl).origin : null,
    apiUrl: httpUrl(
      "KONSPECTER_API_URL",
      value("KONSPECTER_API_URL") ?? "http://localhost:8080",
    ).href.replace(/\/$/, ""),
    downloads,
    operator: {
      name: value("KONSPECTER_LEGAL_NAME") ?? "",
      id: value("KONSPECTER_LEGAL_ID") ?? "",
      address: value("KONSPECTER_LEGAL_ADDRESS") ?? "",
      email: value("KONSPECTER_LEGAL_EMAIL") ?? "",
    },
  };
}

let config: SiteConfig | undefined;

/** The settings, read once per process. */
export function siteConfig(): SiteConfig {
  if (!config) {
    loadEnvFile();
    config = readConfig(process.env);
  }
  return config;
}
