import { siteConfig } from "../config.server";
import { expectedOrigin } from "../origin.server";
import { alternates, PUBLIC_PAGES } from "../pages";
import type { Route } from "./+types/sitemap";

/** The public pages in every language, each with its translations (ADR-026). */
export function loader({ request }: Route.LoaderArgs) {
  const origin = expectedOrigin(request, siteConfig().publicOrigin);
  const urls = PUBLIC_PAGES.flatMap((page) => {
    const links = alternates(origin, page);
    const linked = links
      .map(
        (link) =>
          `    <xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${link.href}"/>`,
      )
      .join("\n");
    return links
      .filter((link) => link.hreflang !== "x-default")
      .map((link) => `  <url>\n    <loc>${link.href}</loc>\n${linked}\n  </url>`);
  });
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
