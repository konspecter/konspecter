import type { ReactNode } from "react";
import { useLocale, useT, type Locale } from "../i18n/i18n";
import { FOLDERS_FOLLOW_TAGS, TAG_CHAIN_SPEC, TAG_RULES } from "../links";

/**
 * Tag-Chain (/tag-chain) for people, not developers: how tags written in a
 * conspect build the tree, shown on examples, with links to the full
 * specification (TAG-CHAIN-SPEC.md) and the app's rules on GitHub. The
 * example words are in the page's language; everything else is messages.
 */

interface Words {
  readonly tag: string;
  readonly chain: readonly [string, string, string];
  readonly travel: string;
  readonly recipes: string;
  readonly italy: string;
  /** Three conspects: one under Travel › Italy, one under Recipes › Italy, one with Italy alone. */
  readonly conspects: readonly [string, string, string];
  readonly file: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    tag: "recipes",
    chain: ["recipes", "baking", "bread"],
    travel: "travel",
    recipes: "recipes",
    italy: "italy",
    conspects: ["Rome", "Pasta", "Phrasebook"],
    file: "rome.md",
  },
  ru: {
    tag: "рецепты",
    chain: ["рецепты", "выпечка", "хлеб"],
    travel: "путешествия",
    recipes: "рецепты",
    italy: "италия",
    conspects: ["Рим", "Паста", "Разговорник"],
    file: "рим.md",
  },
};

/** A folder of the tree: its name as the app shows it, the conspects in it, the folders inside. */
interface Folder {
  readonly name: string;
  readonly conspects?: readonly string[];
  readonly folders?: readonly Folder[];
}

export default function TagChain() {
  const { t } = useT();
  const locale = useLocale();
  const w = WORDS[locale];
  // The tree starts every name with a capital letter, and lists folders and conspects in order.
  const label = (name: string) => name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  const sorted = (names: string[]) => names.sort((a, b) => a.localeCompare(b, locale));
  const [rome, pasta, phrasebook] = w.conspects;
  const chain = `#${w.chain.join("#")}`;
  const shared = sorted([w.travel, w.recipes]).map((root) => ({
    name: label(root),
    folders: [
      {
        name: label(w.italy),
        conspects: sorted([root === w.travel ? rome : pasta, phrasebook]),
      },
    ],
  }));

  return (
    <article className="tag-chain site-frame" aria-labelledby="tag-chain-title">
      <title>{`${t("tagChain.title")} · Konspecter`}</title>
      <h1 id="tag-chain-title">{t("tagChain.title")}</h1>
      <p className="section-lead">{t("tagChain.lead")}</p>

      <Section id="tag" title={t("tagChain.tag.title")} text={t("tagChain.tag.text")}>
        <Example source={`#${w.tag}`}>
          <span className="cheat-tag">#{w.tag}</span>
        </Example>
      </Section>

      <Section id="chain" title={t("tagChain.chain.title")} text={t("tagChain.chain.text")}>
        <Example source={chain}>
          <Tree
            label={t("tagChain.tree")}
            folders={[
              {
                name: label(w.chain[0]),
                folders: [{ name: label(w.chain[1]), folders: [{ name: label(w.chain[2]) }] }],
              },
            ]}
          />
        </Example>
        <Example source={`#${w.chain[0]} #${w.chain[1]}`}>
          {w.chain.slice(0, 2).map((tag) => (
            <span key={tag} className="cheat-tag">
              #{tag}
            </span>
          ))}
        </Example>
      </Section>

      <Section id="shared" title={t("tagChain.shared.title")} text={t("tagChain.shared.text")}>
        <Example
          write={t("tagChain.conspects")}
          source={[
            `${rome}: #${w.travel}#${w.italy}`,
            `${pasta}: #${w.recipes}#${w.italy}`,
            `${phrasebook}: #${w.italy}`,
          ].join("\n")}
        >
          <Tree label={t("tagChain.tree")} folders={shared} />
        </Example>
      </Section>

      <Section id="find" title={t("tagChain.find.title")} text={t("tagChain.find.text")} />

      <Section id="folders" title={t("tagChain.folders.title")} text={t("tagChain.folders.text")}>
        <Example source={`#${w.travel}#${w.italy}`}>
          <code>{`~/Konspecter/${w.travel}/${w.italy}/${w.file}`}</code>
        </Example>
      </Section>

      <Section id="why" title={t("tagChain.why.title")}>
        <ul>
          <li>{t("tagChain.why.short")}</li>
          <li>{t("tagChain.why.inPlace")}</li>
          <li>{t("tagChain.why.plain")}</li>
        </ul>
      </Section>

      <Section id="spec" title={t("tagChain.spec.title")} text={t("tagChain.spec.text")}>
        <ul>
          <li>
            <a href={TAG_CHAIN_SPEC}>{t("tagChain.spec.spec")}</a>
          </li>
          <li>
            <a href={TAG_RULES}>{t("tagChain.spec.rules")}</a>
          </li>
          <li>
            <a href={FOLDERS_FOLLOW_TAGS}>{t("tagChain.spec.folders")}</a>
          </li>
        </ul>
        <p>{t("tagChain.spec.credit")}</p>
      </Section>
    </article>
  );
}

function Section({
  id,
  title,
  text,
  children,
}: {
  id: string;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={`tag-chain-${id}`}>
      <h2 id={`tag-chain-${id}`}>{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </section>
  );
}

/** The Markdown one writes beside what Konspecter makes of it. */
function Example({
  write,
  source,
  children,
}: {
  write?: string;
  source: string;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="tag-example">
      <div>
        <p className="tag-example-label">{write ?? t("tagChain.write")}</p>
        <pre className="cheat-source">{source}</pre>
      </div>
      <div>
        <p className="tag-example-label">{t("tagChain.get")}</p>
        <div className="tag-example-result">{children}</div>
      </div>
    </div>
  );
}

function Tree({ label, folders }: { label?: string; folders: readonly Folder[] }) {
  return (
    <ul className="tag-tree" aria-label={label}>
      {folders.map((folder) => (
        <li key={folder.name}>
          <span className="tag-folder">{folder.name}</span>
          {folder.conspects && (
            <span className="tag-folder-conspects">{folder.conspects.join(", ")}</span>
          )}
          {folder.folders && <Tree folders={folder.folders} />}
        </li>
      ))}
    </ul>
  );
}
