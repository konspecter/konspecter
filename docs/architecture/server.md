# Server

A single Go binary (`apps/server/`), stdlib `net/http`, PostgreSQL via `pgx`. It stores
the user's Markdown documents with revisions so clients can sync
([ADR-001](decisions/ADR-001-http-json.md), [ADR-005](decisions/ADR-005-domain-oriented-packages.md)).

## Packages

```text
apps/server/
├── cmd/server/             entry point: serve, migrate, create-user, create-token
├── internal/notes/         Note, validation, ErrNotFound / ConflictError
├── internal/auth/          User, API tokens (generate, hash, parse bearer header), email
├── internal/httpapi/       HTTP/JSON handlers, change event streams; declares the interfaces it consumes
├── internal/storage/postgres/  users, tokens, notes, migration runner
└── migrations/             ordered SQL files, embedded into the binary
```

`httpapi` defines `NoteRepository` and `Authenticator` (consumer-side interfaces). The
PostgreSQL `DB` satisfies both, and handler tests use in-memory fakes. (The plan's
`internal/http` is named `httpapi` so it does not shadow `net/http`.)

## Data model

| Table          | Columns                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `users`        | `id` (uuid), `email` (unique, lowercase), `created_at`                                                      |
| `api_tokens`   | `token_hash` (SHA-256, primary key), `user_id`, `created_at`, `last_used_at`                                |
| `notes`        | `(user_id, id)` primary key, `markdown`, `revision`, `created_at`, `updated_at`, `deleted_at`, `change_seq` |
| `sync_changes` | `(user_id, seq)` primary key, `note_id`, `revision`, `operation`, `created_at`                              |

`users.change_seq` is the per-user change sequence (see [sync](sync.md)).

- **Ids are chosen by clients** (UUIDs), because local-first clients create notes offline.
  They are unique per user.
- **Revisions** start at 1 and increase by one with every change, including deletion.
- **Deletion is soft:** `deleted_at` is set and the Markdown is kept, so no version is
  lost.
- Migrations run in file order, each in a transaction under a table lock (safe with several
  instances), and are recorded in `schema_migrations`. `serve` migrates on start.

## Authentication (foundation)

Requests to `/api/*` need `Authorization: Bearer ksp_…`. Tokens are 256-bit random secrets
shown once by `server create-user -email …` or `server create-token -email …`. Only their
SHA-256 hashes are stored. Tokens can be revoked (see [security](../security.md)), and failed
authentication is rate-limited. There is no password or browser sign-in yet. Because authentication uses a
header, not cookies, the API is not exposed to CSRF.

## API

JSON in and out. Request bodies must be `application/json`, are limited to about 10 MB, and
may not contain unknown fields. Errors look like `{"error": {"code": "…", "message": "…"}}`.

| Method & path                | Body / query                 | Success                                            | Errors                                  |
| ---------------------------- | ---------------------------- | -------------------------------------------------- | --------------------------------------- |
| `GET /healthz`               | (no auth)                    | 200                                                |                                         |
| `GET /api/me`                |                              | 200 `{id, email}`                                  | 401                                     |
| `GET /api/notes`             |                              | 200 `{notes: [...]}` (not deleted)                 | 401                                     |
| `GET /api/notes/{id}`        |                              | 200 note                                           | 404                                     |
| `POST /api/notes`            | `{id, markdown}`             | 201 note, `Location`                               | 400, 409 `revision_conflict` (id taken) |
| `PUT /api/notes/{id}`        | `{markdown, base_revision}`  | 200 note (restores a deleted note at its revision) | 404, 409 `revision_conflict`            |
| `DELETE /api/notes/{id}`     | `?base_revision=N`           | 204                                                | 404, 409 `revision_conflict`            |
| `GET /api/sync`              | `?since=cursor&limit=1..500` | 200 `{notes, cursor, more}` (tombstones included)  | 400                                     |
| `GET /api/events`            |                              | 200 `text/event-stream` (see below)                | 401, 429 `too_many_streams`, 503        |
| `DELETE /api/tokens/current` |                              | 204 (this token stops working)                     | 401                                     |

A note is `{id, markdown, revision, created_at, updated_at, deleted_at?}`.

**Optimistic concurrency:** `PUT` and `DELETE` apply only if the note is still at
`base_revision`. Otherwise the response is `409` with `"current"`: the server's version, so
the client can reconcile without overwriting anything. `POST` with an id that is taken (by
a live or a deleted note) is the same `409` with `"current"`. A `PUT` at a deleted note's
current revision restores it (edits beat deletions); deleting a deleted note is a
conflict, and `current.deleted_at` shows why. Of concurrent writers with the same base
revision, exactly one wins (tested with 8 in parallel).

## Change events

`GET /api/events` is a Server-Sent Events stream
([ADR-012](decisions/ADR-012-change-events.md)) that tells the user's clients when to sync; the data still comes from `GET /api/sync`. Authenticated like every `/api/*` call,
so browsers read it with `fetch` (the token stays in the header). Headers:
`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`.

```text
event: changes
data: {}

: ping

```

`changes` is sent on connect and after each committed create, update (restore) or delete of
the user's notes, by any connection; bursts may coalesce into one. `: ping` is a heartbeat
comment every 25 s.

- **In-process hub:** each stream has a one-slot buffer; handlers publish after the
  repository has committed, without blocking. One server binary, so no broker.
- **Token re-check:** on each heartbeat the token is resolved again; a revoked token ends
  the stream.
- **Limit:** at most 16 open streams per user; more get `429 too_many_streams`.
- **Deadlines:** each write sets its own one-minute write deadline, so the server's 30 s
  `WriteTimeout` does not end the stream. The stream ends when the client leaves or a write
  fails.
- **Shutdown:** `serve` registers `Handler.CloseStreams` with `RegisterOnShutdown`: open
  streams end and new ones get `503 shutting_down`, so graceful shutdown does not wait for
  them.

## CORS

Browser clients on other origins must be listed in `KONSPECTER_ALLOWED_ORIGINS`. Allowed
origins get `Access-Control-Allow-Origin` and preflight answers for `Authorization` and
`Content-Type`. Credentials are bearer tokens, never cookies. The Android app's origin is
`https://localhost`, and the desktop app's is `tauri://localhost` (macOS) or
`http://tauri.localhost` (Windows).

## Configuration and running

```sh
KONSPECTER_DATABASE_URL=postgres://… ./server            # migrate + serve on :8080
KONSPECTER_ADDR=127.0.0.1:9000 …                          # other listen address
KONSPECTER_ALLOWED_ORIGINS=https://notes.example.com …    # browser origins allowed (CORS)
./server create-user -email ada@example.com               # prints a token
```

The server shuts down gracefully on SIGINT/SIGTERM and has read, write and idle timeouts.

## Tests

- Unit and handler tests need nothing.
- PostgreSQL tests run when `KONSPECTER_TEST_DATABASE_URL` is set. Each test gets its own
  schema. CI provides a PostgreSQL service. Locally:

  ```sh
  docker run -d --name konspecter-test-pg -e POSTGRES_USER=konspecter \
    -e POSTGRES_PASSWORD=konspecter -e POSTGRES_DB=konspecter -p 55432:5432 postgres:17-alpine
  export KONSPECTER_TEST_DATABASE_URL="postgres://konspecter:konspecter@localhost:55432/konspecter?sslmode=disable"
  ```
