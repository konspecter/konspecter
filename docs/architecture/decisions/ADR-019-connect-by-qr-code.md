# ADR-019: Connecting an app by QR code

Status: accepted (2026-10-06). Point 5 amended by
[ADR-025](ADR-025-connect-with-key.md): a code may carry the content key.

## Context

[ADR-016](ADR-016-device-authorization.md) connects an app through the browser: the app
shows a code, its owner approves it on the site. On a phone that means typing the server's
address on a small keyboard first, then switching to the browser and back. People already
signed in on the site (usually on a computer) want to point the phone at the screen and be
done, as messaging apps do.

## Decision

1. **The site hands out a connect code.** `POST /api/devices/connect-codes` (site session,
   `Origin` checked) returns `{code, url, expires_in}`: `ksc_` + 192 random bits, stored as
   a hash in `device_connect_codes`, **one per account** (a new one replaces the old),
   **single use**, **5 minutes** (`devices.ConnectCodeTTL`).
2. **The QR code is a link:** `<public URL>/connect#ksc_…`. The site's address is the
   server the app syncs with, so nothing has to be typed. The code sits in the **fragment**:
   a phone camera that opens the link in a browser sends no secret to the server, and the
   `/connect` page only explains to scan it from the app. The site renders the QR code on
   the server (SVG, `uqr`), so it shows without JavaScript; with JavaScript, the page checks
   the device list every 3 seconds and says which app connected.
3. **The app trades it for its token:** `POST /api/devices/connect` (no auth, CORS, like
   the device flow) with the code and the app's name, platform and version answers
   `{token, device, user}` as an approved device-flow poll does. A wrong, used or expired
   code is `400 invalid_connect_code` and counts against the client address (the device
   limiter).
4. **Scanning** is in the shared UI: `getUserMedia` (back camera) and `jsqr` (loaded only
   when a scan starts), offered where a camera API exists and **not in the desktop app**
   (macOS would require a camera usage description; desktops rarely face a phone). Every
   app can also paste the link. Android declares `CAMERA` (not required to install).
5. **Encryption is unchanged.** The code connects the app to the account; the content key
   still needs the passphrase on the device ([ADR-017](ADR-017-end-to-end-encryption.md)).
   Since [ADR-025](ADR-025-connect-with-key.md), a browser that remembers the key adds it to
   the code, sealed, and the app needs no passphrase.

## Consequences

- A code on a screen can be photographed. It works once, for 5 minutes, and only after its
  owner chose to show it; the connected app appears in the device list (the page names it at
  once) and can be disconnected. It reads only ciphertext until unlocked with the
  passphrase.
- The device flow stays: it is how an app without a camera and without the site open
  connects, and how an app reconnects after being disconnected.
- Two new dependencies, both without dependencies of their own: `uqr` (MIT) on the site,
  `jsqr` (Apache-2.0) in the app.

## Alternatives considered

- **The app shows the QR code, a signed-in phone scans it** (the device flow's
  `verification_uri_complete` as a QR code): no camera code in the app, but the server's
  address must still be typed into the app, and the phone being connected is the one that
  would have to scan.
- **The code in the query string:** simpler to read, but a camera opening the link would
  send it to the server's access logs.
- **A native scanner plugin (ML Kit):** faster decoding, but Google Play services' terms and
  a second code path for the web.
