---
name: konspecter-go
description:
  "The Go style shared by the Konspecter server (konspecter/apps/server) and the billing service
  (konspecter-billing): packages, comments, errors, HTTP handlers, PostgreSQL storage, config,
  workers and tests. Use whenever writing, changing or reviewing Go code in either repository, so
  both read as one codebase."
---

# Konspecter Go style

Both Go codebases follow the same conventions: the server in `konspecter/apps/server` (module
`konspecter/server`) and the billing service in `konspecter-billing` (module
`konspecter/billing`). Before writing code, read one or two neighbouring files and match them.
These rules sum up what those files do.

## Packages

- Packages are named for their domain: `notes`, `accounts`, `devices`, `entitlements`.
  There is never a `utils`, `common`, `helpers`, `types` or `interfaces` package.
  - Pure rules live in the domain package. I/O lives in `httpapi`, `storage/postgres` and
    adapters of outside services such as `oauth`.
  - A package appears only when it has its own responsibility. Never create an empty one.
- Interfaces are declared by the consumer, at real boundaries only: `httpapi.AccountStore`,
  `httpapi.DeviceStore`, `httpapi.NoteRepository`. One concrete type, often `*postgres.DB`,
  satisfies them all.
- No `ServiceImpl`, `RepositoryImpl`, `Mapper`, `Factory`, DI containers or service locators.
  Wiring is plain code in `cmd/<name>/main.go`.
- Each package has a doc comment that says what the package does and why, and names the ADR
  that decided it, if any: `// Package devices holds the rules for connecting apps to an
  account …`.

## Comments and names

- **Write comments as plain sentences** that say what a thing is for or why it is so. The code
  already says what it does. Short words, no jargon, no marketing.
  - Doc comments start with the name: `Allowed reports whether …`, `BearerToken returns
    …`.
  - Use `reports whether` for booleans. Use `returns … or ErrX` when there is a sentinel.
- **Comment the rule, not the mechanics.** For example: `// Revoked first: a revoked device's
  token is refused even before it expires.`
- **Spell identifiers and JSON in US English** (`canceled`, `Canceled`). Text shown to people
  is written in the server's `mail` texts and the apps' translations, not in Go comments.
- **Use short receiver names** (`a *api`, `db *DB`, `f *fakeStore`). Name constants for what
  they bound, with a comment: `// maxBodyBytes bounds a request …`.

## Errors

- **Sentinels** are package-level and lowercase: `var ErrNotFound = errors.New("note not found")`.
- **Wrap with context** as `fmt.Errorf("verb object: %w", err)`, for example
  `fmt.Errorf("read device: %w", err)`.
- **Storage translates driver errors** into domain errors:
  - `pgx.ErrNoRows` becomes `notes.ErrNotFound`, `ErrUserNotFound` or `entitlements.ErrNone`;
  - a foreign-key violation (`23503`) becomes `ErrUserNotFound`.

  Callers test them with `errors.Is`.
- **Never log and return the same error.** A handler logs once, in `internalError`, and
  answers.

## HTTP handlers (`internal/httpapi`)

- **Handlers are methods on an unexported `api` struct.** Routes are registered in one place
  with Go 1.22+ patterns: `mux.Handle("GET /api/devices", a.withSession(a.listDevices))`.
- **Middleware wraps the handler types:** `userHandler`, `deviceHandler` and `http.HandlerFunc`.
  The wrappers are named for what they ensure: `authenticated`, `withSession`, `entitled` and
  `internal`.
- **Errors are JSON:** `writeError(w, status, code, message)` writes
  `{"error": {"code": "snake_case", "message": "a sentence"}}`.
  - Codes are stable API: `unauthorized`, `unknown_user`, `slow_down`.
  - Messages say what to do: `"try again later"`.
- **Bodies are read with `decode`.** It requires `application/json`, applies
  `DisallowUnknownFields` and a `MaxBytesReader` limit, and answers `invalid_json`, `too_large`
  or `unsupported_media_type`.
