-- Accounts on the site: passwords, browser sessions, email sign-in codes and
-- password resets. Secrets (session ids, codes, reset tokens) are stored as
-- SHA-256 hashes only; passwords as argon2id hashes.

ALTER TABLE users
    ADD COLUMN password_hash     text,
    ADD COLUMN email_verified_at timestamptz;

-- A signed-in browser. The cookie holds the id; expiry slides with use.
CREATE TABLE sessions (
    id_hash      bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_agent   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id ON sessions (user_id);

-- A one-time code sent to an address. Proving the code signs in (creating the
-- account if needed) and, when the code was asked for with a password, sets
-- that password. Only the newest open code of an address counts.
CREATE TABLE email_codes (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text NOT NULL CHECK (email = lower(email)),
    code_hash     bytea NOT NULL,
    password_hash text,
    attempts      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz
);

CREATE INDEX email_codes_email ON email_codes (email, created_at DESC);

-- A single-use link to set a new password.
CREATE TABLE password_resets (
    token_hash bytea PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE INDEX password_resets_user_id ON password_resets (user_id);
