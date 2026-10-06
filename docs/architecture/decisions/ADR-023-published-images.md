# ADR-023: Published images for self-hosting

Status: accepted (2026-10-06). Amends [ADR-018](ADR-018-web-app-origin.md).

## Context

`deploy/compose.yaml` ran the whole stack (PostgreSQL, the server, the site, the web app,
Caddy), but built the images from a checkout. Running Konspecter on your own host meant
cloning the repository and building three images, Node and Go included. The web app's
image could not be shared anyway: its sync server was baked in at build time
(`VITE_KONSPECTER_SERVER_URL`, ADR-018), so each host needed a build of its own.

## Decision

1. **Every release publishes three images**, `konspecter-server`, `konspecter-site` and
   `konspecter-web`, from the existing Dockerfiles, for `linux/amd64` and `linux/arm64`:
   to GHCR (`ghcr.io/<owner>/konspecter-<name>`, `release.yml`) and to the GitLab
   project's registry (`$CI_REGISTRY_IMAGE/konspecter-<name>`, `.gitlab-ci.yml`).
   PostgreSQL and the proxy stay stock images.
2. **No emulation.** The build stages run on the build machine (`$BUILDPLATFORM`) and make
   output that is the same on every platform: static files, JavaScript, and a Go binary
   cross-compiled for `TARGETOS`/`TARGETARCH`. The final stages only copy.
3. **Tags.** A `vX.Y.Z` tag pushes `X.Y.Z`. `X.Y` and `latest` move when the release is
   published (GitHub: `images-latest.yml` on the published release; GitLab:
   `publish-images` after the manual `publish`), never for a pre-release, so a draft never
   becomes `latest`.
4. **The web app learns its server at run time.** The web image's Caddy answers
   `GET /config.json` with `{"serverUrl": "<KONSPECTER_PUBLIC_URL>"}` from the container's
   environment. The sync settings ask for it and prefill the server field, unless the owner
   has typed in it. Otherwise the build's `VITE_KONSPECTER_SERVER_URL`, which the desktop
   and mobile builds still use (they have no host to ask), then nothing.
5. **Compose pulls; an override builds.** `deploy/compose.yaml` names the images by
   `KONSPECTER_REGISTRY` and `KONSPECTER_VERSION` from `.env`. `deploy/compose.build.yaml`
   adds the builds, for development and for building from source. `deploy/.env.example`
   carries the release's version, checked by `scripts/check-versions.mjs`.
6. **A deploy bundle** per release, `konspecter-deploy-vX.Y.Z.tar.gz`: `compose.yaml`,
   `Caddyfile` and `.env.example` with the registry filled in. With Docker, that is all a
   host needs.

## Alternatives

- **One all-in-one image** (PostgreSQL, the server, the site, Caddy under a process
  supervisor, like GitLab's). One `docker run`, but a container that runs five processes,
  and PostgreSQL major upgrades inside an image (`pg_upgrade` with both versions' binaries).
  It can still be built later on these images, if people ask for it.
- **SQLite instead of PostgreSQL**, for a single binary: the server and sync are built on
  PostgreSQL (`storage/postgres`, the change sequence). Too large a change for this.
- **Templating the app's `index.html`** with the URL instead of `/config.json`: it couples
  the URL to the service worker's precached copy of the page.

## Consequences

- Self-hosting is: download the bundle, fill in `.env`, `docker compose up -d`. Upgrading is
  a new `KONSPECTER_VERSION`, `pull` and `up -d` ([self-hosting.md](../../self-hosting.md)).
- Changing the public URL restarts the `web` container instead of rebuilding its image
  (this replaces ADR-018's consequence).
- Releases push to registries: `release.yml` needs `packages: write`, GitLab's pipeline
  Docker in Docker. On GHCR, a new package is private until made public, once.
- Still two host names (ADR-018).
