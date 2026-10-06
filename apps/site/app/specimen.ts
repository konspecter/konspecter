import type { Locale } from "./i18n/i18n";

/**
 * The conspect the landing page shows: a real document in Konspecter's
 * format (docs/architecture/markdown-format.md), line by line, so the page
 * can colour it the way the Markdown editor does.
 */
export type SpecimenLine =
  | { readonly kind: "fence" | "blank" }
  | { readonly kind: "meta"; readonly key: string; readonly value: string }
  | { readonly kind: "heading" | "text" | "codeFence" | "code" | "tags"; readonly text: string };

export interface Specimen {
  readonly file: string;
  readonly lines: readonly SpecimenLine[];
}

export const SPECIMENS: Record<Locale, Specimen> = {
  en: {
    file: "grandmas-apple-pie.md",
    lines: [
      { kind: "fence" },
      { kind: "meta", key: "title", value: "Grandma's apple pie" },
      { kind: "meta", key: "created", value: "2026-09-02T08:40:00Z" },
      { kind: "meta", key: "updated", value: "2026-09-14T16:05:00Z" },
      { kind: "fence" },
      { kind: "blank" },
      { kind: "heading", text: "# Grandma's apple pie" },
      { kind: "blank" },
      { kind: "text", text: "Bake at 180 °C for 40 minutes. Sour apples work best." },
      { kind: "blank" },
      { kind: "text", text: "- [x] 4 apples" },
      { kind: "text", text: "- [x] 200 g flour, 150 g sugar" },
      { kind: "text", text: "- [ ] 3 eggs" },
      { kind: "blank" },
      { kind: "tags", text: "#recipes#baking #family" },
    ],
  },
  ru: {
    file: "babushkin-yablochnyi-pirog.md",
    lines: [
      { kind: "fence" },
      { kind: "meta", key: "title", value: "Бабушкин яблочный пирог" },
      { kind: "meta", key: "created", value: "2026-09-02T08:40:00Z" },
      { kind: "meta", key: "updated", value: "2026-09-14T16:05:00Z" },
      { kind: "fence" },
      { kind: "blank" },
      { kind: "heading", text: "# Бабушкин яблочный пирог" },
      { kind: "blank" },
      { kind: "text", text: "Печь 40 минут при 180 °C. Лучше всего подходят кислые яблоки." },
      { kind: "blank" },
      { kind: "text", text: "- [x] 4 яблока" },
      { kind: "text", text: "- [x] 200 г муки, 150 г сахара" },
      { kind: "text", text: "- [ ] 3 яйца" },
      { kind: "blank" },
      { kind: "tags", text: "#рецепты#выпечка #семья" },
    ],
  },
};
