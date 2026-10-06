-- The language of the account's emails, kept from the site. IF NOT EXISTS:
-- some databases got the column under an earlier name of this migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