- **Answers are built with `writeJSON`.** Times are UTC RFC 3339, made with `utc(t)`, and
  absent values are `null`, not omitted.
- **Internal routes check the shared token** with `crypto/subtle.ConstantTimeCompare` on the
  whole `Authorization` header.
- **Another service's word is never trusted on its own.**
  - Re-read what a webhook or callback names from that service's own API.
  - Check what is pushed (`Check()`), and keep only higher versions.

## Storage (`internal/storage/postgres`)

- **Queries are `pgx/v5` with SQL in raw strings**, written in full: no ORM and no query
  builder. Shared column lists are constants, such as `noteColumns`, read by one
  `scanX` function.
- **Several statements that must hold together run in one `pgx.BeginFunc`.** That includes a
  change and its outbox entry: events and pushes are queued in the transaction that makes the
  change.
- **Make writes idempotent** with `ON CONFLICT … DO NOTHING/UPDATE … WHERE` (unique outside
  ids, event dedupe keys, `version <` guards). Use `FOR UPDATE` row locks, and `FOR
  UPDATE SKIP LOCKED` for work several instances may pick up.
- **Check ids before comparing them with a `uuid` column**, using `validUUID(id)`. A bad id is
  "not found", not an error.
- **Migrations are `migrations/NNN_name.sql`, embedded and applied in order**, each in a
  transaction under a table lock.
  - Never edit a migration that a deployed database may have applied: add the next one.
  - Start each file with a comment saying what it is for.

## Time, config and workers

- **Code that depends on time takes `now func() time.Time`** (`Options.Now`, `Worker.Now`).
  Tests pass a fixed clock and move it. Store and send times in UTC.
- **Config is read from the environment plus an optional `.env` file**
  (`KONSPECTER_ENV_FILE`); the environment wins.
  - Variables are all `KONSPECTER_*`.
  - A `reader` collects every bad setting and `Load` returns them joined, so start-up names
    every problem at once.
  - Settings that depend on each other are checked together: a URL needs its token.
  - Every setting is listed with a comment in `.env.example`.
- **Every goroutine has an owner, a cancellation path and an error path.** A worker is
  `Run(ctx)`, which ticks until `ctx` ends, plus `Tick(ctx) error` doing one round, which tests
  call directly. `serve` owns it through a `sync.WaitGroup` and a cancelable context.
- **Use only HTTP/JSON between services**: no gRPC, Protobuf or queues.

## Tests

- **Tests live next to the code**, in the same package, and their names are sentences:
  `TestLoadReportsEveryBadSetting`, `TestTheEnvironmentWinsOverTheEnvFile`.
- **Table tests are `cases := []struct{…}`** with a `name` field when it helps. Failures read
  as `t.Errorf("%s: %v; want %v", c.name, got, want)` or `t.Errorf("thing = %+v, %v", got,
  err)`.
- **Fakes are small in-memory types implementing the consumer's interface** (`fakeAccounts`,
  `fakeMailer`), with a mutex.
  - External HTTP APIs are faked with `httptest.NewServer`: sign-in providers, the other
    service.
  - Adapters take an injectable base URL for that.
- **PostgreSQL tests run when `KONSPECTER_TEST_DATABASE_URL` is set**, each in a fresh schema
  (`openTestDB`). Locally:
  `postgres://konspecter:konspecter@localhost:55432/konspecter?sslmode=disable`.
- **Test what callers rely on:** status codes, error codes, headers, what reached the fake,
  idempotence (the same notification twice) and ordering (an older version).

## Checks

Run these in the module's root before calling work done:

```sh
gofmt -l .            # must print nothing
go vet ./...
go test -race ./...   # with KONSPECTER_TEST_DATABASE_URL for the PostgreSQL tests
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
go run github.com/google/go-licenses/v2@v2.0.1 check ./...   # new dependencies only
```

New dependencies need a license check of their whole tree. MIT, BSD-2/3-Clause, Apache-2.0
and ISC are fine; anything else needs a recorded decision (Konspecter's
`docs/license-policy.md`). Prefer the standard library: both services use only `pgx` and
`net/http`.
