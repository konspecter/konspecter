import { DocumentIcon } from "@konspecter/ui/icons";
import { Fragment, type ReactNode } from "react";
import { siteConfig } from "../config.server";
import { useLocale, useT, type Locale } from "../i18n/i18n";
import { guessPlatform, PLATFORMS, type Platform } from "../platform";
import { SPECIMENS, type SpecimenLine } from "../specimen";
import type { Route } from "./+types/home";

export function loader({ request }: Route.LoaderArgs) {
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

const FEATURES = ["write", "find", "tags", "offline", "devices", "private"] as const;

/** Inline `code` spans and #tags of a source line, coloured as the Markdown editor does. */
function sourceText(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((piece, index) =>
    piece.startsWith("`") ? (
      <span key={index} className="md-code">
        {piece}
      </span>
    ) : (
      <Fragment key={index}>{piece}</Fragment>
    ),
  );
}

function Line({ line }: { line: SpecimenLine }) {
  switch (line.kind) {
    case "fence":
      return <span className="md-fence">---</span>;
    case "blank":
      return null;
    case "meta":
      return (
        <>
          <span className="md-key">{line.key}:</span> {line.value}
        </>
      );
    case "heading":
      return <span className="md-heading">{line.text}</span>;
    case "codeFence":
      return <span className="md-fence">{line.text}</span>;
    case "code":
      return <span className="md-block">{line.text}</span>;
    case "tags":
      return line.text.split(" ").map((tag, index) => (
        <Fragment key={tag}>
          {index > 0 && " "}
          <span className="md-tag">{tag}</span>
        </Fragment>
      ));
    case "text":
      return sourceText(line.text);
  }
}

/** The landing page's one picture: a conspect as the file Konspecter keeps. */
function Specimen({ locale, label }: { locale: Locale; label: string }) {
  const specimen = SPECIMENS[locale];
  const last = specimen.lines.length - 1;
  return (
    <figure className="specimen" aria-label={label}>
      <figcaption className="specimen-file">
        <DocumentIcon />
        {specimen.file}
      </figcaption>
      <pre className="specimen-source">
        <code>
          {specimen.lines.map((line, index) => (
            <span key={index} className={line.kind === "code" ? "md-line md-code-line" : "md-line"}>
              <Line line={line} />
              {index === last && <span className="caret" aria-hidden="true" />}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useT();
  const locale = useLocale();
  const { downloads, suggested } = loaderData;
  const platformName = (platform: Platform) => t(`home.platform.${platform}`);
  const web = downloads.find((download) => download.platform === "web");
  const apps = downloads.filter((download) => download.platform !== "web");
  const suggestedUrl = downloads.find((download) => download.platform === suggested)?.url;

  return (
    <>
      <title>{`${t("home.title")} · Konspecter`}</title>
      <section className="hero site-frame">
        <div className="hero-text">
          <h1>{t("home.title")}</h1>
          <p className="hero-lead">{t("home.lead")}</p>
          {(apps.length > 0 || web) && (
            <div className="actions hero-actions">
              {suggested && suggested !== "web" && suggestedUrl ? (
                <a className="button button-primary" href={suggestedUrl}>
                  {t("home.download", { platform: platformName(suggested) })}
                </a>
              ) : (
                apps.length > 0 && (
                  <a className="button button-primary" href="#download">
                    {t("home.get")}
                  </a>
                )
              )}
              {web && (
                <a className="button" href={web.url}>
                  {t("home.openWeb")}
                </a>
              )}
            </div>
          )}
        </div>
        <Specimen locale={locale} label={t("home.specimenLabel")} />
      </section>

      <section className="features site-frame" aria-labelledby="features-title">
        <h2 id="features-title">{t("home.featuresTitle")}</h2>
        <dl className="feature-list">
          {FEATURES.map((feature) => (
            <div key={feature} className="feature">
              <dt>{t(`home.feature.${feature}.title`)}</dt>
              <dd>{t(`home.feature.${feature}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {downloads.length > 0 && (
        <section id="download" className="downloads site-frame" aria-labelledby="download-title">
          <h2 id="download-title">{t("home.downloadsTitle")}</h2>
          <p className="section-lead">{t("home.downloadsLead")}</p>
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
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
