import { siteConfig } from "./config.server";
import { guessPlatform, PLATFORMS, type Platform } from "./platform";

export interface Download {
  readonly platform: Platform;
  readonly url: string;
}

/**
 * The configured downloads in display order, and the visitor's platform
 * when there is a download for it (offered first, highlighted).
 */
export function downloadsFor(request: Request): {
  downloads: Download[];
  suggested: Platform | null;
} {
  const { downloads } = siteConfig();
  const guess = guessPlatform(request.headers.get("User-Agent"));
  return {
    downloads: PLATFORMS.flatMap((platform) => {
      const url = downloads[platform];
      return url ? [{ platform, url }] : [];
    }),
    suggested: guess && downloads[guess] ? guess : null,
  };
}
