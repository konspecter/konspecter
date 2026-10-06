# Server

A single Go binary (`apps/server/`), stdlib `net/http`, PostgreSQL via `pgx`. It is a JSON
API ([ADR-001](decisions/ADR-001-http-json.md),
[ADR-005](decisions/ADR-005-domain-oriented-packages.md)) with three jobs:

- store each account's notes, **encrypted on the devices**, with revisions for sync
  ([ADR-017](decisions/ADR-017-end-to-end-encryption.md));
- sign people in on the account site ([ADR-014](decisions/ADR-014-account-site.md),
  [ADR-015](decisions/ADR-015-accounts-and-sessions.md));
- connect their apps as devices ([ADR-016](decisions/ADR-016-device-authorization.md)).

All security logic lives here. The site (`apps/site`) only renders pages and calls this API
on the visitor's behalf.

## Packages

```text
apps/server/
├── cmd/server/             entry point: serve, migrate, create-user, create-token, revoke-tokens
├── internal/config/        typed settings from the environment and .env
├── internal/notes/         Note, ids, the encrypted envelope (ParseEnvelope), errors
├── internal/keys/          an account's wrapped content key and its validation
├── internal/auth/          User, Device, Session; API tokens and bearer header parsing
├── internal/accounts/      passwords (argon2id), email codes, reset tokens, identities, names
├── internal/devices/       device codes and user codes (RFC 8628), connect codes, app descriptions
├── internal/oauth/         sign-in providers (Google, LinkedIn, X, Yandex ID, VK ID)
├── internal/mail/          the mailer (SMTP or log) and the emails in English and Russian:
│                            plain text and HTML (letter.html, the logo inline by Content-ID)
├── internal/httpapi/       HTTP/JSON handlers, sessions, rate limits, event streams;
│                           declares the interfaces it consumes
├── internal/storage/postgres/  users, sessions, devices, keys, notes, migration runner
└── migrations/             ordered SQL files, embedded into the binary
```

`httpapi` defines the interfaces it consumes: `NoteRepository` (notes and keys),
`Authenticator` (bearer tokens to devices), `AccountStore`, `DeviceStore` and `Mailer`. The
PostgreSQL `DB` satisfies all the storage ones, and handler tests use in-memory fakes.

## Data model

