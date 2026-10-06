import type { Locale } from "./i18n/i18n";

/**
 * The conspects the landing page shows, one per kind of reader: real
 * documents in Konspecter's format (docs/architecture/markdown-format.md),
 * line by line, so the page can colour them the way the Markdown editor does.
 */
export type SpecimenLine =
  | { readonly kind: "fence" | "blank" }
  | { readonly kind: "meta"; readonly key: string; readonly value: string }
  | { readonly kind: "heading" | "text" | "codeFence" | "code" | "tags"; readonly text: string };

/** Who the example is for; also its tab's message key (`home.example.<id>`). */
export const SPECIMEN_IDS = ["recipe", "devops", "rust", "books"] as const;
export type SpecimenId = (typeof SPECIMEN_IDS)[number];

export interface Specimen {
  readonly id: SpecimenId;
  readonly file: string;
  readonly lines: readonly SpecimenLine[];
}

const fence: SpecimenLine = { kind: "fence" };
const blank: SpecimenLine = { kind: "blank" };
const text = (value: string): SpecimenLine => ({ kind: "text", text: value });
const code = (value: string): SpecimenLine => ({ kind: "code", text: value });

/** The front matter and the heading every conspect starts with. */
function header(title: string, created: string, updated: string): SpecimenLine[] {
  return [
    fence,
    { kind: "meta", key: "title", value: title },
    { kind: "meta", key: "created", value: created },
    { kind: "meta", key: "updated", value: updated },
    fence,
    blank,
    { kind: "heading", text: `# ${title}` },
    blank,
  ];
}

export const SPECIMENS: Record<Locale, readonly Specimen[]> = {
  en: [
    {
      id: "recipe",
      file: "grandmas-apple-pie.md",
      lines: [
        ...header("Grandma's apple pie", "2026-09-02T08:40:00Z", "2026-09-14T16:05:00Z"),
        text("Bake at 180 °C for 40 minutes. Sour apples work best."),
        blank,
        text("- [x] 4 apples"),
        text("- [x] 200 g flour, 150 g sugar"),
        text("- [ ] 3 eggs"),
        blank,
        { kind: "tags", text: "#recipes#baking #family" },
      ],
    },
    {
      id: "devops",
      file: "rolling-back-a-deployment.md",
      lines: [
        ...header("Rolling back a deployment", "2026-08-21T22:10:00Z", "2026-09-30T07:45:00Z"),
        text("Check the history, then go back one revision and watch the pods come up."),
        blank,
        { kind: "codeFence", text: "```sh" },
        code("kubectl rollout history deployment/api"),
        code("kubectl rollout undo deployment/api"),
        { kind: "codeFence", text: "```" },
        blank,
        { kind: "tags", text: "#devops#kubernetes #runbooks" },
      ],
    },
    {
      id: "rust",
      file: "borrowing-in-rust.md",
      lines: [
        ...header("Borrowing in Rust", "2026-09-10T19:30:00Z", "2026-09-11T09:05:00Z"),
        text("One `&mut` or any number of `&`, never both. A `&str` only borrows the text."),
        blank,
        { kind: "codeFence", text: "```rust" },
        code("fn first_word(s: &str) -> &str {"),
        code("    s.split(' ').next().unwrap_or(\"\")"),
        code("}"),
        { kind: "codeFence", text: "```" },
        blank,
        { kind: "tags", text: "#programming#rust #ownership" },
      ],
    },
    {
      id: "books",
      file: "anna-karenina.md",
      lines: [
        ...header("Anna Karenina", "2026-07-03T21:00:00Z", "2026-09-28T22:40:00Z"),
        text("> All happy families are alike; each unhappy family is unhappy in its own way."),
        blank,
        text("- [x] Part one: Moscow, the ball"),
        text("- [ ] Part three: Levin mows with the peasants"),
        blank,
        { kind: "tags", text: "#books#tolstoy #reading-2026" },
      ],
    },
  ],
  ru: [
    {
      id: "recipe",
      file: "babushkin-yablochnyi-pirog.md",
      lines: [
        ...header("Бабушкин яблочный пирог", "2026-09-02T08:40:00Z", "2026-09-14T16:05:00Z"),
        text("Печь 40 минут при 180 °C. Лучше всего подходят кислые яблоки."),
        blank,
        text("- [x] 4 яблока"),
        text("- [x] 200 г муки, 150 г сахара"),
        text("- [ ] 3 яйца"),
        blank,
        { kind: "tags", text: "#рецепты#выпечка #семья" },
      ],
    },
    {
      id: "devops",
      file: "otkat-deploya.md",
      lines: [
        ...header("Откат деплоя", "2026-08-21T22:10:00Z", "2026-09-30T07:45:00Z"),
        text("Посмотреть историю, откатиться на одну ревизию и проследить, как поднимаются поды."),
        blank,
        { kind: "codeFence", text: "```sh" },
        code("kubectl rollout history deployment/api"),
        code("kubectl rollout undo deployment/api"),
        { kind: "codeFence", text: "```" },
        blank,
        { kind: "tags", text: "#devops#kubernetes #инструкции" },
      ],
    },
    {
      id: "rust",
      file: "zaimstvovanie-v-rust.md",
      lines: [
        ...header("Заимствование в Rust", "2026-09-10T19:30:00Z", "2026-09-11T09:05:00Z"),
        text("Один `&mut` или сколько угодно `&`, но не вместе. `&str` только одалживает текст."),
        blank,
        { kind: "codeFence", text: "```rust" },
        code("fn first_word(s: &str) -> &str {"),
        code("    s.split(' ').next().unwrap_or(\"\")"),
        code("}"),
        { kind: "codeFence", text: "```" },
        blank,
        { kind: "tags", text: "#программирование#rust #владение" },
      ],
    },
    {
      id: "books",
      file: "anna-karenina.md",
      lines: [
        ...header("Анна Каренина", "2026-07-03T21:00:00Z", "2026-09-28T22:40:00Z"),
        text(
          "> Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.",
        ),
        blank,
        text("- [x] Часть первая: Москва, бал"),
        text("- [ ] Часть третья: Левин косит с мужиками"),
        blank,
        { kind: "tags", text: "#книги#толстой #чтение-2026" },
      ],
    },
  ],
};
