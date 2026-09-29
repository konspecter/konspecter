import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createNote } from "../../domain/note/note";
import { openNoteStore } from "../../infrastructure/storage/note-store";
import { App } from "../app/App";
import { en } from "./en";
import { detectLocale, setLocale, t, tn } from "./i18n";
import { ru } from "./ru";

afterEach(() => {
  setLocale("en");
});

describe("detectLocale", () => {
  it("takes the first preferred language the app speaks", () => {
    expect(detectLocale(["ru-RU", "en-US"])).toBe("ru");
    expect(detectLocale(["de-DE", "ru"])).toBe("ru");
    expect(detectLocale(["EN-gb"])).toBe("en");
  });

  it("falls back to English", () => {
    expect(detectLocale(["de-DE", "fr"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("messages", () => {
  it("fills placeholders", () => {
    expect(t("list.removeTag", { tag: "java" })).toBe("Remove #java filter");
    setLocale("ru");
    expect(t("list.removeTag", { tag: "java" })).toBe("Убрать фильтр #java");
  });

  it("uses each language's plural forms", () => {
    expect([1, 2, 5].map((n) => tn("tree.notes", n))).toEqual([
      "1 conspect",
      "2 conspects",
      "5 conspects",
    ]);
    setLocale("ru");
    // Russian groups thousands with a no-break space.
    expect([1, 2, 5, 21, 1000].map((n) => tn("tree.notes", n).replace(/\s/g, " "))).toEqual([
      "1 конспект",
      "2 конспекта",
      "5 конспектов",
      "21 конспект",
      "1 000 конспектов",
    ]);
  });

  it("has a Russian translation for every message, with the same placeholders", () => {
    const placeholders = (value: unknown) =>
      JSON.stringify(value)
        .match(/\{\w+\}/g)
        ?.sort()
        .filter((p, i, a) => a.indexOf(p) === i) ?? [];
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(ru[key], key).toBeDefined();
      expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

it("shows the app in Russian", async () => {
  setLocale("ru");
  const store = await openNoteStore("i18n-test");
  await store.put(createNote("# Заметка\n\n#новые_технологии", new Date(), "n"));
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App store={store} />
    </MemoryRouter>,
  );

  const sidebar = screen.getByRole("complementary", { name: "Боковая панель" });
  const tags = await within(sidebar).findByRole("navigation", { name: "Теги" });
  expect(await within(tags).findByRole("link", { name: "Новые технологии" })).toBeInTheDocument();
  expect(within(tags).getByLabelText("1 конспект")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Конспекты" })).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Поиск по конспектам" })).toBeInTheDocument();
});
