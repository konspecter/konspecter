# ADR-012: Change events over Server-Sent Events

Status: accepted (2026-09-29)

## Context

With the last write winning ([ADR-011](ADR-011-last-write-wins.md)), a note open on one
device should show an edit made on another within a moment. Clients synced once a minute,
or when a tab became visible, so an open note could lag by up to a minute.

## Decision

1. The server offers `GET /api/events`: a Server-Sent Events stream for the authenticated
   user. It sends `event: changes` once on connect and after each committed change of the
   user's notes, and a heartbeat comment every 25 s. The events carry no data: clients run
   their normal sync cycle (`GET /api/sync`), which stays the only way changes travel.
2. Clients read it with `fetch`, so the token stays in the `Authorization` header (the
   browser's `EventSource` cannot send headers, and a token in the URL would end up in
   logs). The stream is open while the app is visible and connected; while it is down,
   clients poll every 10 s, and once a minute while it is up.
3. The server fans events out in process (one binary). It re-checks the token on each
   heartbeat, allows 16 streams per user, sets a deadline per write, and closes the streams
   on shutdown.

This stays within [ADR-001](ADR-001-http-json.md): plain HTTP, JSON for everything that
carries data.

## Consequences

- An edit reaches the other devices in about a second: the pusher's upload, one event, one
  incremental pull.
- One open connection per visible client. Reverse proxies must not buffer the response
  (`X-Accel-Buffering: no` is sent for nginx) and should allow long reads.
- Several server instances would need a shared notifier (for example PostgreSQL
  `LISTEN/NOTIFY`); until then events reach only the clients of the instance that took the
  change, and the others learn at their next poll.
- A device also receives the event for its own upload, and runs one extra, empty pull.

## Alternatives considered

- **WebSockets**: two-way, which sync does not need (uploads are ordinary requests). It
  needs a library, cannot send an `Authorization` header from the browser, and is harder
  to proxy and debug than a plain HTTP response.
- **Long polling** (`GET /api/sync?wait=30`): similar, but a request per change and more
  bookkeeping on both sides.
- **Polling every few seconds**: no server change, but a delay of up to the interval and
  many empty requests.
