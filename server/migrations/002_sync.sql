-- Incremental sync. Every change to a user's notes takes the next value of
-- that user's change sequence. Taking it locks the user's row, so a user's
-- changes commit in sequence order and a client that has seen change N has
-- seen every change before it.

ALTER TABLE users ADD COLUMN change_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN change_seq bigint NOT NULL DEFAULT 0;

-- The change log: one row per change.
CREATE TABLE sync_changes (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    seq        bigint NOT NULL,
    note_id    text NOT NULL,
    revision   bigint NOT NULL,
    operation  text NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, seq)
);

-- Give existing notes a place in the sequence.
WITH numbered AS (
    SELECT user_id, id, row_number() OVER (PARTITION BY user_id ORDER BY updated_at, id) AS seq
    FROM notes
)
UPDATE notes SET change_seq = numbered.seq
FROM numbered WHERE notes.user_id = numbered.user_id AND notes.id = numbered.id;

INSERT INTO sync_changes (user_id, seq, note_id, revision, operation)
SELECT user_id, change_seq, id, revision, CASE WHEN deleted_at IS NULL THEN 'create' ELSE 'delete' END
FROM notes;

UPDATE users SET change_seq = coalesce((SELECT max(change_seq) FROM notes WHERE notes.user_id = users.id), 0);

CREATE INDEX notes_user_change_seq ON notes (user_id, change_seq);
