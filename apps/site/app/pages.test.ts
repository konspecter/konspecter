import { alternates, localizedPath, pageUrl, publicPage } from "./pages";

it("puts the Russian pages under /ru and keeps English at the path", () => {
  expect(localizedPath("en", "/")).toBe("/");
  expect(localizedPath("en", "/terms")).toBe("/terms");
  expect(localizedPath("ru", "/")).toBe("/ru/");
  expect(localizedPath("ru", "/markdown")).toBe("/ru/markdown");
});

it("finds a public page and its language by the address", () => {
  expect(publicPage("/")).toEqual({ page: "/", locale: "en" });
  expect(publicPage("/privacy")).toEqual({ page: "/privacy", locale: "en" });
  expect(publicPage("/ru")).toEqual({ page: "/", locale: "ru" });
  expect(publicPage("/ru/")).toEqual({ page: "/", locale: "ru" });
  expect(publicPage("/ru/markdown")).toEqual({ page: "/markdown", locale: "ru" });
});

it("leaves every other page out", () => {
  for (const path of ["/login", "/settings", "/ru/login", "/rules", "/ru/ru/", "/markdown/x"]) {
    expect(publicPage(path)).toBeNull();
  }
});

it("lists a page in every language, then English as the x-default", () => {
  expect(alternates("https://konspecter.com", "/terms")).toEqual([
    { hreflang: "en", href: "https://konspecter.com/terms" },
    { hreflang: "ru", href: "https://konspecter.com/ru/terms" },
    { hreflang: "x-default", href: "https://konspecter.com/terms" },
  ]);
});

it("reads a browser navigation's data request as the page it is for", () => {
  const url = (path: string) => pageUrl(new Request(`http://site.test${path}`));
  expect(url("/ru/markdown.data?_routes=root%2Cru%2Fmarkdown").pathname).toBe("/ru/markdown");
  expect(url("/ru.data").pathname).toBe("/ru");
  expect(url("/_root.data").pathname).toBe("/");
  expect(url("/terms.data?x=1&_routes=root").search).toBe("?x=1");
  expect(url("/privacy").pathname).toBe("/privacy");
});
