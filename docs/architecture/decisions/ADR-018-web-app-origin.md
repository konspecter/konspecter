# ADR-018: The hosted web app on an origin of its own

Status: accepted (2026-10-06). Amended by [ADR-023](ADR-023-published-images.md): the web
image reads its server URL when it starts.

## Context

`deploy/` served the API and the account site on one origin
([ADR-014](ADR-014-account-site.md)), and the web app (the PWA) had to be hosted
somewhere else. The site owns `/` on that origin. The web app is built for `/` too: its
routes, its manifest's `start_url` and `scope`, and its service worker's navigation
fallback to `/index.html`.

## Decision

1. **The Caddy of `deploy/` serves the web app too, on a second address**
   (`KONSPECTER_APP_ADDRESS`, e.g. `app.notes.example.com`; `app.localhost` by default),
   by proxying it like the site.
2. **The web app is a deployable of its own**, the `web` service. `apps/web/Dockerfile`
   builds the app, with `VITE_KONSPECTER_SERVER_URL` set to the public URL so the app
   suggests this server, into an image that serves the files on `:8080` (`caddy:2` with
   `apps/web/Caddyfile`). The proxy stays a stock `caddy:2` that only routes: a new app
   release rebuilds `web`, not the proxy.
3. **The app calls the API on the site's origin, through CORS**, like the desktop and
   mobile apps: its origin goes in `KONSPECTER_ALLOWED_ORIGINS`. It signs in with a bearer
   token, so it needs no cookie on the API's origin.
4. **Caching:** `/assets/*` (hashed names) is immutable for a year; everything else
   (`index.html`, `sw.js`, the manifest, icons) is `no-cache`, so a new release reaches the
   app's update prompt on the next load. A path that is not a file returns `index.html`,
   except under `/assets/`, where it stays a 404.

## Alternatives

- **A path on the site's origin (`/app/`)** keeps one certificate and one host name, but
  means a build-time base for the router, the manifest and the service worker, a scope that
  differs from the desktop and mobile builds, and the app's IndexedDB and service worker
  sharing an origin with the site.
- **The build inside the proxy image**, served by the front Caddy itself, saves a container
  but ties the proxy to the app: every app release rebuilds and restarts the proxy, and the
  proxy is no longer the stock image.

## Consequences

- Two host names to point at the server, each with its own certificate (Caddy gets both).
- The web app's notes, settings and service worker are isolated from the site by the
  browser's same-origin policy.
- Changing the public URL means rebuilding the `web` image (`docker compose up -d --build`).
