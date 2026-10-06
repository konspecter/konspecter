import { richText } from "@konspecter/i18n/rich";
import { cheatsheet, MARKDOWN_GUIDE, SECTIONS } from "../cheatsheet";
import { useLocale, useT } from "../i18n/i18n";

/** The Markdown cheatsheet: the marks people use most, as typed and as shown. */
export default function Markdown() {
  const { t } = useT();
  const locale = useLocale();
  const clues = cheatsheet(locale);

  return (
    <article className="cheatsheet site-frame" aria-labelledby="cheatsheet-title">
      <title>{`${t("cheatsheet.title")} · Konspecter`}</title>
      <h1 id="cheatsheet-title">{t("cheatsheet.title")}</h1>
      <p className="section-lead">{t("cheatsheet.lead")}</p>

      {SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={`cheatsheet-${section.id}`}>
          <h2 id={`cheatsheet-${section.id}`}>{t(`cheatsheet.section.${section.id}`)}</h2>
          {section.id === "tags" && <p className="section-lead">{t("cheatsheet.tagsLead")}</p>}
          <table className="cheat-table" aria-labelledby={`cheatsheet-${section.id}`}>
            <thead>
              <tr>
                <th scope="col">{t("cheatsheet.what")}</th>
                <th scope="col">{t("cheatsheet.type")}</th>
                <th scope="col">{t("cheatsheet.get")}</th>
              </tr>
            </thead>
            <tbody>
              {section.clues.map((id) => (
                <tr key={id}>
                  <th scope="row">{t(`cheatsheet.clue.${id}`)}</th>
                  <td>
                    <pre className="cheat-source">{clues[id].source}</pre>
                  </td>
                  <td>
                    <div className="cheat-result">{clues[id].result}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p className="cheatsheet-more">
        {richText(t("cheatsheet.more"), {
          link: <a href={MARKDOWN_GUIDE[locale]}>{t("cheatsheet.guide")}</a>,
        })}
      </p>
    </article>
  );
}
