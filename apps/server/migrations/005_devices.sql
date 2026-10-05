-- Devices: every app connected to an account. An API token now belongs to a
-- device the account owner can see and disconnect on the site. A device is
-- connected through the browser (device authorization, modelled on RFC 8628)
-- or, by an admin, from the command line.

ALTER TABLE users ADD COLUMN display_name text NOT NULL DEFAULT '';

ALTER TABLE api_tokens RENAME TO devices;
ALTER INDEX api_tokens_user_id RENAME TO devices_user_id;
ALTER TABLE devices
    ADD COLUMN id             uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN name           text NOT NULL DEFAULT '',
    ADD COLUMN platform       text NOT NULL DEFAULT 'other',
    ADD COLUMN client_version text NOT NULL DEFAULT '',
    ADD COLUMN last_sync_at   timestamptz,
    -- A disconnected device keeps its row for a while, so its app learns
    -- why its token stopped working (401 device_revoked).
    ADD COLUMN revoked_at     timestamptz;
-- token_hash stays unique (it was the primary key); the id names the device in URLs.
ALTER TABLE devices DROP CONSTRAINT api_tokens_pkey;
ALTER TABLE devices ADD PRIMARY KEY (id);
ALTER TABLE devices ADD CONSTRAINT devices_token_hash_key UNIQUE (token_hash);
-- Until now only the command line issued tokens.
UPDATE devices SET name = 'Command line token';

-- An app waiting for its owner to approve it on the site. The app holds the
-- device code; the person types (or follows a link with) the user code.
-- Both are stored as hashes.
CREATE TABLE device_authorizations (
    device_code_hash bytea PRIMARY KEY,
    user_code_hash   bytea NOT NULL UNIQUE,
    name             text NOT NULL,
    platform         text NOT NULL,
    client_version   text NOT NULL,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    -- Who approved or denied it.
    user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    last_polled_at   timestamptz,
    CHECK ((status = 'pending') = (user_id IS NULL))
);
