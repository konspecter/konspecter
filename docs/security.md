# Security

What Konspecter protects, from whom, and how. Every item below has tests unless noted.

## Assets and threats

| Asset                                | Threats                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Notes (local and on the server)      | the server, its database or backups being read; another user reading/changing them; XSS; loss           |
| Accounts                             | password guessing, code guessing, account enumeration, CSRF, session theft, takeover through a provider |
| Device tokens                        | theft from storage or logs; guessing; reuse after a device is lost; tricking someone into approving one |
| The passphrase and the content key   | the server learning them; a stolen device; a lost passphrase                                            |
| The user's files (desktop File Mode) | the web view reaching files outside the chosen folder                                                   |
| The build                            | vulnerable or unlicensed dependencies                                                                   |

## Measures

### End-to-end encryption

([ADR-017](architecture/decisions/ADR-017-end-to-end-encryption.md))

- **The server never holds note text.** Notes are encrypted on the device with the
  account's content key (AES-256-GCM, a fresh IV per note, the note id as additional data)
  and sent as `ksp1.<key_id>.<base64url>`. The server refuses anything else, and anything
  under a key that is not the account's current one, checked in the write's transaction.
- **The key is stored only wrapped**: by a passphrase that is not the sign-in password
  (PBKDF2-SHA256, 600 000 iterations, 16-byte salt) and by a recovery key shown once
  (160 random bits, wrapped through HKDF-SHA256). The passphrase and the unwrapped key
  never reach the server. A re-wrap must name the version it read, so concurrent changes
  are never overwritten.
- **On the device** the key is a non-extractable `CryptoKey` in IndexedDB: the app's
  scripts can use it, but its bytes cannot be read back out. Disconnecting (or being
  disconnected) forgets it.
- **What it does not hide:** note ids, sizes, revision counts and timing. A server could
  hand a device an older ciphertext of a note (rollback), which is not detected.
- **Where to unlock:** the site's Encryption section runs JavaScript served by the server,
  so a malicious server could serve a page that captures the passphrase. Unlocking in the
  packaged apps (desktop, Android), whose code ships with them, is the stronger path; the
  site is needed only to set up, change or recover the passphrase.
- Losing both the passphrase and the recovery key loses the server's copies (devices keep
  theirs); a reset deletes them and starts over.

### Accounts and sessions (server)

([ADR-015](architecture/decisions/ADR-015-accounts-and-sessions.md))

- **Passwords**: argon2id (19 MiB, 2 passes), at least 8 characters. A sign-in without an
  account checks a dummy hash, so it takes as long as a real one.
- **Email codes**: 6 digits, 10 minutes, 5 wrong guesses, only the newest open code counts,
  stored as hashes bound to the address. **Reset links**: single-use, 30 minutes, end every
  other session.
- **No enumeration:** sign-in, code and reset answers are the same whether or not the
  account exists (the email says which).
- **Sessions**: an opaque 256-bit id in `__Host-ksp_session` (HttpOnly, Secure on https,
  SameSite=Lax), stored as a hash, 30 days unused. Signing out deletes it.
- **Providers**: OAuth 2.0 authorization code flow with state and PKCE (where the provider
  takes it), the flow's state in a short-lived HttpOnly cookie, one user-info call. Only an
  address the provider vouches for may reach an existing account; otherwise the visitor
  proves an address with a code first, so a provider account cannot take over someone
  else's.
- **Deleting an account** needs a sign-in within 15 minutes plus the address typed in, then
  removes everything at once and ends the account's event streams.
- **Rate limits** per client address and per email address: failed sign-ins (password,
  code, reset, wrong user codes), emails sent, and requests to connect an app. Behind a
  proxy the client address comes from `X-Forwarded-For`, believed only from
  `KONSPECTER_TRUSTED_PROXIES`.

### Devices and bearer tokens (server)

([ADR-016](architecture/decisions/ADR-016-device-authorization.md))

- **Bearer tokens**: 256-bit random, handed to an app once (the device flow, or
  `server create-user` / `create-token`), stored only as SHA-256 hashes; lookups are by hash,
  so no secret is compared in code.
- **Connecting an app**: the app gets a device code (256-bit) and shows a user code; its
  owner approves it on the site, signed in. Both are stored as hashes and expire after
  10 minutes. The approval page shows the device's name, platform and version and warns
  against approving codes one did not start.
- **Revocation**: the site disconnects a device (its token stops working and its open event
  streams end at once; its app hears `401 device_revoked` and keeps its notes).
  `DELETE /api/tokens/current` signs the calling device out;
  `server revoke-tokens -email …` disconnects every device of a user. A change stream also
  re-checks its token on every heartbeat (25 s).
- **Change streams are bounded**: at most 16 open per user (then `429`), each write has its
  own deadline, and the events carry no note data (clients fetch changes with the token as
  usual). The token is sent in the `Authorization` header, never in the URL.
- **Failed-authentication rate limit**: 30 failures per client address per minute, then `429`
  with `Retry-After`. The connection address is used; forwarded headers are not trusted.
