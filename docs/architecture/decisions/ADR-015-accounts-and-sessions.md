# ADR-015: Accounts and browser sessions

Status: accepted (2026-10-05). Extends [ADR-001](ADR-001-http-json.md): the API now also
authenticates browsers, with a cookie.

## Context

The account site ([ADR-014](ADR-014-account-site.md)) needs people to sign up and sign in
on their own: with an email address (a password or a one-time code, and a way back when the
password is forgotten), or with another service. That is Google, LinkedIn or X for English
speakers, and Yandex ID or VK ID for Russian speakers. Browsers need a session; apps keep
their bearer tokens.

## Decision

1. **Every account has a verified email address.** It is proven by an email code, a reset
   link, or a provider that vouches for it (Google, LinkedIn with `email_verified`, Yandex).
   A provider that gives no verified address (X, VK) creates no account. Its sign-in waits
   in `pending_identities` (30 minutes, a `ksp_link` cookie) until the visitor proves an
   address with a code, which then links the provider to that address's account. So
   resets, deletion confirmations and linking always have an address to rely on, and no two
   accounts ever need merging.
2. **Email sign-in** through one form with two ways in: a password (argon2id, OWASP
   parameters), or a 6-digit code (10 minutes, 5 attempts, only the newest counts) that
   also creates the account when there is none. A password sent with the code request
   becomes the account's password. A forgotten password is reset by a single-use link
   (30 minutes) that ends every other session. Answers never reveal whether an account
   exists.
3. **Other services through OAuth 2.0**, with `golang.org/x/oauth2`, state and PKCE (where
   the provider takes it), and one user-info call. No ID-token or JWT library. The flow's
   state lives in a short-lived HttpOnly cookie (`ksp_oauth`, path `/api/auth/`). The
   providers shown depend on the visitor's language and the configuration
   (`KONSPECTER_LOGIN_PROVIDERS_EN/_RU`).
4. **An opaque session cookie issued by Go**: `__Host-ksp_session` on https (`ksp_session`
   on plain http in development), HttpOnly, SameSite=Lax. Only a SHA-256 hash of its random
   id is stored. It lasts 30 days unused (`KONSPECTER_SESSION_TTL`), and its expiry moves
   forward at most once an hour.
5. **CSRF:** every cookie-authenticated request that changes something must carry
   `Origin` equal to `KONSPECTER_PUBLIC_URL`, and the site refuses foreign posts before
   running any action. Bearer requests are exempt: they carry no ambient credential.
6. **Routes declare what they accept:** `/api/notes*` and `/api/sync` take a bearer token
   only, `/api/account*` and the site's device pages a session only, and `/api/me` and
   `/api/keys` either.
7. **Abuse limits**, per client address and per email address, behind trusted proxies
   (`KONSPECTER_TRUSTED_PROXIES`) so the real client is counted: failed sign-ins, emails
   sent, and requests to connect an app (`KONSPECTER_RATE_*`).
8. **Deleting the account** needs a sign-in within the last 15 minutes plus the address
   typed in. It cascades to everything, and ends the account's open event streams.

## Consequences

- No JWTs and no signing keys to rotate. A session is a database row, so signing out,
  resetting a password or deleting the account takes effect at once.
- Email is required for the sign-in flows. Without SMTP (`KONSPECTER_MAIL_TRANSPORT=log`
  in development) codes and resets are off, or written to the log.
- One server instance: the rate limiters and event streams live in memory.
- No two-factor authentication or WebAuthn yet. They can be added on top of the session.

## Alternatives considered

- **JWT sessions**: stateless, but hard to revoke and easy to get wrong. The site and API
  share one origin and one database anyway.
- **Accounts created from any provider sign-in, merged later**: simpler at first, but
  leaves accounts without an address and makes merging a support problem.
- **Magic links instead of codes**: one click, but the link opens in whichever browser
  handles mail, often not the one signing in. A code works across devices.
