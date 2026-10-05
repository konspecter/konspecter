# ADR-016: Connecting apps through the browser (device authorization)

Status: accepted (2026-10-05)

## Context

The apps (web, desktop, mobile) sync with a bearer token. Typing a server URL and a token
issued from the command line is fine for an administrator and impossible for anyone else.
Signing in inside each app would duplicate every sign-in method (email codes, five OAuth
providers) in three shells, two of which cannot run OAuth redirects comfortably. People
also need to see which devices are connected and to disconnect one, lost or not,
**without anything being deleted on it**.

## Decision

1. **The OAuth device flow (RFC 8628), over JSON.** The app asks
   `POST /api/devices/authorize` (with its name, platform and version) and gets a device
   code to poll with and a user code (`BCDF-GHJK`: no vowels, no look-alikes, about 34
   bits). It shows the code and opens `verification_uri_complete`, the site's `/activate`
   page with the code filled in, in the system browser. The person, signed in on the site,
   compares the codes and approves or denies. The app polls `POST /api/devices/token`
   (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`) and receives
   its token once approved. Both codes are stored as hashes. Requests expire after
   `KONSPECTER_DEVICE_CODE_TTL` (10 minutes). Wrong user codes count as failed sign-ins.
2. **A token belongs to a device.** `api_tokens` became `devices`, with a name, platform,
   version, last use and last sync (each written at most once a minute). The site lists
   them, and `DELETE /api/devices/{id}` disconnects one: its token stops working, and its
   open event streams end at once through the in-process hub.
3. **A disconnected device hears why:** its row stays 30 days with `revoked_at`, so its
   next request gets `401 device_revoked` rather than a bare `unauthorized`.
4. **Disconnected is a state of the app, not a wipe.** On any `401` the sync engine moves
   to `disconnected`: it forgets the token and the content key and **keeps every note,
   every pending change and the sync bookkeeping**. Signing in again to the same account
   carries on where it stopped. Disconnecting in the app signs its token out too, so the
   device leaves the list.
5. **The command line stays** for administrators and tests (`create-user`,
   `create-token`, `revoke-tokens`): its tokens appear as "Command line token" devices.

## Consequences

- Every sign-in method works for every app, for free: the app never sees a password, a
  code sent by email, or a provider.
- The approval page is where a person can be tricked into connecting someone else's app
  (a code sent by an attacker). The page shows the device's name, platform and version, and
  warns to approve only codes started on one's own device. Codes expire quickly.
- Polling every 5 seconds for up to 10 minutes is cheap. The server tells a client that
  polls too often to slow down.

## Alternatives considered

- **Sign-in inside each app**: duplicates every flow per platform and needs custom URL
  schemes or loopback servers for OAuth redirects.
- **A redirect back to the app (custom scheme or `localhost` callback)**: no code to type,
  but fragile across platforms (the web app has no scheme, mobile intents vary) and easy to
  intercept.
- **Long-lived tokens copied from the site**: simple, but people paste secrets around, and
  the site would show a credential.
