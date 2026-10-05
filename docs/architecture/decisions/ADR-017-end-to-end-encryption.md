# ADR-017: End-to-end encrypted sync

Status: accepted (2026-10-05). Amends [ADR-001](ADR-001-http-json.md) (notes travel as
`content`, an encrypted envelope, instead of `markdown`) and
[ADR-011](ADR-011-last-write-wins.md) (the server can no longer compare or merge texts; the
rule runs on the devices after decryption, as before).

## Context

Konspecter's server should be a transport, not a place that can read people's notes. A
compromised server, a database backup or an administrator must not reveal them. Notes
are already complete on every device (local-first, [ADR-003](ADR-003-local-first.md)), and
the last-write-wins rule already runs on the clients, so the server never needs the text.

## Decision

1. **Encryption is mandatory.** The server accepts a note only as an envelope
   `ksp1.<key_id>.<base64url(iv ‖ ciphertext ‖ tag)>` naming the account's current key:
   plaintext is `400 invalid_content`, no key yet is `409 encryption_required`, an old key
   is `409 key_mismatch`. The key check runs in the write's transaction under the user's
   row lock, which a reset takes too, so no note can survive under a key that is gone.
2. **One content key per account**, random AES-256-GCM, named by a random `key_id`. Each
   note is encrypted with a fresh 96-bit IV and the additional data
   `konspecter/note/v1|<noteId>`, so the server cannot swap one note's ciphertext for
   another's unnoticed.
3. **The key is stored on the server only wrapped**, twice, in `encryption_keys`:
   - with a key derived from a **passphrase that is not the sign-in password**
     (PBKDF2-SHA256, 600 000 iterations, a 16-byte salt; the parameters are stored with
     it). Signing in proves who you are; the passphrase is what opens the notes, and the
     server never sees it;
   - with a key derived from a **recovery key** shown once at setup (160 random bits in
     base32). Being random it needs no stretching, so HKDF-SHA256 derives the wrapping key.

   The wrapped forms carry `konspecter/key/v1|<key_id>` as additional data.

4. **`/api/keys`** (bearer token or session) gets, sets up and resets the key. Setting up
   works once. Changing the passphrase re-wraps the same key and must send the
   `updated_at` it read (`409 key_conflict` otherwise, with the current key). A different
   key needs a **reset** first, which deletes the key and every note on the server: the
   devices keep their notes and upload them again under the new key.
5. **The apps encrypt in one place**, `ApiClient`. Everything above it (the sync engine,
   conflict resolution, the note store) still works with plain Markdown. The content key
   is unwrapped with the passphrase and kept as a **non-extractable `CryptoKey`** in
   IndexedDB. The engine is `locked` until then: it says to set encryption up on the site,
   or asks for the passphrase. `/api/sync` reports the current `key_id`, and key changes
   wake the event streams, so a device notices a reset or a new key at once. A key it has
   not held before means everything is uploaded again (`resetSync`).
6. **The site's Encryption section runs in the browser only** (`packages/crypto` on
   WebCrypto): set up (the recovery key must be typed back before the key is stored),
   change the passphrase, set a new one with the recovery key, or reset.
7. **Upgrading deletes the plaintext notes** the server held (migration `006_e2e.sql`).
   Every device re-uploads its copy, encrypted, after unlocking. The release notes say to
   sync every device before upgrading.

## Consequences

- The server, its database and its backups hold no note text. Losing both the passphrase
  and the recovery key loses the server's copies (the devices still have theirs); there is
  no way to recover them for the person.
- **Metadata is still visible:** note ids, sizes, revision counts and timing. The server
  could also hand a device an older ciphertext of a note (rollback), which is not detected.
- The site's encryption page runs JavaScript the server serves, so a malicious server
  could serve a page that captures the passphrase. Unlocking inside the packaged apps
  (desktop, mobile), whose code does not come from the server, is the stronger path.
- Server-side search, sharing and web previews of notes are impossible by design.
  Collaboration is out of scope anyway.
- A note that fails to decrypt stops the sync cycle with an error rather than being
  skipped silently.

## Alternatives considered

- **Encrypt with a key derived from the sign-in password**: one secret, but a password
  reset would lose the data, providers' sign-ins have no password, and the server sees the
  password at sign-in.
- **Optional encryption**: two code paths and two kinds of accounts; the server would hold
  plaintext for whoever did not opt in.
- **Argon2id instead of PBKDF2**: stronger against GPUs, but not in WebCrypto. It would
  need a WebAssembly dependency in the app and the site. PBKDF2 with 600 000 iterations is
  OWASP's figure, and the stored parameters let a later version move on.
- **Per-note keys or a key per device**: finer revocation, but key distribution between
  devices becomes the hard problem, for no gain against the threat of a curious server.
