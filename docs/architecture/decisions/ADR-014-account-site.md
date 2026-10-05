# ADR-014: An account site in React Router, in front of the Go API

Status: accepted (2026-10-05)

## Context

Sync used to mean pasting a server URL and an access token that only an administrator could
issue from the command line. People need a place to sign up and sign in, see their devices,
set up encryption and delete their account, plus a public landing page. The Go server is a
JSON API, and it should stay one: every security rule (sessions, codes, rate limits, keys)
lives there, in one language, with one set of tests.

## Decision

1. **A separate web application, `apps/site`**, built with React Router in framework mode
   and rendered on the server in Node (`@react-router/node`, `react-router-serve`). Pages
   are HTML from the first request. Forms are plain posts to route actions, so they work
   before and without JavaScript. The one exception is the Encryption section, which must
   run in the browser ([ADR-017](ADR-017-end-to-end-encryption.md)).
2. **The Go server stays a JSON API and owns all security logic.** The site's loaders and
   actions call it on the visitor's behalf. They forward the visitor's `Cookie`, `Origin`,
   `Accept-Language`, `User-Agent` and `X-Forwarded-For`, and pass the API's `Set-Cookie`
   back to the browser. The site keeps no secrets and no state of its own, except the
   visitor's language and theme cookies.
3. **One origin.** A reverse proxy (Caddy in `deploy/`) sends `/api/*` to Go and everything
   else to the site, so the session cookie is first-party, the site needs no CORS, and OAuth
   callbacks land on Go. In development the site's Vite server proxies `/api`.
4. **Shared look and words through `packages/`**: `packages/ui` (tokens, fonts, controls,
   icons) and `packages/i18n` (a per-instance translator, since one server renders many
   languages at once), used by both the app and the site, so the two cannot drift apart.
   The site has its own English and Russian dictionaries.
5. **Configuration** is read at runtime from the environment, plus `.env` through
   `process.loadEnvFile()`, the environment winning (`apps/site/.env.example`).

## Consequences

- Two deployables instead of one (the Go binary and a Node server), joined by the proxy.
  `deploy/compose.yaml` runs them with PostgreSQL and Caddy. The release ships a site
  tarball next to the server binaries.
- The site is thin: an attacker who controls it gains no secret. Every check that matters
  is in Go and is tested there.
- Server rendering adds a hop (browser → site → API) to every page. It is on the same host
  or network, and the pages are small.
- The site depends on the same React and React Router versions as the app, which keeps one
  set of skills and dependencies.

## Alternatives considered

- **Pages rendered by Go (`html/template`)**: one deployable, but a second UI stack beside
  React, and none of the app's components, styles or translations could be reused.
- **A static single-page site calling the API from the browser**: no Node server, but no
  pages without JavaScript, and the session would have to be handled by browser code.
- **Moving accounts into a Node backend**: one language for the site, but the security
  logic would split between two servers, and the Go API would have to trust the other one.
