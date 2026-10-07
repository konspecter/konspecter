# ADR-025: The QR code hands the key over

Status: accepted (2026-10-07). Amends [ADR-019](ADR-019-connect-by-qr-code.md) (point 5:
the code may carry the content key) and adds to [ADR-017](ADR-017-end-to-end-encryption.md).

## Context

A QR code from the site already connects an app without anyone approving it (ADR-019). The
app then asks for the encryption passphrase, because the content key is only on devices
that unlocked it, never on the server or the site (ADR-017). People see two steps for one
intent: "I scanned the code in my signed-in account, so why the password?" Typing a long
passphrase on a phone is the worst part of connecting it.

## Decision

1. **A browser may remember the content key** (`apps/site/app/remembered-key.ts`):
   IndexedDB, one entry `{account, keyId, key}` for the signed-in account's email. It is
   remembered where the passphrase or the recovery key opens the key on the site (setting
   encryption up, changing or recovering the passphrase), or after the owner enters the
   passphrase once under Encryption → _Connect apps without the passphrase_. It is forgotten
   with _Forget on this browser_, on sign-out, on deleting the account, on a reset, and
   when the server's key (or the account) is another one.
2. **The code carries the key sealed with a one-time secret.** Showing a QR code, the
   browser makes 32 random bytes `S` and seals the key with a key derived from them
   (HKDF-SHA256, info `konspecter/transfer/v1`, AES-256-GCM, additional data
   `konspecter/transfer/v1|<key_id>`). `POST /api/devices/connect-codes` takes the sealed
   key (`{key_id, sealed_key}`, optional) and stores it with the code; `S` is added to the
   link's fragment in the browser: `<site>/connect#ksc_<code>.<S>`. Neither the server nor
   the site's own server code ever sees `S`.
3. **Redeeming the code hands the sealed key over once:** `POST /api/devices/connect`
   answers `key: {key_id, sealed_key}` (or `null`) and deletes it with the code.
4. **The app opens it with `S`** and stores it as unlocking does (a non-extractable
   `CryptoKey`), before its first sync: nothing is typed. A key that does not open, or is no
   longer the account's, leaves sync locked, and the passphrase unlocks it as before.
5. Without a remembered key, or without JavaScript on the site, the code is as before and
   the app asks for the passphrase. The device flow (_Sign in with browser_) is unchanged.

## Consequences

- Connecting a phone is one scan. The passphrase is typed on a computer, at most once per
  browser.
- **A code that carries the key is worth more.** Within its 5 minutes and before it is used,
  a photo of it gives an app that reads the notes, not just one that syncs ciphertext. It is
  still shown only on request, works once, and the device that used it shows in the list at
  once. The site says so next to the code.
- After use or expiry the link is worthless: the sealed key went with the code, and `S`
  alone opens nothing.
- **Whoever can use a signed-in browser that remembers the key can connect an app that reads
  the notes.** That is the trade-off chosen; the site says to remember the key only on one's
  own computer, and _Forget on this browser_ and signing out undo it.
- The key lies in the browser's profile as an extractable key, and the site's JavaScript,
  served by the server, can read it. A malicious server could already capture the
  passphrase typed into the site (ADR-017); the packaged apps remain the stronger path.
- Apps older than this change do not read the longer fragment and call the link not a
  connect link; a code shown without a remembered key works with them.

## Alternatives considered

- **The passphrase on the site for each code:** nothing stored in the browser, but a
  passphrase typed every time, and the question "why a password?" stays.
- **An unlocked device approves the new one** (key exchange through the server): no key in
  the browser, but the server relays the public keys and could put its own in; preventing
  that needs a comparison code on both screens, which is the step this decision removes.
- **The key itself in the fragment:** no server storage, but a photo of the code would give
  the key for good, not for five minutes.
