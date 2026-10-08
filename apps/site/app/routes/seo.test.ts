import { RouterContextProvider } from "react-router";
import { loader as robots } from "./robots";
import { loader as ruOther } from "./ru-other";
import { loader as sitemap } from "./sitemap";

const args = (path: string, params: Record<string, string> = {}) =>
  ({
    request: new Request(`http://site.test${path}`),
    params,
    context: new RouterContextProvider(),
  }) as never;

it("lets crawlers read all but the API and points them at the sitemap", async () => {
  const response = robots(args("/robots.txt"));
  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toBe(
    "User-agent: *\nDisallow: /api/\n\nSitemap: http://site.test/sitemap.xml\n",
  );
});

it("lists every public page in both languages with its translations", async () => {
  const xml = await sitemap(args("/sitemap.xml")).text();
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  expect(locs).toEqual([
    "http://site.test/",
    "http://site.test/ru/",
    "http://site.test/markdown",
    "http://site.test/ru/markdown",
    "http://site.test/terms",
    "http://site.test/ru/terms",
    "http://site.test/privacy",
    "http://site.test/ru/privacy",
  ]);
  expect(xml).toContain(
    '<xhtml:link rel="alternate" hreflang="x-default" href="http://site.test/markdown"/>',
  );
  expect(xml.match(/hreflang="ru"/g)).toHaveLength(8);
});

it("moves any other page under /ru to its one address for good", () => {
  const response = ruOther(args("/ru/login?next=%2Fsettings", { "*": "login" }));
  expect(response.status).toBe(301);
  expect(response.headers.get("Location")).toBe("/login?next=%2Fsettings");
});
