import {
  acceptedLanguages,
  browserLocale,
  chosenLocale,
  pathInLocale,
  preferenceCookie,
  readCookies,
  readPreferences,
  safeReturnPath,
} from "./preferences.server";

const request = (headers: Record<string, string>, path = "/login") =>
  new Request(`http://site.test${path}`, { headers });

describe("readPreferences", () => {
  it("prefers the chosen language and theme", () => {
    expect(
      readPreferences(request({ Cookie: "lang=ru; theme=dark", "Accept-Language": "en" })),
    ).toEqual({ locale: "ru", theme: "dark" });
  });

  it("falls back to the browser's languages, then English and the system theme", () => {
    expect(readPreferences(request({ "Accept-Language": "de-DE,ru;q=0.8,en;q=0.5" }))).toEqual({
      locale: "ru",
      theme: "system",
    });
    expect(readPreferences(request({ Cookie: "lang=de; theme=pink" }))).toEqual({
      locale: "en",
      theme: "system",
    });
  });

  it("speaks a public page's language, whatever was chosen", () => {
    expect(readPreferences(request({ Cookie: "lang=ru" }, "/markdown")).locale).toBe("en");
    expect(readPreferences(request({ "Accept-Language": "en" }, "/ru/terms")).locale).toBe("ru");
  });
});

it("reads the chosen language only from the cookie", () => {
  expect(chosenLocale(request({ Cookie: "lang=ru" }, "/"))).toBe("ru");
  expect(chosenLocale(request({ "Accept-Language": "ru" }))).toBeNull();
});

it("orders accepted languages by weight and drops refused ones", () => {
  expect(acceptedLanguages("en;q=0.4, ru-RU, de;q=0, fr;q=0.9")).toEqual(["ru-RU", "fr", "en"]);
  expect(acceptedLanguages(null)).toEqual([]);
});

it("reads cookies and skips broken ones", () => {
  const cookies = readCookies("a=1; b=%E2%9C%93; broken=%E0%A4%A; c=x=y");
  expect(cookies.get("a")).toBe("1");
  expect(cookies.get("b")).toBe("✓");
  expect(cookies.has("broken")).toBe(false);
  expect(cookies.get("c")).toBe("x=y");
});

it("writes a year-long cookie, secure when the site is on https", () => {
  expect(preferenceCookie("theme", "dark", false)).toBe(
    "theme=dark; Path=/; Max-Age=31536000; SameSite=Lax",
  );
  expect(preferenceCookie("lang", "ru", true)).toMatch(/; Secure$/);
});

it("only returns to paths on this site", () => {
  expect(safeReturnPath("/settings?x=1")).toBe("/settings?x=1");
  for (const path of ["//evil.example", "https://evil.example", "/\\evil.example", "", null]) {
    expect(safeReturnPath(path)).toBe("/");
  }
});

it("switches a public page to its address in the new language, and leaves others", () => {
  expect(pathInLocale("/markdown", "ru")).toBe("/ru/markdown");
  expect(pathInLocale("/ru/?x=1#download", "en")).toBe("/?x=1#download");
  expect(pathInLocale("/settings?tab=1", "ru")).toBe("/settings?tab=1");
});

it("reads the browser's language among the site's, else English", () => {
  expect(browserLocale(request({ "Accept-Language": "de, ru-RU;q=0.5" }))).toBe("ru");
  expect(browserLocale(request({ "Accept-Language": "de" }))).toBe("en");
  expect(browserLocale(request({}))).toBe("en");
});
