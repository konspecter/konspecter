import { terms, sizeText, type LegalContext } from "./legal";
import { parseQuota } from "./legal.server";
import { translator, type Locale } from "./i18n/i18n";
import { parsePlans } from "./subscription";

function context(locale: Locale, quota: number | null): LegalContext {
  return {
    locale,
    t: translator(locale),
    operator: { name: "", id: "", address: "", email: "" },
    host: "notes.example.com",
    plans: parsePlans(null),
    quota,
  };
}

const text = (c: LegalContext) =>
  terms(c)
    .sections.flatMap((section) => section.paragraphs)
    .filter((paragraph) => typeof paragraph === "string")
    .join("\n");

describe("the storage quota in the terms", () => {
  it.each([
    ["en", "Each account may store up to 512 MB of conspects"],
    ["ru", "Каждый аккаунт может хранить на сервере до 512 МБ конспектов"],
  ] as const)("is stated in %s, as the server sets it", (locale, sentence) => {
    expect(text(context(locale, 512 << 20))).toContain(sentence);
  });

  it("is left out when the server did not say", () => {
    expect(text(context("en", null))).not.toContain("may store up to");
  });

  it.each([
    [1 << 20, "en", "1 MB"],
    [512 << 20, "en", "512 MB"],
    [1536 << 20, "en", "1.5 GB"],
    [2 ** 31, "ru", "2 ГБ"],
  ] as const)("writes %d bytes in %s as %s", (bytes, locale, written) => {
    expect(sizeText(bytes, locale)).toBe(written);
  });

  it("takes only a positive whole quota from the server", () => {
    expect(parseQuota({ quota: 536870912 })).toBe(536870912);
    for (const data of [null, {}, { quota: "512MB" }, { quota: 0 }, { quota: 1.5 }]) {
      expect(parseQuota(data)).toBeNull();
    }
  });
});
