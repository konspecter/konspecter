-- Connecting an app by QR code: the site shows a code for the signed-in
-- account, an app scans it and trades it for its own device token. A code
-- works once, for a few minutes; an account has at most one (a new one
-- replaces it). Stored as a hash, like every other code.

CREATE TABLE device_connect_codes (
    code_hash  bytea PRIMARY KEY,
    user_id    uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
