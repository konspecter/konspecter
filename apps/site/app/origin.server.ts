/**
 * Cross-site request forgery guard: a request that can change something
 * (anything but GET, HEAD and OPTIONS) must come from a page of this site.
 * Browsers send `Origin` on such requests; a missing or foreign one is refused.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The site's own origin: the configured public URL, else the request's (development). */
export function expectedOrigin(request: Request, publicOrigin: string | null): string {
  return publicOrigin ?? new URL(request.url).origin;
}

export function isSameOriginRequest(request: Request, publicOrigin: string | null): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  return request.headers.get("Origin") === expectedOrigin(request, publicOrigin);
}
