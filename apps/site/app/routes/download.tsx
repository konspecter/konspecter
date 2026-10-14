import { richText } from "@konspecter/i18n/rich";
import { Link } from "react-router";
import { MARKDOWN_GUIDE } from "../cheatsheet";
import { downloadsFor } from "../downloads.server";
import { useLocale, useT } from "../i18n/i18n";
import { RELEASES, SELF_HOSTING, SOURCE_CODE } from "../links";
import { useLocalePath } from "../pages";
import { PlatformList } from "../platform-list";
import type { Route } from "./+types/download";

export function loader({ request }: Route.LoaderArgs) {
  return downloadsFor(request);
}

/** Opens the macOS app downloaded from the internet without asking. */
const UNQUARANTINE = "xattr -dr com.apple.quarantine /Applications/Konspecter.app";

/**
 * Every download, as on the landing page, with what helps after it: opening
 * the Mac app the first time, installing the APK and the web app, where the
 * conspects are kept, and where to read and learn more.
 */
export default function Download({ loaderData }: Route.ComponentProps) {
  const { t } = useT();
  const locale = useLocale();
  const localePath = useLocalePath();
  const { downloads, suggested } = loaderData;
  const offers = (platform: string) => downloads.some((download) => download.platform === platform);
  const releases = <a href={RELEASES}>{t("download.releasesPage")}</a>;

  return (
    <article className="download-page site-frame" aria-labelledby="download-page-title">
      <title>{`${t("download.title")} · Konspecter`}</title>
      <h1 id="download-page-title">{t("download.title")}</h1>
      <p className="section-lead">{t("download.lead")}</p>
      {downloads.length > 0 ? (
        <PlatformList downloads={downloads} suggested={suggested} firstOpenNote={false} />
      ) : (
        <p className="section-lead">{richText(t("download.none"), { releases })}</p>
      )}

      <div className="download-info">
        {offers("macos") && (
          <section aria-labelledby="download-macos">
            <h2 id="download-macos">{t("download.macos.title")}</h2>
            <p>{t("download.macos.why")}</p>
            <ol>
              <li>{t("download.macos.step1")}</li>
              <li>{t("download.macos.step2")}</li>
            </ol>
            <p>{t("download.macos.terminal")}</p>
            <pre className="download-command">
              <code>{UNQUARANTINE}</code>
            </pre>
            <p>{t("download.macos.keychain")}</p>
          </section>
        )}
        {offers("android") && (
          <section aria-labelledby="download-android">
            <h2 id="download-android">{t("download.android.title")}</h2>
            <p>{t("download.android.text")}</p>
          </section>
        )}
        {offers("web") && (
          <section aria-labelledby="download-web">
            <h2 id="download-web">{t("download.web.title")}</h2>
            <p>{t("download.web.text")}</p>
          </section>
        )}
        <section aria-labelledby="download-library">
          <h2 id="download-library">{t("download.library.title")}</h2>
          <p>{t("download.library.text")}</p>
        </section>
        <section aria-labelledby="download-more">
          <h2 id="download-more">{t("download.more.title")}</h2>
          <ul>
            <li>
              <a href={RELEASES}>{t("download.more.releases")}</a>
            </li>
            <li>
              <a href={SOURCE_CODE}>{t("download.more.source")}</a>
            </li>
            <li>
              <Link to={localePath("/markdown")}>{t("download.more.cheatsheet")}</Link>
            </li>
            <li>
              <a href={MARKDOWN_GUIDE[locale]}>{t("download.more.guide")}</a>
            </li>
            <li>
              <a href={SELF_HOSTING}>{t("download.more.selfHosting")}</a>
            </li>
          </ul>
        </section>
      </div>
    </article>
  );
}
