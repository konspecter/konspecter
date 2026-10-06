# Synchronization

Local-first: every read and write goes to IndexedDB, and a background engine exchanges
changes with the server whenever it can ([ADR-003](decisions/ADR-003-local-first.md)).
Sync is document- and revision-oriented. **The later edit wins**
([ADR-011](decisions/ADR-011-last-write-wins.md)), the server tells clients when to sync
([ADR-012](decisions/ADR-012-change-events.md)), apps connect through the browser
([ADR-016](decisions/ADR-016-device-authorization.md)), and **notes are encrypted on the
device**: the server only ever holds ciphertext
([ADR-017](decisions/ADR-017-end-to-end-encryption.md)).

```text
UI → NoteStore (IndexedDB) ⇄ SyncEngine ⇄ ApiClient (encrypts, decrypts) ⇄ HTTP/JSON API ⇄ PostgreSQL
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
  (`deleted_at`). It also returns the next `cursor`, whether there is `more`, and the
  account's current `key_id`.
- Notes arrive and leave as envelopes (`content`); a write under any key but the current
  one is refused (`409 encryption_required` / `key_mismatch`).
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
- The sync cursor and the connection (server URL, token, account) live in `meta`, and so
  does the content key (`syncKey`: its id and a non-extractable `CryptoKey`). The desktop
  app keeps the token in the OS keychain instead.

### Encryption (`infrastructure/http/api-client.ts`, `packages/crypto`)

`ApiClient` is the only place notes are encrypted: with the unlocked key it sends every note
as `ksp1.<key_id>.<base64url>` (AES-256-GCM, the note id as additional data) and decrypts
every note it receives, deleted ones aside. Everything above it (the engine, conflict
resolution, the note store) works with plain Markdown, exactly as before.

- **Locked:** without the key nothing is sent or read, and the engine's state is `locked`:
  `lock: "setup"` (no key on the server: set encryption up on the site) or `"unlock"`
  (enter the passphrase). `unlock(passphrase)` fetches the wrapped key (`GET /api/keys`),
  unwraps it and stores it.
- **A new key** (the first one, or one set up after a reset) means the server's notes were
  made without this device: unlocking it runs `resetSync()`, and every local note is
  uploaded again under it. Unlocking the key the device held before carries on.
- **The key changed:** a pull whose `key_id` differs from the device's, or a push answered
  `key_mismatch` / `encryption_required`, drops the key (its id is kept) and locks. Nothing
  is held back as rejected, and the cursor does not move.

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

| Situation                                                | Result                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `409` on push (stale base, or id exists)                 | a conflict, settled at the end of the cycle                                           |
| `4xx` the server will never accept (e.g. too large)      | entry blocked as rejected, with the message; other notes keep syncing                 |
| offline (`navigator.onLine`, or fetch fails)             | state `offline`; the `online` event triggers a cycle                                  |
| `409 key_mismatch` / `encryption_required`, new `key_id` | state `locked` until the passphrase unlocks the current key                           |
| `401` (disconnected on the site, account deleted)        | state `disconnected`: token and key forgotten, **every note and pending change kept** |
| `5xx`, `429`, timeouts, a note that fails to decrypt     | state `error`, retry with backoff                                                     |

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

Settings → **Sync**:

1. **Sign in with browser** (the server URL defaults to the build's
   `VITE_KONSPECTER_SERVER_URL`): the app shows a code and opens the site's `/activate`
   page in the browser (a tab on the web, the system browser on desktop and mobile). Once
   the code is approved there, it connects. A token from `server create-token` can still
   be entered under **Advanced**.
   Or **Scan QR code** (not in the desktop app): the camera reads the code the site's
   settings show, `<site>/connect#ksc_…`, and the app trades it for its token at once; the
   site's address is the server ([ADR-019](decisions/ADR-019-connect-by-qr-code.md)). An
   app without a camera pastes the same link under **Connect with a link from the site**.
2. **Unlock**: the passphrase prompt, or, while the account has no encryption, a button to
   the site's encryption settings.
3. Then the status, last sync, waiting and held-back counts, _Sync now_ and _Disconnect_.

Connecting to a different account queues every local note for upload to it. Disconnecting
signs the device out on the server and keeps all notes. A device disconnected on the site
(or whose account was deleted) shows so, keeps everything, and offers _Sign in again_
(which carries on where it stopped) or _Stop syncing_. The top bar shows "Sync failed",
"Sync locked", "Sync stopped" or "N not synced" when sync needs attention, and its antenna
transmits while a sync cycle runs.

## Testing

- `fake-server.ts` implements the server's rules in memory behind `fetch`: change events
  (off by default, like an older server), the device flow, revoked devices and encryption.
  It makes a real key (passphrase `TEST_PASSPHRASE`) and, knowing it, keeps each note's text
  beside its envelope for tests to look at. The engine tests run two or three simulated
  devices against it: create, edit, delete in both directions, offline queue and coalescing,
  edits during a push, the later edit winning, rejected notes, backoff, reconnecting, the
  change stream, signing in with the browser, a disconnected device keeping its notes,
  ciphertext-only traffic, locking and unlocking, a wrong passphrase, and a reset or a new
  key re-uploading everything.
- `real-server.e2e.test.ts` runs the two-device flow and the change stream against a real
  server. It sets encryption up when the account has none (`KONSPECTER_E2E_PASSPHRASE`,
  with a default) and unlocks:

  ```sh
  cd apps/server && KONSPECTER_DATABASE_URL=… go run ./cmd/server create-user -email e2e@example.com
  KONSPECTER_DATABASE_URL=… KONSPECTER_ADDR=127.0.0.1:8080 go run ./cmd/server &
  cd apps/web && KONSPECTER_E2E_URL=http://127.0.0.1:8080 KONSPECTER_E2E_TOKEN=ksp_… pnpm exec vitest run real-server
  ```

## Not yet

- The PWA syncs while the app is open. There is no service-worker Background Sync, which only
  Chromium supports and which would need the token in the service worker.
- Metadata (note ids, sizes, timing) is visible to the server, and a rollback to an older
  ciphertext of a note is not detected ([ADR-017](decisions/ADR-017-end-to-end-encryption.md)).