- **Authorization**: every note query is scoped to the authenticated user (primary key
  `(user_id, id)`); users cannot read or change each other's notes, even with the same ids.

### Input validation

- Server: JSON only (`Content-Type` checked), unknown fields and trailing data rejected,
  request bodies ≤ ~7 MB, notes only as encrypted envelopes ≤ 7 MB (5 MB of text), ids
  `[A-Za-z0-9_-]{1,64}`, wrapped keys of exact sizes, names without control characters,
  header size ≤ 32 KB, read/write/idle timeouts. Redirect targets after sign-in must be
  paths on the site.
- Client: everything from storage, the network and the native side is `unknown` until parsed
  (notes, documents, sync entries, reading state, settings, API responses, file entries).
- Desktop: every file path is validated in Rust (see File Mode below).

### XSS and HTML

- Markdown is rendered to React elements, never through `innerHTML`; raw HTML is sanitized
  with GitHub's allowlist (no scripts, styles, frames, forms, event handlers or `style`
  attributes; only `http(s)`/`mailto`-style URLs; ids prefixed against DOM clobbering)
  — [reading](architecture/markdown-format.md#safe-html-handling). Tested with attack
  vectors in jsdom and in a real browser.
- **Content-Security-Policy** on the production web build (and the desktop app):
  `script-src 'self'` (no inline or remote script), `object-src 'none'`, `base-uri 'none'`,
  `form-action 'self'`. Styles allow `'unsafe-inline'` (React and CodeMirror set inline
  styles); images and `connect-src` allow any `https:`/`http:` because notes show remote
  images and sync may use any server.
- Server responses: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- The hosted web app (`apps/web/Caddyfile`, [ADR-018](architecture/decisions/ADR-018-web-app-origin.md)):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `X-Frame-Options: DENY` (a `<meta>` CSP cannot forbid framing). Its own origin keeps its
  IndexedDB and service worker apart from the site's session cookie.

### CSRF

- **The apps** authenticate with a bearer header, never cookies, so a cross-site request
  carries no credentials. CORS allows only configured origins
  (`KONSPECTER_ALLOWED_ORIGINS`), and credentialed CORS is never enabled.
- **The site** uses a session cookie, so every cookie-authenticated request that changes
  something must carry `Origin` equal to `KONSPECTER_PUBLIC_URL` (else `403
forbidden_origin`); the site's server forwards the browser's `Origin` and itself refuses
  posts from a foreign `Origin` before running any action. The cookie is SameSite=Lax.

### Filesystem permissions (desktop)

- Only the native folder picker can choose the File Mode folder or an export target; the
  web view passes relative paths only, so even injected script cannot reach other files.
- Paths are validated: no `..`, absolute or drive paths, backslashes, hidden files; `.md`
  only; the **real** path (symlinks resolved) must stay inside the folder.
- Writes are atomic and refuse to overwrite files changed on disk; deletes go to the trash.
- Tauri capabilities grant the window only `core:default`; there is no generic shell or
  filesystem plugin, and no user-configurable command (which would turn XSS into code
  execution).
- The web inspector (developer tools) cannot be opened: the window sets `devtools: false`, so
  not even development builds offer it, and release builds do not include it.

### Secure credential storage

| Client    | Where the sync token is stored (the content key is a non-extractable `CryptoKey` in IndexedDB on every client)                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop   | the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) via `keyring`; a token saved earlier in IndexedDB is moved there on start |
| Web / PWA | IndexedDB of the app's origin: readable only by the app's own scripts, which the CSP restricts to the app's files                                      |
| Android   | IndexedDB inside the app's private sandbox (not readable by other apps); a Keystore-backed plugin is a possible follow-up                              |

Disconnecting deletes the stored token and the content key.

### Dependencies

- Licenses: npm (`pnpm licenses:check`), Go (`go-licenses`), Rust (`cargo deny`) — see
  [license policy](license-policy.md).
- Known vulnerabilities, all in CI: `pnpm audit --audit-level moderate`, `govulncheck`,
  `cargo deny check advisories`. Current state: none. Findings fixed in this pass:
  `golang.org/x/text` (GO-2026-5970) upgraded; `uuid` in the Capacitor CLI's iOS tooling
  pinned to ≥ 11.1.1; `proc-macro-error` (unmaintained, build-time only) ignored with a
  recorded reason.

### Secrets

- No secrets in the repository; configuration comes from the environment or a `.env` file
  (`KONSPECTER_DATABASE_URL`, OAuth client secrets, SMTP passwords, …); `.env` files are
  ignored, only `.env.example` files are committed.
- Tokens, codes and session ids never appear in logs: request logs contain method, path,
  status and duration only. `KONSPECTER_MAIL_TRANSPORT=log` writes emails (with their codes)
  to the log and is for development only; the server warns when it is on.
- The desktop app is not code-signed yet; signing keys belong in CI secrets (release work).

## Reporting a problem

Security issues should be reported privately to the maintainer rather than in public issues.
