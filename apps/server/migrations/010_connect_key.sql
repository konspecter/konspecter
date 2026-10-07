-- Connecting an app without the passphrase: a browser that holds the
-- account's content key seals it for the app that redeems the connect
-- code. The secret that opens it is only in the code's link, never here;
-- the sealed key goes with the code (used, replaced or expired).

ALTER TABLE device_connect_codes
    ADD COLUMN key_id text,
    ADD COLUMN sealed_key text,
    ADD CHECK ((key_id IS NULL) = (sealed_key IS NULL));
