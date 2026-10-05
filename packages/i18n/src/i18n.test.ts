import { describe, expect, it } from "vitest";
import { createTranslator, detectLocale, fill, type Dictionary } from "./i18n";

const en = {
  greeting: "Hello, {name}",
  notes: { one: "{count} note", other: "{count} notes" },
};
const ru: Dictionary<typeof en> = {
  greeting: "Привет, {name}",
  notes: {
    one: "{count} заметка",
    few: "{count} заметки",
    many: "{count} заметок",
    other: "{count} заметки",
  },
};

describe("detectLocale", () => {
  const locales = ["en", "ru"] as const;

  it("takes the first preferred language it knows", () => {
    expect(detectLocale(["ru-RU", "en-US"], locales, "en")).toBe("ru");
    expect(detectLocale(["de-DE", "ru"], locales, "en")).toBe("ru");
    expect(detectLocale(["EN-gb"], locales, "ru")).toBe("en");
    expect(detectLocale(["ru_RU"], locales, "en")).toBe("ru");
  });

  it("falls back", () => {
    expect(detectLocale(["de-DE", "fr"], locales, "en")).toBe("en");
    expect(detectLocale([], locales, "ru")).toBe("ru");
  });
});

describe("translators", () => {
  it("fill placeholders and leave unknown ones", () => {
    const t = createTranslator(en, "en");
    expect(t.t("greeting", { name: "Ann" })).toBe("Hello, Ann");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("use each language's plural forms and number format", () => {
    const english = createTranslator(en, "en");
    const russian = createTranslator(ru, "ru");
    expect([1, 2, 5].map((n) => english.tn("notes", n))).toEqual(["1 note", "2 notes", "5 notes"]);
    expect([1, 2, 5, 21].map((n) => russian.tn("notes", n))).toEqual([
      "1 заметка",
      "2 заметки",
      "5 заметок",
      "21 заметка",
    ]);
    expect(english.tn("notes", 1200)).toBe("1,200 notes");
  });

  it("keep their own language side by side", () => {
    const english = createTranslator(en, "en");
    const russian = createTranslator(ru, "ru");
    expect(english.t("greeting", { name: "A" })).toBe("Hello, A");
    expect(russian.t("greeting", { name: "A" })).toBe("Привет, A");
    expect(english.locale).toBe("en");
    expect(russian.locale).toBe("ru");
  });
});
