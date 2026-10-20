-- Storage quotas. An account stores notes up to its quota: the server's
-- default (KONSPECTER_SYNC_QUOTA), unless sync_quota sets its own (server
-- set-quota). What counts is the size of every stored envelope.
--
-- A deleted note's content is cleared from now on, so deleting frees space
-- (no client reads a deleted note's text); here for notes deleted before.

ALTER TABLE users ADD COLUMN sync_quota bigint CHECK (sync_quota >= 0);

UPDATE notes SET content = '' WHERE deleted_at IS NOT NULL;
