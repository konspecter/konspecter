/** Build-time settings (see .env.example). */
interface ImportMetaEnv {
  /** The sync server the connect form suggests, e.g. "https://konspecter.com". */
  readonly VITE_KONSPECTER_SERVER_URL?: string;
}

/** The app's version from package.json, set by vite.config.ts. */
declare const __KONSPECTER_VERSION__: string;
