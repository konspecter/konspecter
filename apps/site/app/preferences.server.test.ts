import {
  acceptedLanguages,
  preferenceCookie,
  readCookies,
  readPreferences,
  safeReturnPath,
} from "./preferences.server";

const request = (headers: Record<string, string>) => new Request("http://site.test/", { headers });

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
