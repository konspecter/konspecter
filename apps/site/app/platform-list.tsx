import { useT } from "./i18n/i18n";
import type { Platform } from "./platform";

/**
 * The downloads, one row per platform, the visitor's highlighted; the macOS
 * row carries the note on opening the app the first time, unless the page
 * explains that at length itself.
 */
export function PlatformList({
  downloads,
  suggested,
  firstOpenNote = true,
}: {
  downloads: readonly { platform: Platform; url: string }[];
  suggested: Platform | null;
  firstOpenNote?: boolean;
}) {
  const { t } = useT();
  const platformName = (platform: Platform) => t(`home.platform.${platform}`);
  return (
    <ul className="platform-list">
      {downloads.map(({ platform, url }) => (
        <li key={platform} className="platform">
          <span className="platform-name">{platformName(platform)}</span>
          <span className="platform-note">{t(`home.platformNote.${platform}`)}</span>
          <a
            className={platform === suggested ? "button button-primary" : "button"}
            href={url}
            aria-label={
              platform === "web"
                ? t("home.openWeb")
                : t("home.download", { platform: platformName(platform) })
            }
          >
            {platform === "web" ? t("home.open") : t("home.get")}
          </a>
          {platform === "macos" && firstOpenNote && (
            <p className="platform-footnote">{t("home.macosFirstOpen")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
