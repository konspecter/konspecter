import { en } from "./en";
import { translator } from "./i18n";
import { ru } from "./ru";

const placeholders = (value: unknown) =>
  JSON.stringify(value)
    .match(/\{\w+\}/g)
    ?.sort()
    .filter((p, i, a) => a.indexOf(p) === i) ?? [];

it("has a Russian translation for every message, with the same placeholders", () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(ru[key], key).toBeDefined();
    expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]));
  }
});

it("keeps one translator per language, side by side", () => {
  expect(translator("en").t("home.download", { platform: "Linux" })).toBe("Download for Linux");
  expect(translator("ru").t("home.download", { platform: "Linux" })).toBe("Скачать для Linux");
  expect(translator("ru")).toBe(translator("ru"));
});
