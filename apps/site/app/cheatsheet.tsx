import type { ReactNode } from "react";
import type { Locale } from "./i18n/i18n";

/**
 * The Markdown cheatsheet (/markdown): the marks people use most, each as
 * the source one types and what the app shows for it. Only what Konspecter
 * renders (CommonMark plus GFM, docs/architecture/markdown-format.md) and its
 * own tags (docs/architecture/tags.md). The sample words are in the page's
 * language; the names of the marks are messages (`cheatsheet.clue.<id>`).
 */

/** A full Markdown guide in the visitor's language, for everything the cheatsheet leaves out. */
export const MARKDOWN_GUIDE: Record<Locale, string> = {
  en: "https://www.markdownguide.org/basic-syntax/",
  ru: "https://doka.guide/tools/markdown/",
};

export const CLUE_IDS = [
  "heading",
  "paragraph",
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "bullets",
  "numbered",
  "tasks",
  "quote",
  "codeBlock",
  "rule",
  "table",
  "tag",
  "chain",
  "tags",
] as const;
export type ClueId = (typeof CLUE_IDS)[number];

/** The cheatsheet's sections, in order; each is also its title's message key. */
export const SECTIONS = [
  { id: "text", clues: ["heading", "paragraph", "bold", "italic", "strike", "code", "link"] },
  { id: "lists", clues: ["bullets", "numbered", "tasks"] },
  { id: "blocks", clues: ["quote", "codeBlock", "rule", "table"] },
  { id: "tags", clues: ["tag", "chain", "tags"] },
] as const satisfies readonly { readonly id: string; readonly clues: readonly ClueId[] }[];

export interface Clue {
  /** The Markdown as one types it. */
  readonly source: string;
  /** What the reader shows for it. */
  readonly result: ReactNode;
}

interface Words {
  readonly heading: string;
  readonly subheading: string;
  readonly paragraphs: readonly [string, string];
  readonly bold: string;
  readonly italic: string;
  readonly strike: string;
  readonly link: string;
  readonly bullets: readonly [string, string];
  readonly steps: readonly [string, string];
  readonly tasks: readonly [string, string];
  readonly quote: string;
  readonly table: readonly [string, string, string, string];
  readonly tag: string;
  readonly chain: readonly [string, string];
  readonly tags: readonly [string, string];
}

const WORDS: Record<Locale, Words> = {
  en: {
    heading: "Heading",
    subheading: "Subheading",
    paragraphs: ["First paragraph.", "Second paragraph."],
    bold: "bold",
    italic: "italic",
    strike: "struck out",
    link: "a link",
    bullets: ["Milk", "Bread"],
    steps: ["Preheat the oven", "Mix the dough"],
    tasks: ["Buy apples", "Bake the pie"],
    quote: "Write it down, or it didn't happen.",
    table: ["Day", "Plan", "Mon", "Gym"],
    tag: "recipes",
    chain: ["recipes", "baking"],
    tags: ["work", "ideas"],
  },
  ru: {
    heading: "Заголовок",
    subheading: "Подзаголовок",
    paragraphs: ["Первый абзац.", "Второй абзац."],
    bold: "жирный",
    italic: "курсив",
    strike: "зачёркнутый",
    link: "ссылка",
    bullets: ["Молоко", "Хлеб"],
    steps: ["Разогреть духовку", "Замесить тесто"],
    tasks: ["Купить яблоки", "Испечь пирог"],
    quote: "Не записал — значит, не было.",
    table: ["День", "План", "Пн", "Спорт"],
    tag: "рецепты",
    chain: ["рецепты", "выпечка"],
    tags: ["работа", "идеи"],
  },
};

const lines = (...parts: string[]) => parts.join("\n");

/** A taste of Markdown for the landing page: the marks people meet first. */
export function firstMarks(locale: Locale): readonly string[] {
  const w = WORDS[locale];
  return [`# ${w.heading}`, `**${w.bold}**`, `*${w.italic}*`, `- [ ] ${w.tasks[1]}`, `#${w.tag}`];
}

export function cheatsheet(locale: Locale): Record<ClueId, Clue> {
  const w = WORDS[locale];
  const [day, plan, mon, gym] = w.table;
  return {
    heading: {
      source: lines(`# ${w.heading}`, `## ${w.subheading}`),
      result: (
        <>
          <p className="cheat-h1">{w.heading}</p>
          <p className="cheat-h2">{w.subheading}</p>
        </>
      ),
    },
    paragraph: {
      source: lines(w.paragraphs[0], "", w.paragraphs[1]),
      result: w.paragraphs.map((text) => <p key={text}>{text}</p>),
    },
    bold: { source: `**${w.bold}**`, result: <strong>{w.bold}</strong> },
    italic: { source: `*${w.italic}*`, result: <em>{w.italic}</em> },
    strike: { source: `~~${w.strike}~~`, result: <del>{w.strike}</del> },
    code: { source: "`git status`", result: <code>git status</code> },
    link: {
      source: `[${w.link}](https://example.com)`,
      result: <span className="cheat-link">{w.link}</span>,
    },
    bullets: {
      source: lines(...w.bullets.map((item) => `- ${item}`)),
      result: (
        <ul>
          {w.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ),
    },
    numbered: {
      source: lines(...w.steps.map((item, index) => `${String(index + 1)}. ${item}`)),
      result: (
        <ol>
          {w.steps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      ),
    },
    tasks: {
      source: lines(`- [x] ${w.tasks[0]}`, `- [ ] ${w.tasks[1]}`),
      result: (
        <ul className="cheat-tasks">
          {w.tasks.map((item, index) => (
            <li key={item}>
              <input type="checkbox" checked={index === 0} disabled readOnly /> {item}
            </li>
          ))}
        </ul>
      ),
    },
    quote: { source: `> ${w.quote}`, result: <blockquote>{w.quote}</blockquote> },
    codeBlock: {
      source: lines("```python", 'print("Hello")', "```"),
      result: <pre>print(&quot;Hello&quot;)</pre>,
    },
    rule: { source: "---", result: <hr /> },
    table: {
      source: lines(`| ${day} | ${plan} |`, "| --- | --- |", `| ${mon} | ${gym} |`),
      result: (
        <table>
          <thead>
            <tr>
              <th>{day}</th>
              <th>{plan}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{mon}</td>
              <td>{gym}</td>
            </tr>
          </tbody>
        </table>
      ),
    },
    tag: { source: `#${w.tag}`, result: <span className="cheat-tag">#{w.tag}</span> },
    chain: {
      source: `#${w.chain.join("#")}`,
      result: (
        <span className="cheat-tag">
          {w.chain[0]} › {w.chain[1]}
        </span>
      ),
    },
    tags: {
      source: w.tags.map((tag) => `#${tag}`).join(" "),
      result: w.tags.map((tag) => (
        <span key={tag} className="cheat-tag">
          #{tag}
        </span>
      )),
    },
  };
}
