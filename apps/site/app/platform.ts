/** The platforms the landing page offers downloads for, in display order. */
export const PLATFORMS = ["macos", "windows", "linux", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * The visitor's platform guessed from the User-Agent, to offer the right
 * download first. Only a hint: every download stays listed below it.
 */
export function guessPlatform(userAgent: string | null): Platform | null {
  const ua = userAgent ?? "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua)) return "linux";
  return null;
}
