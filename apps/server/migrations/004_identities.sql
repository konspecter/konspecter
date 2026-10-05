-- Sign-in with other services (OAuth providers). An identity is a provider's
-- account linked to a user. When the provider gives no verified email
-- address, the identity waits as a pending one until its owner proves an
-- address with an email code; the code then carries the identity along.

CREATE TABLE user_identities (
    provider   text NOT NULL,
    subject    text NOT NULL,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- The address the provider gave last time, as information only.
    email      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX user_identities_user_id ON user_identities (user_id);

-- A browser holds the token (a cookie) while its owner enters an address.
CREATE TABLE pending_identities (
    token_hash bytea PRIMARY KEY,
    provider   text NOT NULL,
    subject    text NOT NULL,
    -- The provider's unconfirmed address, offered as a suggestion.
    email      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

ALTER TABLE email_codes
    ADD COLUMN identity_provider text,
    ADD COLUMN identity_subject  text,
    ADD CONSTRAINT email_codes_identity CHECK ((identity_provider IS NULL) = (identity_subject IS NULL));
