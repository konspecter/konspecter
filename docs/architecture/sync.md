# Synchronization

Local-first: every read and write goes to IndexedDB, and a background engine exchanges
changes with the server whenever it can ([ADR-003](decisions/ADR-003-local-first.md)).
Sync is document- and revision-oriented. **The later edit wins**
([ADR-011](decisions/ADR-011-last-write-wins.md)), and the server tells clients when to sync
([ADR-012](decisions/ADR-012-change-events.md)).

```text
UI → NoteStore (IndexedDB) ⇄ SyncEngine ⇄ HTTP/JSON API ⇄ PostgreSQL
```

## Server side

- Every change to a user's notes (create, update, delete) takes the next value of that
  user's **change sequence** (`users.change_seq`). Taking it locks the user row until the
  transaction commits, so a user's changes commit in sequence order. A client that has seen
  change _N_ has seen everything before it: no gaps, even with concurrent writers.
- `notes.change_seq` holds the sequence number of a note's last change, and `sync_changes`
  logs every change (`seq`, `note_id`, `revision`, `operation`).
- `GET /api/sync?since=<cursor>&limit=<n>` returns the notes changed after the cursor, in
  sequence order and in their current state. Deleted notes are included as tombstones
  (`deleted_at`). It also returns the next `cursor` and whether there is `more`.
- Pushes use the note endpoints with `base_revision`. A stale base gets `409` with the
  current version, and so does creating an id that exists (see [server](server.md)). An
  update at a deleted note's revision restores it.
- `GET /api/events` streams `event: changes` on connect and after every committed change of
  the user (Server-Sent Events, no data): the client's cue to sync.

## Client side

### Bookkeeping (`sync` store, schema v5)

One entry per note (`domain/sync/sync-state.ts`):

```ts
{
  (noteId,
    baseRevision /* server revision the local copy is based on, or null */,
    dirty /* local changes not on the server */,
    deleted /* deletion queued */,
    blocked); /* null, or { reason: "conflict", remote } | { reason: "rejected", message } */
}
```

- `NoteStore.put` / `delete` (user edits) update the entry **in the same transaction** as the
  note: it becomes dirty. A note deleted before it ever reached the server is simply
  forgotten.
- **The offline queue is the set of dirty entries.** Ten offline edits to a note produce one
  upload of its latest text. There is no operation log that can grow or replay out of order.
- The sync cursor and the connection (server URL, token, account) live in `meta`.

### A sync cycle (`infrastructure/sync/sync-engine.ts`)

1. **Push** each dirty, unblocked entry:
   - never synced → `POST` (create at revision 1)
   - edited → `PUT` with `base_revision`
   - deleted → `DELETE` with `base_revision`

   On success the entry's base becomes the new revision. If the note was edited again while
   the request was in flight, it stays dirty and is pushed next time.

2. **Pull** `GET /api/sync` page by page from the saved cursor, applying each note
   (`applyRemote`), and save the cursor after every page:
   - the note is not dirty → take the server version (or delete it for a tombstone)
   - the entry already has that revision → nothing to do (our own change coming back)
   - the note is dirty **and** the server has a newer revision → **conflict**: the local
     version stays as it is for now, and the server version is stored in the entry
     (`blocked.remote`) until the end of the cycle settles it.
   - deleted on both sides → settled, the entry is removed

### Failures

| Situation                                           | Result                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `409` on push (stale base, or id exists)            | a conflict, settled at the end of the cycle                           |
| `4xx` the server will never accept (e.g. too large) | entry blocked as rejected, with the message; other notes keep syncing |
| offline (`navigator.onLine`, or fetch fails)        | state `offline`; the `online` event triggers a cycle                  |
| `5xx`, `401`, `429`, timeouts                       | state `error`, retry with backoff                                     |

Retries back off exponentially with jitter: about 2 s, 4 s, 8 s … up to 5 minutes.
A success resets the backoff.

### When cycles run

On start (if connected), 0.1 s after a local save (so another device shows an edit about half
a second after the typing pauses, and at least every second or so while it goes on), when the
browser comes back online, when
the tab becomes visible, on every change event from the server, and on "Sync now". Between
them: every minute while the change stream is open, every 10 s while it is down (or the
server has none). Only one cycle runs at a time; a request during a cycle queues one more
(one, however many arrive), and waiting for it waits for that one.

