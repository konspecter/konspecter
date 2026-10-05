import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

export const streamTimeout = 5_000;

/**
 * Content-Security-Policy for pages. Scripts run only from this origin or
 * with the per-response nonce (React Router's inline hydration data); not in
 * development, where Vite injects inline styles and scripts.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export function securityHeaders(headers: Headers, nonce: string): void {
  if (process.env.NODE_ENV === "production") {
    headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

/**
 * Renders a page. The whole document is rendered before the response
 * starts (the pages are small), so crawlers and visitors get the same HTML.
 */
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const nonce = randomBytes(16).toString("base64");
  securityHeaders(responseHeaders, nonce);

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      abort();
    }, streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          pipe(body);
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Errors before the shell rendered are logged by React Router.
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
