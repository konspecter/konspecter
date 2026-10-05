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

const code = (text: string): SpecimenLine => ({ kind: "code", text });

export const SPECIMENS: Record<Locale, Specimen> = {
  en: {
    file: "reading-explain-analyze.md",
    lines: [
      { kind: "fence" },
      { kind: "meta", key: "title", value: "Reading EXPLAIN ANALYZE" },
      { kind: "meta", key: "created", value: "2026-09-02T08:40:00Z" },
      { kind: "meta", key: "updated", value: "2026-09-14T16:05:00Z" },
      { kind: "fence" },
      { kind: "blank" },
      { kind: "heading", text: "# Reading EXPLAIN ANALYZE" },
      { kind: "blank" },
      {
        kind: "text",
        text: "Compare `rows` with `actual rows` first. A gap of ten times or more means stale statistics: run ANALYZE.",
      },
      { kind: "blank" },
      { kind: "codeFence", text: "```sql" },
      code("EXPLAIN (ANALYZE, BUFFERS)"),
      code("SELECT * FROM orders WHERE customer_id = 42;"),
      { kind: "codeFence", text: "```" },
      { kind: "blank" },
      { kind: "tags", text: "#databases#postgres #performance" },
    ],
  },
  ru: {
    file: "chitaem-explain-analyze.md",
    lines: [
      { kind: "fence" },
      { kind: "meta", key: "title", value: "Читаем EXPLAIN ANALYZE" },
      { kind: "meta", key: "created", value: "2026-09-02T08:40:00Z" },
      { kind: "meta", key: "updated", value: "2026-09-14T16:05:00Z" },
      { kind: "fence" },
      { kind: "blank" },
      { kind: "heading", text: "# Читаем EXPLAIN ANALYZE" },
      { kind: "blank" },
      {
        kind: "text",
        text: "Сначала сравните `rows` и `actual rows`. Разница в десять раз и больше — устаревшая статистика: запустите ANALYZE.",
      },
      { kind: "blank" },
      { kind: "codeFence", text: "```sql" },
      code("EXPLAIN (ANALYZE, BUFFERS)"),
      code("SELECT * FROM orders WHERE customer_id = 42;"),
      { kind: "codeFence", text: "```" },
      { kind: "blank" },
      { kind: "tags", text: "#базы-данных#postgres #производительность" },
    ],
  },
};
