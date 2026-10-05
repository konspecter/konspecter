-- End-to-end encryption. The server no longer stores any note text: notes
-- arrive encrypted with the account's content key, which the server keeps
-- only wrapped (with the owner's passphrase and with a recovery key).
--
-- Notes stored before this were plain Markdown and are deleted here. Every
-- device still holds its own copy and uploads it again, encrypted, once its
-- owner sets up encryption and unlocks it. Sync every device before
-- upgrading.

CREATE TABLE encryption_keys (
    user_id              uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    key_id               text NOT NULL,
    kdf                  text NOT NULL,
    kdf_params           jsonb NOT NULL,
    salt                 text NOT NULL,
    wrapped_key          text NOT NULL,
    recovery_wrapped_key text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

DELETE FROM sync_changes;
DELETE FROM notes;

ALTER TABLE notes RENAME COLUMN markdown TO content;
-- The key the content is encrypted with (as its envelope names it).
ALTER TABLE notes ADD COLUMN key_id text NOT NULL;
