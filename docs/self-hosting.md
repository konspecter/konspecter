# Self-hosting

Run your own Konspecter server: the account site, sync for your apps and the web app, on
one host, from the images each release publishes. Sync on your server is free.

The stack is five containers ([ADR-023](architecture/decisions/ADR-023-published-images.md)):

| Service  | Image               | What it does                                   |
| -------- | ------------------- | ---------------------------------------------- |
| `db`     | `postgres:17`       | accounts, devices and the encrypted notes      |
| `server` | `konspecter-server` | the API (Go); migrates the database on start   |
| `site`   | `konspecter-site`   | the account site: sign-in, devices, encryption |
| `web`    | `konspecter-web`    | the web app (PWA) as static files              |
| `proxy`  | `caddy:2`           | HTTPS for both addresses, routing              |

## What you need

- A Linux host with Docker and Docker Compose, amd64 or arm64 (a VPS, a single-board
  computer, a NAS that runs containers).
- **Two DNS names** pointing at it: one for the site and the API (`notes.example.com`),
  one for the web app (`app.notes.example.com`). The web app has an origin of its own
  ([ADR-018](architecture/decisions/ADR-018-web-app-origin.md)).
- Ports 80 and 443 open: Caddy gets the certificates from Let's Encrypt by itself.
- Optional: an SMTP account, for sign-in codes and password resets by email.

## Install

1. Download `konspecter-deploy-vX.Y.Z.tar.gz` from the release and unpack it:

   ```sh
   tar -xzf konspecter-deploy-v0.1.0.tar.gz && cd konspecter-deploy-v0.1.0
   cp .env.example .env
   ```

2. Fill in `.env`. At least:
   - `KONSPECTER_SITE_ADDRESS`, `KONSPECTER_PUBLIC_URL`: the site's name, and the same as a
     URL;
   - `KONSPECTER_APP_ADDRESS`: the web app's name, and its URL in
     `KONSPECTER_ALLOWED_ORIGINS` and `KONSPECTER_DOWNLOAD_WEB_URL`;
   - `POSTGRES_PASSWORD`: a long random one (`openssl rand -hex 24`);
   - email (`KONSPECTER_SMTP_*`), or `KONSPECTER_MAIL_TRANSPORT=log` to read the sign-in
     codes from `docker compose logs server` instead.

   `KONSPECTER_VERSION` and `KONSPECTER_REGISTRY` are already set to the release.

3. Start it:

   ```sh
   docker compose up -d
   ```

Open `https://notes.example.com` to create an account, and `https://app.notes.example.com`
for the web app. The app suggests your server under Settings → Sync.

## A private server

Anyone who can reach the site can sign up while `KONSPECTER_REGISTRATION=open`. For a
server of your own or your family's, create the accounts and close it:

```sh
docker compose exec server /server create-user -email ada@example.com
```

then set `KONSPECTER_REGISTRATION=closed` in `.env` and `docker compose up -d`.

## Connecting the apps

The web app on your server suggests it by itself. In the desktop and mobile apps, enter
your site's URL under Settings → Sync and sign in with the browser, or scan the QR code the
site's settings show. The desktop and mobile apps call the API from their own origins,
which `.env.example` already allows in `KONSPECTER_ALLOWED_ORIGINS`.

## Upgrading

1. Back up (below).
2. Read the release notes (`CHANGELOG.md`): some releases need a step of their own, such as
   [the one with end-to-end encryption](release.md#upgrading-to-end-to-end-encryption).
3. Set the new `KONSPECTER_VERSION` in `.env`, then:

   ```sh
   docker compose pull && docker compose up -d
   ```

The server applies the database migrations as it starts. Compare the new release's
`compose.yaml`, `Caddyfile` and `.env.example` with yours: a release may add a setting.

Pin a version rather than `latest`: every image has `X.Y.Z`, `X.Y` (the newest patch) and
`latest` tags, and a pinned one changes only when you change it.

## Backup and restore

Everything lives in the `db` volume: accounts, devices and the notes, which the server
holds encrypted. Each device keeps its own copy of its notes too.

```sh
# Back up
docker compose exec -T db pg_dump -U konspecter -Fc konspecter > konspecter.dump

# Restore into a running stack
docker compose exec -T db pg_restore -U konspecter -d konspecter --clean --if-exists < konspecter.dump
```

Caddy's certificates are in the `caddy-data` volume; without it, Caddy gets new ones.

## Building from source

From a checkout, `deploy/compose.build.yaml` builds the three images instead of pulling
them. Leave `KONSPECTER_REGISTRY` empty in `deploy/.env`:

```sh
cd deploy && cp .env.example .env   # and fill it in
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```
