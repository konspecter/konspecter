-- Users, API tokens and notes. Notes are Markdown documents with a revision
-- counter for optimistic concurrency; deletion is soft.

CREATE TABLE users (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email      text NOT NULL UNIQUE CHECK (email = lower(email)),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
    token_hash   bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);

CREATE INDEX api_tokens_user_id ON api_tokens (user_id);

CREATE TABLE notes (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id         text NOT NULL,
    markdown   text NOT NULL,
    revision   bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    PRIMARY KEY (user_id, id)
);