### The change stream (`infrastructure/sync/change-stream.ts`)

Opened with `fetch` (the token stays in the `Authorization` header) while connected and the
page is visible, closed while it is hidden. Each `changes` event starts a cycle, so an edit
on another device shows here within about a second. After a failure it reconnects with
backoff (about 1 s, 2 s, 4 s … up to a minute); on `404` (an older server) or `401` it stops
and polling carries on.

## Conflict resolution

A conflict is a note changed on two sides since the revision they share: a `409` on push,
or a pull that finds a newer server version of a dirty note. Conflicts are settled
automatically at the end of each cycle (`domain/sync/conflicts.ts`, applied in one
transaction by `NoteStore.applyResolution`). **The later edit wins**
([ADR-011](decisions/ADR-011-last-write-wins.md)):

| Local               | Server               | Outcome                                                                             |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| edited later        | edited               | the **local** version stays and is uploaded over the server's                       |
| edited              | edited later, or tie | the note takes the **server** version                                               |
| edited              | deleted (or missing) | **edits beat deletions**: the local version stays and restores it (or recreates it) |
| deleted             | edited               | **edits beat deletions**: the server version is restored                            |
| same text as server | —                    | settled                                                                             |
| deleted             | deleted              | settled                                                                             |

"Later" compares the versions' `updated` frontmatter dates (also read as `updated_at`),
which every save writes. A version without a date counts as the oldest, and a tie goes to
the server's version, which is already on the other devices. So an old offline edit that
uploads late loses to a newer one, whichever reached the server first. Device clocks must
be roughly right.

The version that loses is replaced everywhere and not kept: one note stays one note.

**Editing while a sync arrives:** a version from elsewhere replaces the editor's content
in place while nothing is unsaved in it: no reload, and the caret stays where it was. With unsaved text, the next save goes over it: the edit being
saved is the latest. A note deleted elsewhere while open says so, and editing it brings it
back.

Older conflict copies (made before this rule, with `conflict_of` in the frontmatter) keep
their banner and link to the original.

Tested with two and three devices editing one note concurrently, a late offline edit, edit
against delete, delete against edit, identical re-uploads after reconnecting, the change
stream, and the real server.

## File Mode

Sync covers the app library only. Folders opened in File Mode are not synced by Konspecter;
they sync with file-level tools ([ADR-009](decisions/ADR-009-file-mode-and-sync.md)).

## UI

Settings → **Sync**: connect with a server URL and an access token (from
`server create-user` / `create-token`). The token is checked with `GET /api/me`. Then the
status, last sync, waiting and held-back counts, _Sync now_ and _Disconnect_ are shown.
Connecting to a different account queues every local note for upload to it. Disconnecting
keeps all notes. The top bar shows "Sync failed" or "N not synced" when sync needs
attention, and its antenna transmits while a sync cycle runs.

## Testing

- `fake-server.ts` implements the server's rules in memory behind `fetch`, change events
  included (off by default, like an older server). The engine tests run two or three
  simulated devices against it: create, edit, delete in both directions, offline queue and
  coalescing, edits during a push, the later edit winning, rejected notes, backoff,
  reconnecting, and the change stream (events, polling while it is down, reconnecting).
- `real-server.e2e.test.ts` runs the two-device flow and the change stream against a real
  server:

  ```sh
  cd apps/server && KONSPECTER_DATABASE_URL=… go run ./cmd/server create-user -email e2e@example.com
  KONSPECTER_DATABASE_URL=… KONSPECTER_ADDR=127.0.0.1:8080 go run ./cmd/server &
  cd apps/web && KONSPECTER_E2E_URL=http://127.0.0.1:8080 KONSPECTER_E2E_TOKEN=ksp_… pnpm exec vitest run real-server
  ```

## Not yet

- The PWA syncs while the app is open. There is no service-worker Background Sync, which only
  Chromium supports and which would need the token in the service worker.
- The token is stored in IndexedDB. Secure credential storage belongs to the Security phase.
