import { siteConfig } from "../config.server";
import { expectedOrigin } from "../origin.server";
import type { Route } from "./+types/robots";

/**
 * Crawlers may read every page but the API; the pages that are not public say
 * noindex themselves (root.tsx), which a crawler only sees if it may fetch them.
 */
export function loader({ request }: Route.LoaderArgs) {
  const origin = expectedOrigin(request, siteConfig().publicOrigin);
  return new Response(`User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