| Table                   | Holds                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `users`                 | `id`, `email` (unique, lowercase, always verified), `password_hash`, `display_name`, `change_seq`      |
| `sessions`              | a signed-in browser: `id_hash`, `user_id`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`    |
| `email_codes`           | one-time sign-in codes: `code_hash`, attempts, expiry, an optional password hash and identity to link  |
| `password_resets`       | single-use reset links: `token_hash`, `user_id`, expiry                                                |
| `user_identities`       | `(provider, subject)` linked to a user                                                                 |
| `pending_identities`    | a provider sign-in waiting for its owner to prove an address (30 minutes)                              |
| `devices`               | a connected app: `id`, `token_hash` (unique), name, platform, version, last use and sync, `revoked_at` |
| `device_authorizations` | an app waiting for approval: both codes' hashes, its description, status, expiry, last poll            |
| `device_connect_codes`  | a code the site shows as a QR code: `code_hash`, `user_id` (unique: one per account), expiry           |
| `encryption_keys`       | the account's content key, wrapped: `key_id`, `kdf`, `kdf_params`, `salt`, `wrapped_key`, `recovery_…` |
| `notes`                 | `(user_id, id)`, `content` (envelope), `key_id`, `revision`, timestamps, `deleted_at`, `change_seq`    |
| `sync_changes`          | the change log: `(user_id, seq)`, `note_id`, `revision`, `operation`                                   |

Every secret (session ids, codes, reset tokens, API tokens, device, user and connect codes) is stored
as a SHA-256 hash only.

- **Note ids are chosen by clients** (UUIDs), because local-first clients create notes
  offline. They are unique per user.
- **Revisions** start at 1 and increase by one with every change, including deletion.
- **Deletion is soft:** `deleted_at` is set and the content is kept.
- **The server cannot read a note.** It checks the envelope's shape and that it names the
  account's current key, in the same transaction as the write.
- Migrations run in file order, each in a transaction under a table lock (safe with several
  instances), and are recorded in `schema_migrations`. `serve` migrates on start.
  `006_e2e.sql` deletes the notes stored in plain text before encryption (see
  [release](../release.md#upgrading-to-end-to-end-encryption)).

## Authentication

- **Apps** send `Authorization: Bearer ksp_…`. A token belongs to a device (`auth.Device`:
  the device id and its user). A disconnected device gets `401 device_revoked`, an unknown
  token `401 unauthorized`. Failed authentication is rate-limited per client address.
- **Browsers** (the site) carry the session cookie `__Host-ksp_session` (`ksp_session` on
  plain http). Requests that change something must come with `Origin` equal to
  `KONSPECTER_PUBLIC_URL`.
- **Each route declares what it accepts:** notes and sync a bearer token, the account and
  the device list a session, `/api/me` and `/api/keys` either.
- Sign-in on the site is on only when `KONSPECTER_PUBLIC_URL` is set. Without it the
  account routes answer `503 not_configured`, and apps still work with command-line tokens.

## API

JSON in and out. Request bodies must be `application/json`, are limited to about 7 MB, and
may not contain unknown fields. Errors look like `{"error": {"code": "…", "message": "…"}}`.

### Notes and sync (bearer token)

| Method & path                | Body / query                 | Success                                                   | Errors                                                |
| ---------------------------- | ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `GET /healthz`               | (no auth)                    | 200                                                       |                                                       |
| `GET /api/notes`             |                              | 200 `{notes: [...]}` (not deleted)                        | 401                                                   |
| `GET /api/notes/{id}`        |                              | 200 note                                                  | 404                                                   |
| `POST /api/notes`            | `{id, content}`              | 201 note, `Location`                                      | 400, 409 `revision_conflict` (id taken), 409 key (\*) |
| `PUT /api/notes/{id}`        | `{content, base_revision}`   | 200 note (restores a deleted note at its revision)        | 404, 409 `revision_conflict`, 409 key (\*)            |
| `DELETE /api/notes/{id}`     | `?base_revision=N`           | 204                                                       | 404, 409 `revision_conflict`                          |
| `GET /api/sync`              | `?since=cursor&limit=1..500` | 200 `{notes, cursor, more, key_id}` (tombstones included) | 400                                                   |
| `GET /api/events`            |                              | 200 `text/event-stream` (see below)                       | 401, 429 `too_many_streams`, 503                      |
| `DELETE /api/tokens/current` |                              | 204 (this device signs out and leaves the account's list) | 401                                                   |

A note is `{id, content, revision, created_at, updated_at, deleted_at?}`, where `content` is
the envelope `ksp1.<key_id>.<base64url>`. (\*) Content that is not an envelope is
`400 invalid_content`; without a key it is `409 encryption_required`; under another key
`409 key_mismatch`. `key_id` in `/api/sync` is the account's current key (`null` without
one), so a device holding another key knows to unlock the new one.

**Optimistic concurrency:** `PUT` and `DELETE` apply only if the note is still at
`base_revision`. Otherwise the response is `409` with `"current"`: the server's version, so
the client can reconcile without overwriting anything. `POST` with an id that is taken (by
a live or a deleted note) is the same `409` with `"current"`. A `PUT` at a deleted note's
current revision restores it (edits beat deletions); deleting a deleted note is a
conflict. Of concurrent writers with the same base revision, exactly one wins (tested with
8 in parallel).

### The content key (bearer token or session)

| Method & path      | Body                                                                                            | Success                     | Errors                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| `GET /api/keys`    |                                                                                                 | 200 key                     | 404 `no_key`                                              |
| `PUT /api/keys`    | `{key_id, kdf, kdf_params: {iterations}, salt, wrapped_key, recovery_wrapped_key, updated_at?}` | 200 key                     | 400 `invalid_key`, 404, 409 `key_conflict` with `current` |
| `DELETE /api/keys` |                                                                                                 | 204 (key and notes deleted) |                                                           |

Without `updated_at` a PUT sets up the first key (a second one is a conflict). With the
`updated_at` it read, it re-wraps the current key for a new passphrase. A new `key_id`
needs a reset (`DELETE`) first. See [ADR-017](decisions/ADR-017-end-to-end-encryption.md).

### Sign-in (the site; session cookie, `Origin` checked)

| Method & path                         | Purpose                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/auth/code`                 | email a sign-in code (creates the account when proven; a password goes too) |
| `POST /api/auth/code/verify`          | prove the code: signs in                                                    |
| `POST /api/auth/login`                | sign in with email and password                                             |
| `POST /api/auth/logout`               | end the session                                                             |
| `POST /api/auth/password/forgot`      | email a reset link                                                          |
| `POST /api/auth/password/reset`       | set a new password with the link's token; ends the other sessions           |
| `GET /api/auth/providers?locale=`     | the providers the site offers in a language                                 |
| `GET /api/auth/{provider}/start`      | redirect to the provider (state and PKCE in a short-lived cookie)           |
| `GET /api/auth/{provider}/callback`   | back from the provider: signs in, or redirects to `/complete`               |
| `GET`, `POST /api/auth/complete`      | the pending provider sign-in; email a code that links it                    |
| `GET /api/me`                         | `{id, email, name}` (also with a bearer token)                              |
| `GET`, `PATCH`, `DELETE /api/account` | the account (`recent_sign_in`), rename, delete (recent sign-in + address)   |

Answers never reveal whether an account exists.

### Devices

