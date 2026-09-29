# Security

What Konspecter protects, from whom, and how. Every item below has tests unless noted.

## Assets and threats

| Asset                                | Threats                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Notes (local and on the server)      | another user reading/changing them; malicious note content (XSS); loss through bugs or conflicts |
| Access tokens                        | theft from storage or logs; guessing; reuse after compromise                                     |
| The user's files (desktop File Mode) | the web view reaching files outside the chosen folder                                            |
| The build                            | vulnerable or unlicensed dependencies                                                            |

## Measures

### Authentication and authorization (server)

- **Bearer tokens**: 256-bit random, shown once (`server create-user` / `create-token`),
  stored only as SHA-256 hashes; lookups are by hash, so no secret is compared in code.
- **Revocation**: `DELETE /api/tokens/current` signs the calling token out;
  `server revoke-tokens -email …` revokes every token of a user after a compromise.
- **Failed-authentication rate limit**: 30 failures per client address per minute, then `429`
  with `Retry-After`. The connection address is used; forwarded headers are not trusted.
- **Authorization**: every note query is scoped to the authenticated user (primary key
  `(user_id, id)`); users cannot read or change each other's notes, even with the same ids.
- No passwords or browser sessions exist yet; a sign-in flow (e.g. email links or OAuth) is a
  separate decision.

### Input validation

- Server: JSON only (`Content-Type` checked), unknown fields and trailing data rejected,
  request bodies ≤ ~10 MB, notes ≤ 5 MB and valid UTF-8, ids `[A-Za-z0-9_-]{1,64}`, header
  size ≤ 32 KB, read/write/idle timeouts.
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

### CSRF

Not applicable by design: the API authenticates with a bearer header, never cookies, so a
cross-site request carries no credentials. CORS allows only configured origins
(`KONSPECTER_ALLOWED_ORIGINS`), and credentialed CORS is never enabled.

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

| Client    | Where the sync token is stored                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop   | the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) via `keyring`; a token saved earlier in IndexedDB is moved there on start |
| Web / PWA | IndexedDB of the app's origin: readable only by the app's own scripts, which the CSP restricts to the app's files                                      |
| Android   | IndexedDB inside the app's private sandbox (not readable by other apps); a Keystore-backed plugin is a possible follow-up                              |

Disconnecting deletes the stored token.

### Dependencies

- Licenses: npm (`pnpm licenses:check`), Go (`go-licenses`), Rust (`cargo deny`) — see
  [license policy](license-policy.md).
- Known vulnerabilities, all in CI: `pnpm audit --audit-level moderate`, `govulncheck`,
  `cargo deny check advisories`. Current state: none. Findings fixed in this pass:
  `golang.org/x/text` (GO-2026-5970) upgraded; `uuid` in the Capacitor CLI's iOS tooling
  pinned to ≥ 11.1.1; `proc-macro-error` (unmaintained, build-time only) ignored with a
  recorded reason.

### Secrets

- No secrets in the repository; configuration comes from the environment
  (`KONSPECTER_DATABASE_URL`, …); `.env` files are ignored.
- Tokens never appear in logs: request logs contain method, path, status and duration only.
- The desktop app is not code-signed yet; signing keys belong in CI secrets (release work).

## Reporting a problem

Security issues should be reported privately to the maintainer rather than in public issues.