| Method & path                         | Auth    | Purpose                                                                                                           |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /api/devices/authorize`         | none    | an app asks to be connected: `{device_code, user_code, verification_uri(_complete), expires_in, interval}`        |
| `POST /api/devices/token`             | none    | the app polls: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, or `{token, device, user}` |
| `GET /api/devices/pending?user_code=` | session | the app waiting under a code, for `/activate`                                                                     |
| `POST /api/devices/approve`, `/deny`  | session | decide                                                                                                            |
| `POST /api/devices/connect-codes`     | session | a code to show as a QR code ([ADR-019](decisions/ADR-019-connect-by-qr-code.md)): `{code, url, expires_in}`       |
| `POST /api/devices/connect`           | none    | an app trades a scanned code for `{token, device, user}`; else `400 invalid_connect_code`                         |
| `GET /api/devices`                    | session | the connected devices, most recently active first                                                                 |
| `DELETE /api/devices/{id}`            | session | disconnect: the token stops working and its streams end at once                                                   |

## Change events

`GET /api/events` is a Server-Sent Events stream
([ADR-012](decisions/ADR-012-change-events.md)) that tells the user's clients when to sync;
the data still comes from `GET /api/sync`. Authenticated like every `/api/*` call, so
browsers read it with `fetch` (the token stays in the header). Headers:
`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`.

```text
event: changes
data: {}

: ping

```

`changes` is sent on connect, after each committed change of the user's notes, and after a
key is set up, re-wrapped or reset; bursts may coalesce into one. `: ping` is a heartbeat
comment every 25 s.

- **In-process hub:** each stream has a one-slot buffer; handlers publish after the
  repository has committed, without blocking. One server binary, so no broker.
- **Ending streams:** disconnecting a device ends its streams at once, and deleting the
  account ends all of the user's. On each heartbeat the token is also resolved again, which
  catches a revocation from the command line.
- **Limit:** at most 16 open streams per user; more get `429 too_many_streams`.
- **Deadlines:** each write sets its own one-minute write deadline, so the server's 30 s
  `WriteTimeout` does not end the stream.
- **Shutdown:** `serve` registers `Handler.CloseStreams` with `RegisterOnShutdown`: open
  streams end and new ones get `503 shutting_down`.

## CORS

The apps on other origins must be listed in `KONSPECTER_ALLOWED_ORIGINS`. Allowed origins
get `Access-Control-Allow-Origin` and preflight answers for `Authorization` and
`Content-Type`. Credentials are bearer tokens, never cookies. The Android app's origin is
`https://localhost`, and the desktop app's is `tauri://localhost` (macOS) or
`http://tauri.localhost` (Windows). The site shares the API's origin and needs no CORS.

## Configuration and running

Every setting comes from the environment, or from a `.env` file
(`KONSPECTER_ENV_FILE`, default `./.env`); the environment wins. `apps/server/.env.example`
lists them all:

| Variables                                                                                 | Purpose                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `KONSPECTER_DATABASE_URL`, `KONSPECTER_ADDR`, `KONSPECTER_ALLOWED_ORIGINS`                | database, listen address, app origins (CORS)     |
| `KONSPECTER_PUBLIC_URL`                                                                   | the site's origin; turns sign-in on              |
| `KONSPECTER_REGISTRATION`                                                                 | `open` or `closed`                               |
| `KONSPECTER_SESSION_TTL`, `_EMAIL_CODE_TTL`, `_PASSWORD_RESET_TTL`, `_DEVICE_CODE_TTL`    | lifetimes                                        |
| `KONSPECTER_MAIL_TRANSPORT` (`smtp`, `log`), `KONSPECTER_SMTP_*`                          | email                                            |
| `KONSPECTER_OAUTH_<GOOGLE\|LINKEDIN\|X\|YANDEX\|VK>_CLIENT_ID/_SECRET`                    | sign-in providers (on when both are set)         |
| `KONSPECTER_LOGIN_PROVIDERS_EN`, `_RU`                                                    | the providers shown per language                 |
| `KONSPECTER_TRUSTED_PROXIES`                                                              | proxies whose `X-Forwarded-For` names the client |
| `KONSPECTER_RATE_LOGIN_PER_IP/_PER_EMAIL`, `_EMAIL_PER_ADDRESS/_PER_IP`, `_DEVICE_PER_IP` | abuse limits                                     |

```sh
KONSPECTER_DATABASE_URL=postgres://… ./server            # migrate + serve on :8080
./server create-user -email ada@example.com               # prints a token (a "Command line token" device)
./server revoke-tokens -email ada@example.com             # disconnect every device of a user
```

The whole stack (PostgreSQL, this server, the site and Caddy on one origin, plus the web app
on its own address) is `deploy/compose.yaml`. The server shuts down gracefully on SIGINT/SIGTERM and has read,
write and idle timeouts.

## Tests

- Unit and handler tests need nothing. OAuth runs against a fake provider (`httptest`).
- PostgreSQL tests run when `KONSPECTER_TEST_DATABASE_URL` is set. Each test gets its own
  schema. CI provides a PostgreSQL service. Locally:

  ```sh
  docker run -d --name konspecter-test-pg -e POSTGRES_USER=konspecter \
    -e POSTGRES_PASSWORD=konspecter -e POSTGRES_DB=konspecter -p 55432:5432 postgres:17-alpine
  export KONSPECTER_TEST_DATABASE_URL="postgres://konspecter:konspecter@localhost:55432/konspecter?sslmode=disable"
  ```
